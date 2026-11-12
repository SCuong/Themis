import type { ContentLogger } from './runtimeClient'

// Deletes one conversation on the current AI site through the site's own web API, with the user's session.
export async function deleteConversation(conversationId: unknown, siteId: string, log: Pick<ContentLogger, 'info'>): Promise<{ ok: true }> {
  // The id ends up in request paths, so only plain id characters are allowed.
  if (typeof conversationId !== 'string' || !/^[\w-]{6,80}$/.test(conversationId)) throw new Error('invalid-conversation-id')
  const init: RequestInit = { credentials: 'include', signal: AbortSignal.timeout(15000) }
  const request = async (path: string, options?: RequestInit): Promise<Response> => {
    const response = await fetch(location.origin + path, { ...init, ...options })
    if (!response.ok) throw new Error(`http-${response.status}`)
    return response
  }
  log.info('delete-conversation:start', { site: siteId })
  if (siteId === 'chatgpt') {
    const token = (await (await request('/api/auth/session')).json())?.accessToken
    if (!token) throw new Error('not-signed-in')
    // ChatGPT's own delete button hides the conversation rather than erasing it.
    await request(`/backend-api/conversation/${conversationId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ is_visible: false }),
    })
  } else if (siteId === 'claude') {
    const organization = decodeURIComponent(document.cookie.match(/(?:^|; )lastActiveOrg=([^;]+)/)?.[1] ?? '') || (await (await request('/api/organizations')).json())?.[0]?.uuid
    if (!organization) throw new Error('no-organization')
    await request(`/api/organizations/${encodeURIComponent(organization)}/chat_conversations/${conversationId}`, { method: 'DELETE' })
  } else if (siteId === 'deepseek') {
    let token: string | undefined
    try {
      token = JSON.parse(localStorage.getItem('userToken') ?? 'null')?.value
    } catch {}
    if (!token) throw new Error('not-signed-in')
    const result = await (await request('/api/v0/chat_session/delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ chat_session_id: conversationId }),
    })).json()
    if (result?.code !== 0) throw new Error(`deepseek-code-${result?.code}`)
  } else if (siteId === 'gemini') {
    const html = document.documentElement.innerHTML
    const pageValue = (key: string): string | undefined => html.match(new RegExp(`"${key}":"([^"]+)"`))?.[1]
    const token = pageValue('SNlM0e')
    if (!token) throw new Error('not-signed-in')
    const params = new URLSearchParams({
      rpcids: 'GzXR5e',
      'source-path': '/app',
      hl: document.documentElement.lang || 'en',
      _reqid: String(100000 + Math.floor(Math.random() * 900000)),
      rt: 'c',
    })
    const buildLabel = pageValue('cfb2h')
    const sessionId = pageValue('FdrFJe')
    if (buildLabel) params.set('bl', buildLabel)
    if (sessionId) params.set('f.sid', sessionId)
    const geminiId = conversationId.startsWith('c_') ? conversationId : `c_${conversationId}`
    const text = await (await request(`/_/BardChatUi/data/batchexecute?${params}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: new URLSearchParams({ 'f.req': JSON.stringify([[['GzXR5e', JSON.stringify([geminiId]), null, 'generic']]]), at: token }),
    })).text()
    if (!/"wrb\.fr","GzXR5e","/.test(text)) throw new Error('gemini-unexpected-response')
  } else if (siteId === 'grok') {
    await request(`/rest/app-chat/conversations/${conversationId}`, { method: 'DELETE' })
  } else throw new Error(`unsupported-site-${siteId}`)
  log.info('delete-conversation:done', { site: siteId })
  return { ok: true }
}
