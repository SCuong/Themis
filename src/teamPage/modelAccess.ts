// API models can live on any host, so the extension asks for that host only when a model is saved or tested
// (manifest optional_host_permissions). Addresses that are not http(s) URLs are left to the request to reject.
export async function requestModelAccess(baseUrl: string): Promise<boolean> {
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    return true
  }
  if (!/^https?:$/.test(url.protocol) || !globalThis.chrome?.permissions?.request) return true
  return chrome.permissions.request({ origins: [`${url.protocol}//${url.hostname}/*`] })
}
