import { waitBeforePromptInput } from './promptDelay'
import type { ContentLogger } from './runtimeClient'
import type { PromptFile } from '../group/runtimeProtocol'

const COMPOSER_SELECTORS = [
  '#prompt-textarea',
  '.ProseMirror[contenteditable="true"]',
  'rich-textarea [contenteditable="true"]',
  'textarea',
  '[contenteditable="true"]',
]

// Pastes the files into the site's composer the way a user paste would, then waits for the uploads to start.
export async function attachFiles(files: PromptFile[] | undefined, siteId: string, log: ContentLogger): Promise<void> {
  if (!Array.isArray(files) || files.length === 0) return
  const transfer = new DataTransfer()
  let bytes = 0
  for (const file of files) {
    const data = Uint8Array.from(atob(file.dataUrl.slice(file.dataUrl.indexOf(',') + 1)), char => char.charCodeAt(0))
    bytes += data.length
    transfer.items.add(new File([data], file.name, { type: file.type || 'application/octet-stream' }))
  }
  const composer = COMPOSER_SELECTORS.flatMap(selector => [...document.querySelectorAll<HTMLElement>(selector)]).find(element => element.getClientRects().length > 0)
  if (!composer) throw new Error('Cannot find the chat input to attach files')
  log.info('attach-files:paste', { site: siteId, count: files.length, bytes })
  composer.focus()
  composer.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }))
  await waitBeforePromptInput(Math.min(20000, 2500 + Math.ceil(bytes / 1048576) * 1500))
}
