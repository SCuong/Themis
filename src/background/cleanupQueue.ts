// Deleting a chat or its messages first records what must be cleaned up, in the same store write, then
// deletes the image attachments and composer files. A task that fails stays queued and is retried on
// the next delete and on every service worker start, so a crash or a closed tab cannot leak files.
import { CLEANUP_QUEUE_KEY, loadStore } from '../group/store'
import type { CleanupTask, OpenTeamStore } from '../group/types'
import { mutateStore } from './storeAccess'

export interface CleanupDependencies {
  imageAttachments: {
    deleteByChatId(chatId: string): Promise<void>
    deleteByMessageIds(messageIds: string[]): Promise<void>
  }
  log: { warn(event: string, details?: Record<string, unknown>): void }
  now(): number
}

const COMPOSER_FILES_DATABASE = 'themis.composerFiles'
const COMPOSER_FILES_STORE = 'files'

// Removes everything else that belongs to the chat: notes, memories and orchestration data.
export function purgeChatData(store: OpenTeamStore, chatId: string): void {
  delete store.chatNotesById?.[chatId]
  delete store.externalChatMemoriesById?.[chatId]
  delete store.orchestrationFlowOrderByChatId?.[chatId]
  delete store.activeOrchestrationRunIdByChatId?.[chatId]
  for (const key of ['orchestrationFlowsById', 'orchestrationRunsById'] as const) {
    const records = store[key] as Record<string, { chatId?: string } | undefined>
    for (const [id, record] of Object.entries(records ?? {})) if (record?.chatId === chatId) delete records[id]
  }
}

export function enqueueCleanup(store: OpenTeamStore, task: Omit<CleanupTask, 'attempts'>): string {
  (store.otCleanupQueue ??= []).push({ attempts: 0, ...task })
  return task.id
}

// Files still attached to another message (a duplicated chat shares them) are kept.
function unreferencedFiles(store: OpenTeamStore, ids: string[]): string[] {
  if (!ids.length) return ids
  const used = new Set<unknown>()
  for (const message of Object.values(store.messagesById)) for (const file of message?.files ?? []) used.add(file?.id)
  return ids.filter(id => !used.has(id))
}

async function deleteComposerFiles(ids: string[] | undefined): Promise<void> {
  if (!ids?.length) return
  if (typeof indexedDB === 'undefined') throw new Error('File storage is unavailable')
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(COMPOSER_FILES_DATABASE, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(COMPOSER_FILES_STORE, { keyPath: 'id' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(COMPOSER_FILES_STORE, 'readwrite')
      const files = transaction.objectStore(COMPOSER_FILES_STORE)
      for (const id of ids) files.delete(id)
      transaction.oncomplete = resolve
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally {
    db.close()
  }
}

let cleanupChain: Promise<Set<string>> = Promise.resolve(new Set())

// Runs the queue, one run at a time. Resolves to the ids of tasks that are still pending.
export function runCleanup(deps: CleanupDependencies): Promise<Set<string>> {
  return cleanupChain = cleanupChain.catch(() => {}).then(() => runCleanupNow(deps))
}

async function runCleanupNow(deps: CleanupDependencies): Promise<Set<string>> {
  const queued = (await chrome.storage.local.get(CLEANUP_QUEUE_KEY))[CLEANUP_QUEUE_KEY]
  if (!Array.isArray(queued) || !queued.length) return new Set()
  const store = await loadStore()
  const done = new Set<string>()
  const failed = new Map<string, string>()
  for (const task of store.otCleanupQueue ?? []) {
    try {
      if (task.kind === 'chat') await deps.imageAttachments.deleteByChatId(task.chatId)
      else await deps.imageAttachments.deleteByMessageIds(task.messageIds ?? [])
      await deleteComposerFiles(unreferencedFiles(store, task.fileIds ?? []))
      done.add(task.id)
    } catch (error) {
      failed.set(task.id, error instanceof Error ? error.message : String(error))
      deps.log.warn('cleanup:pending', { cleanupId: task.id, chatId: task.chatId, error: failed.get(task.id) })
    }
  }
  await mutateStore(draft => {
    draft.otCleanupQueue = (draft.otCleanupQueue ?? []).filter(task => !done.has(task.id))
    for (const task of draft.otCleanupQueue) {
      if (!failed.has(task.id)) continue
      task.attempts = (task.attempts ?? 0) + 1
      task.lastError = failed.get(task.id)
      task.lastAttemptAt = deps.now()
    }
  })
  return new Set(failed.keys())
}
