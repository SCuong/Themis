// Inside a frame on an extension page Chrome leaves grok.com's SameSite=Lax/Strict cookies (its sign-in, `sso`)
// off the frame's own page load and off its WebSocket handshake (wss://grok.com/ws/). Grok then loads signed
// out or shows "Connection lost", and never answers. A network rule cannot add cookies to those requests.
//
// So while a Themis tab is open, each of those grok.com cookies gets a copy that is SameSite=None and
// partitioned to the Themis page (CHIPS). A partitioned cookie is only sent when grok.com is embedded under that
// top-level site, so Grok's own cookies and their protection everywhere else stay as they are. The copies follow
// the originals (sign-in, rotation, sign-out) and are deleted when the last Themis tab closes.
const GROK_URL = 'https://grok.com'

// @types/chrome 0.0.268 predates partitioned cookies (Chrome 119), so that part of the API is typed here.
interface PartitionKey { topLevelSite: string }
type Cookie = chrome.cookies.Cookie & { partitionKey?: PartitionKey }
interface PartitionedCookiesApi {
  getAll(details: { domain: string; partitionKey?: PartitionKey }): Promise<Cookie[]>
  set(details: chrome.cookies.SetDetails & { partitionKey: PartitionKey }): Promise<unknown>
  remove(details: { url: string; name: string; partitionKey: PartitionKey }): Promise<unknown>
}
const cookiesApi = (): PartitionedCookiesApi => chrome.cookies as unknown as PartitionedCookiesApi

interface GrokCookieLogger {
  warn(event: string, details?: Record<string, unknown>): void
}

function partitionKey(): PartitionKey {
  return { topLevelSite: chrome.runtime.getURL('').slice(0, -1) }
}

const isGrokDomain = (domain: string): boolean => /(^|\.)grok\.com$/.test(domain.replace(/^\./, ''))
const cookieUrl = (cookie: Cookie): string => `${GROK_URL}${cookie.path || '/'}`

// The copies Themis made (name|path), so it never deletes partitioned cookies grok.com sets itself inside the
// frame: Cloudflare's cf_clearance and __cf_bm are partitioned there, and deleting them brings back the bot check.
const COPIES_KEY = 'themis.grokCookieCopies'
const copyKey = (cookie: Cookie): string => `${cookie.name}|${cookie.path || '/'}`

// The cookies to copy: the unpartitioned ones Chrome leaves off cross-site requests.
async function originals(): Promise<Cookie[]> {
  return (await cookiesApi().getAll({ domain: 'grok.com' })).filter(cookie => !cookie.partitionKey && cookie.sameSite !== 'no_restriction')
}

async function copies(): Promise<Cookie[]> {
  return (await cookiesApi().getAll({ domain: 'grok.com', partitionKey: partitionKey() })).filter(cookie => cookie.partitionKey)
}

function setCopy(cookie: Cookie): Promise<unknown> {
  return cookiesApi().set({
    url: cookieUrl(cookie),
    name: cookie.name,
    value: cookie.value,
    ...(cookie.hostOnly ? {} : { domain: cookie.domain }),
    path: cookie.path,
    secure: true,
    httpOnly: cookie.httpOnly,
    sameSite: 'no_restriction' as chrome.cookies.SameSiteStatus,
    ...(cookie.session ? {} : { expirationDate: cookie.expirationDate }),
    partitionKey: partitionKey(),
  })
}

function removeCopy(cookie: Cookie): Promise<unknown> {
  return cookiesApi().remove({ url: cookieUrl(cookie), name: cookie.name, partitionKey: partitionKey() })
}

// Mirrors Grok's cookies while Themis tabs are open; removes the copies it made otherwise. One cookie Chrome
// refuses must not stop the rest, so failures are collected and reported once.
export async function syncGrokCookies(active: boolean): Promise<void> {
  if (!chrome.cookies?.getAll) return
  const wanted = active ? await originals() : []
  const keep = new Set(wanted.map(copyKey))
  const stored = (await chrome.storage.session.get(COPIES_KEY))[COPIES_KEY]
  const made = new Set<string>(Array.isArray(stored) ? stored : [])
  const failed: string[] = []
  const attempt = async (name: string, step: () => Promise<unknown>) => {
    try {
      await step()
    } catch {
      failed.push(name)
    }
  }
  for (const copy of await copies()) {
    if (made.has(copyKey(copy)) && !keep.has(copyKey(copy))) await attempt(copy.name, () => removeCopy(copy))
  }
  for (const cookie of wanted) await attempt(cookie.name, () => setCopy(cookie))
  await chrome.storage.session.set({ [COPIES_KEY]: [...keep] })
  if (failed.length) throw new Error(`Grok cookie copies not updated: ${failed.join(', ')}`)
}

// Re-mirrors when one of Grok's own cookies changes. Changes to the copies themselves are ignored.
export function watchGrokCookies(isActive: () => Promise<boolean>, log: GrokCookieLogger): void {
  chrome.cookies?.onChanged?.addListener(({ cookie }) => {
    if ((cookie as Cookie).partitionKey || !isGrokDomain(cookie.domain)) return
    isActive()
      .then(syncGrokCookies)
      .catch(error => log.warn('grok-cookies:sync-failed', { error: error instanceof Error ? error.message : String(error) }))
  })
}
