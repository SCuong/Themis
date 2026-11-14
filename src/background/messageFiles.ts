// Files attached in the composer travel with the message as data URLs: site members get them pasted into
// their composer, API members get text files inlined into the prompt.
import type { PromptFile } from '../group/runtimeProtocol'
import type { MessageFile } from '../group/types'
import { readComposerFileBlobs } from './cleanupQueue'

export interface MessageFileInput extends PromptFile {
  type: string
  size: number
  id?: string
}

const MAX_FILES = 10
const MAX_DATA_URL_CHARS = 56e6

// KNOWN BUG kept from the shipped build: `[w-]` was meant to be `[\w-]`, so stored file ids are dropped.
// Fixing it changes behavior (composer files become deletable and re-openable), so it needs its own change.
const FILE_ID = /^[\w-]{1,80}$/
// KNOWN BUG kept from the shipped build: the leading `.` was meant to be `\.` (it matches any character).
const TEXT_FILE = /\.(txt|md|markdown|csv|tsv|json|jsonl|xml|ya?ml|toml|ini|log|html?|css|s?js|mjs|cjs|jsx|tsx?|py|java|kt|c|h|cc|cpp|hpp|cs|go|rs|rb|php|swift|sql|sh|ps1|bat|vue|svelte)$/i

// Validates files sent by the team page (a trust boundary: the message comes over runtime messaging).
export function readMessageFiles(value: unknown): MessageFileInput[] {
  if (value == null) return []
  if (!Array.isArray(value) || value.length > MAX_FILES) throw new Error(`Up to ${MAX_FILES} files per message`)
  let total = 0
  return value.map(file => {
    if (!file || typeof file.name !== 'string' || !file.name || typeof file.dataUrl !== 'string' || !/^data:[^,]*;base64,/.test(file.dataUrl)) throw new Error('Invalid attached file')
    total += file.dataUrl.length
    if (total > MAX_DATA_URL_CHARS) throw new Error('Attached files are too large')
    return {
      name: file.name.slice(0, 255),
      type: typeof file.type === 'string' ? file.type : '',
      size: Number(file.size) || 0,
      id: typeof file.id === 'string' && FILE_ID.test(file.id) ? file.id : undefined,
      dataUrl: file.dataUrl,
    }
  })
}

// A message keeps only its file details, so a retry reads the bytes back from the composer file store.
// It throws when a file is gone: a prompt must never go out with fewer files than its message has.
export async function loadMessageFiles(files: MessageFile[] | undefined): Promise<MessageFileInput[]> {
  if (!files?.length) return []
  const blobs = await readComposerFileBlobs(files.map(file => file.id))
  const missing = files.filter((_, index) => !blobs[index]).map(file => `"${file.name}"`)
  if (missing.length) throw new Error(`Cannot retry: attached file ${missing.join(', ')} is no longer stored on this device. Attach it again and send a new message.`)
  return Promise.all(files.map(async (file, index) => {
    const bytes = new Uint8Array(await blobs[index]!.arrayBuffer())
    let binary = ''
    // In chunks: one call with every byte as an argument overflows the stack.
    for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
    return { name: file.name, type: file.type, size: file.size, id: file.id, dataUrl: `data:${file.type || 'application/octet-stream'};base64,${btoa(binary)}` }
  }))
}

// Site members get the files pasted into their composer; API members get the text inlined into the prompt.
export function addFilesToDelivery(prepared: { delivery?: { message: { files?: PromptFile[] } }; externalDelivery?: { prompt: string } }, files: MessageFileInput[]): void {
  if (!files.length) return
  if (prepared.delivery) prepared.delivery.message.files = files
  if (prepared.externalDelivery) prepared.externalDelivery.prompt += filesAsPromptText(files)
}

// API models cannot receive files, so readable text files are appended to the prompt instead.
export function filesAsPromptText(files: MessageFileInput[]): string {
  return files.map(file => {
    if (!(file.type.startsWith('text/') || /json|xml|javascript|yaml/.test(file.type) || TEXT_FILE.test(file.name))) {
      return `\n\n[Attached file "${file.name}" (${file.type || 'unknown type'}) cannot be read by this API model.]`
    }
    const bytes = Uint8Array.from(atob(file.dataUrl.slice(file.dataUrl.indexOf(',') + 1)), char => char.charCodeAt(0))
    return `\n\n--- File: ${file.name} ---\n${new TextDecoder().decode(bytes)}\n--- End of file ---`
  }).join('')
}
