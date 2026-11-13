// Tracks what each member's site conversation already knows, so the persona and earlier context are sent
// once per conversation instead of with every message. The signature covers everything the persona block
// depends on; when it changes (or the member lands in a new conversation) the persona is sent again.
import type { GroupChat, GroupRole, OpenTeamStore } from '../group/types'

export type ConversationChangeSource = 'reply' | 'frame' | 'nav'

export function promptSignature(store: OpenTeamStore, chat: GroupChat, role: GroupRole, roles: GroupRole[]): string {
  const text = JSON.stringify([
    store.settings.language,
    chat.mode,
    role.chatSite,
    role.name,
    role.description,
    role.systemPrompt,
    chat.mode === 'collaborative' ? roles.map(member => [member.id, member.name, member.description]) : 0,
  ])
  // FNV-1a: a short, stable fingerprint; collisions only cost one resent persona.
  let hash = 2166136261
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619)
  return `${(hash >>> 0).toString(36)}:${text.length}`
}

// Called whenever the member's conversation id is reported. A conversation other than the one the persona
// was delivered to means the site started over, so the persona and context are sent again.
export function syncConversation(role: GroupRole, conversationKey: string | undefined, source: ConversationChangeSource): void {
  if (conversationKey || source !== 'reply') {
    if (conversationKey) role.frameConversationId = conversationKey
    else delete role.frameConversationId
  }
  const sync = role.promptSync
  if (!sync || (conversationKey && conversationKey === sync.conversationKey)) return
  if (conversationKey && !sync.conversationKey && source !== 'frame') {
    sync.conversationKey = conversationKey
    return
  }
  if (!conversationKey && (source === 'reply' || (!sync.conversationKey && source === 'nav'))) return
  delete role.promptSync
  role.contextCursor = 0
}
