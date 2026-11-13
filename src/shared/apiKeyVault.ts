// External model API keys are stored sealed with AES-GCM. The key never leaves this browser profile:
// it is a non-extractable CryptoKey kept in IndexedDB, so the copy in chrome.storage is useless elsewhere.
import type { OpenTeamSettings, OpenTeamStore } from '../group/types'

const SEALED_PREFIX = 'themis-sealed:v1:'
const KEY_DATABASE = 'themis.keys'
const KEY_STORE = 'keys'
const KEY_ID = 'apiKey'

let keyPromise: Promise<CryptoKey> | undefined

function apiKeyKey(): Promise<CryptoKey> {
  return keyPromise ??= (async () => {
    const generate = () => crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    if (typeof indexedDB === 'undefined') return generate()
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(KEY_DATABASE, 1)
      request.onupgradeneeded = () => request.result.createObjectStore(KEY_STORE)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const run = <T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest): Promise<T> => new Promise((resolve, reject) => {
      const request = operation(db.transaction(KEY_STORE, mode).objectStore(KEY_STORE))
      request.onsuccess = () => resolve(request.result)
      request.onerror = event => {
        event.preventDefault?.()
        reject(request.error)
      }
    })
    try {
      const existing = await run<CryptoKey | undefined>('readonly', store => store.get(KEY_ID))
      if (existing) return existing
      const created = await generate()
      try {
        await run('readwrite', store => store.add(created, KEY_ID))
        return created
      } catch {
        // Another context created the key first; use that one so both can read each other's keys.
        return await run<CryptoKey>('readonly', store => store.get(KEY_ID))
      }
    } finally {
      db.close()
    }
  })().catch(error => {
    keyPromise = undefined
    throw error
  })
}

const toBase64 = (buffer: ArrayBuffer | Uint8Array): string => btoa(String.fromCharCode(...new Uint8Array(buffer)))
const fromBase64 = (text: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(text), char => char.charCodeAt(0))

// Seals plaintext keys in place; already sealed keys are left as they are.
export async function sealApiKeys(settings: Partial<OpenTeamSettings> | undefined): Promise<void> {
  for (const model of Object.values(settings?.externalModelsById ?? {})) {
    if (typeof model?.apiKey !== 'string' || model.apiKey.startsWith(SEALED_PREFIX)) continue
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await apiKeyKey(), new TextEncoder().encode(model.apiKey))
    model.apiKey = SEALED_PREFIX + toBase64(iv) + ':' + toBase64(sealed)
  }
}

// Opens sealed keys in place. A key that cannot be opened stays sealed and the user is asked to enter it again.
export async function openApiKeys<T extends Partial<OpenTeamStore> | undefined>(store: T): Promise<T> {
  for (const model of Object.values(store?.settings?.externalModelsById ?? {})) {
    if (typeof model?.apiKey !== 'string' || !model.apiKey.startsWith(SEALED_PREFIX)) continue
    const [iv, sealed] = model.apiKey.slice(SEALED_PREFIX.length).split(':')
    try {
      model.apiKey = new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(iv) }, await apiKeyKey(), fromBase64(sealed)))
    } catch (error) {
      console.warn('themis: cannot decrypt API key for', model.id, '- enter it again', error)
    }
  }
  return store
}
