// Grok's real-time connection is a WebSocket. Inside a frame on an extension page Chrome sends Grok's
// SameSite=Lax/Strict cookies (its sign-in, `sso`) on ordinary requests but not on that handshake, so Grok
// shows "Connection lost" and never answers. A network rule cannot add cookies to a WebSocket handshake.
//
// So while a Themis tab is open, each of those grok.com cookies gets a copy that is SameSite=None and
// partitioned to the Themis page (CHIPS). A partitioned cookie is only sent when grok.com is embedded under
// that top-level site, so Grok's own cookies and their protection everywhere else stay as they are. The copies
// follow the originals (sign-in, rotation, sign-out) and are deleted when the last Themis tab closes.
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

// The cookies the WebSocket needs: the unpartitioned ones Chrome would leave off a cross-site handshake.
async function originals(): Promise<Cookie[]> {
  return (await cookiesApi().getAll({ domain: 'grok.com' })).filter(cookie => !cookie.partitionKey && cookie.sameSite !== 'no_restriction')
}

function copies(): Promise<Cookie[]> {
  return cookiesApi().getAll({ domain: 'grok.com', partitionKey: partitionKey() })
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

// The copies Themis made, so it never deletes partitioned cookies grok.com set itself in the frame
// (Cloudflare's cf_clearance and __cf_bm are partitioned there; deleting them brings back the bot check).
const COPIES_KEY = 'themis.grokCookieCopies'
const cookieKey = (cookie: Cookie): string => `${cookie.name}|${cookie.path}`

async function madeCopies(): Promise<Set<string>> {
  const stored = (await chrome.storage.session.get(COPIES_KEY))[COPIES_KEY]
  return new Set(Array.isArray(stored) ? stored : [])
}

// Mirrors Grok's cookies while Themis tabs are open; removes the copies it made otherwise.
export async function syncGrokCookies(active: boolean): Promise<void> {
  if (!chrome.cookies?.getAll) return
  const wanted = active ? await originals() : []
  const keep = new Set(wanted.map(cookieKey))
  const made = await madeCopies()
  for (const copy of await copies()) {
    if (made.has(cookieKey(copy)) && !keep.has(cookieKey(copy))) await removeCopy(copy)
  }
  for (const cookie of wanted) await setCopy(cookie)
  await chrome.storage.session.set({ [COPIES_KEY]: [...keep] })
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
