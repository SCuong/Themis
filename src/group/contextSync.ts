import { normalizeLanguage } from '../shared/i18n'
import type { GroupChat, GroupMessage, GroupRole, OpenTeamLanguage } from './types'

export interface UnsyncedContextResult {
  messages: GroupMessage[]
  contextText: string
  omittedEarlyContext: boolean
  latestSeq: number
}

export function getUnsyncedMessagesForRole(
  chat: GroupChat,
  role: GroupRole,
  messages: GroupMessage[],
  userMessage: GroupMessage,
): GroupMessage[] {
  const messageById = new Map(messages.map(message => [message.id, message]))
  // A member starting a new site conversation also gets back its own earlier replies (independent mode
  // gets only its own thread), so the new conversation picks up where the old one left off.
  const fresh = role.contextCursor === 0

  return chat.messageIds
    .map(messageId => messageById.get(messageId))
    .filter((message): message is GroupMessage => Boolean(message))
    .filter(message => message.seq > role.contextCursor && message.id !== userMessage.id && (message.roleId !== role.id || (fresh && message.status !== 'error')))
    .filter(message => chat.mode === 'collaborative'
      ? isMessageVisibleToRole(message, role.id)
      : fresh && (message.roleId === role.id || (message.type === 'user' && Boolean(message.targetRoleIds?.includes(role.id)))))
    .filter(message => Boolean(message.content.trim()))
}

export function buildUnsyncedContext(
  chat: GroupChat,
  role: GroupRole,
  messages: GroupMessage[],
  userMessage: GroupMessage,
  maxContextChars = 6000,
  languageInput?: OpenTeamLanguage,
): UnsyncedContextResult {
  const unsyncedMessages = getUnsyncedMessagesForRole(chat, role, messages, userMessage)
  const formatted = unsyncedMessages.map(message => formatContextMessage(message, languageInput)).join('\n\n')
  const truncated = truncateLatest(formatted, maxContextChars)

  return {
    messages: unsyncedMessages,
    contextText: truncated.text,
    omittedEarlyContext: truncated.omitted,
    latestSeq: getLatestMessageSeq(chat, messages),
  }
}

export function getLatestMessageSeq(chat: GroupChat, messages: GroupMessage[]): number {
  const messageById = new Map(messages.map(message => [message.id, message]))
  return chat.messageIds.reduce((latest, messageId) => {
    const message = messageById.get(messageId)
    return message ? Math.max(latest, message.seq) : latest
  }, 0)
}

export function getContextCursorAfterAck(chat: GroupChat, messages?: GroupMessage[]): number {
  return messages ? getLatestMessageSeq(chat, messages) : chat.nextMessageSeq - 1
}

export function formatContextMessage(message: GroupMessage, languageInput?: OpenTeamLanguage): string {
  const language = normalizeLanguage(languageInput)
  const speaker = message.type === 'assistant'
    ? message.roleName ?? (language === 'en' ? 'Person' : 'Person')
    : message.type === 'user'
      ? (language === 'en' ? 'User' : 'User')
      : (language === 'en' ? 'System' : 'System')
  return `${speaker}${language === 'en' ? ': ' : ': '}${message.content}`
}

function isMessageVisibleToRole(message: GroupMessage, roleId: string): boolean {
  if (message.type !== 'user') return true
  if (!message.targetRoleIds?.length) return true
  return message.targetRoleIds.includes(roleId)
}

function truncateLatest(text: string, maxChars: number): { text: string; omitted: boolean } {
  if (maxChars <= 0) return { text: '', omitted: text.length > 0 }
  if (text.length <= maxChars) return { text, omitted: false }
  return { text: text.slice(text.length - maxChars).trimStart(), omitted: true }
}
