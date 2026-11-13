// Opt-in: when a chat is deleted, also delete each member's conversation on its AI site.
// The delete runs inside the member's frame, through the site's own web API with the user's session.
import { loadStore } from '../group/store'
import type { DeleteConversationMessage } from '../group/runtimeProtocol'
import type { RuntimeFrameRegistry } from './runtimeFrames'

const REMOTE_DELETE_SITES = new Set(['chatgpt', 'claude', 'deepseek', 'gemini', 'grok'])

export interface RemoteDeleteResult {
  roleId: string
  name: string
  site: string
  ok: boolean
  error?: string
}

export interface RemoteDeleteDependencies {
  log: { info(event: string, details?: Record<string, unknown>): void }
  runtimeFrames: Pick<RuntimeFrameRegistry, 'getByRole'>
  sendRoleMessage(tabId: number, frameId: number, message: DeleteConversationMessage): Promise<unknown>
}

export async function deleteRemoteConversations(deps: RemoteDeleteDependencies, chatId: string): Promise<RemoteDeleteResult[]> {
  const store = await loadStore()
  const chat = store.chatsById[chatId]
  if (!chat) return []
  const results: RemoteDeleteResult[] = []
  for (const roleId of chat.roleIds) {
    const role = store.rolesById[roleId]
    const site = role?.chatSite ?? store.settings.defaultChatSite
    if (!role || role.modelSource === 'external' || !REMOTE_DELETE_SITES.has(site) || !role.geminiConversationId) continue
    const member = { roleId, name: role.name, site }
    const frame = deps.runtimeFrames.getByRole(chatId, roleId)
    if (!frame?.ready) {
      results.push({ ...member, ok: false, error: 'frame-not-ready' })
      continue
    }
    try {
      const response = await deps.sendRoleMessage(frame.tabId, frame.frameId, { type: 'TEAM_DELETE_CONVERSATION', chatId, roleId, conversationId: role.geminiConversationId }) as { ok?: boolean; error?: unknown } | undefined
      results.push(response?.ok === true ? { ...member, ok: true } : { ...member, ok: false, error: String(response?.error ?? 'no-response') })
    } catch (error) {
      results.push({ ...member, ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  }
  deps.log.info('chat-delete:remote', { chatId, results: results.map(({ site, ok, error }) => ({ site, ok, error })) })
  return results
}
