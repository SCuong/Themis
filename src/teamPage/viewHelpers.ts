import { profileAvatarClass } from '../../profile-avatars.js'
import type { GroupChat, GroupMessage, OpenTeamStore } from '../group/types'
import { getAvatarInitial } from './chatExperience'

export function emptyCard(title: string, body: string): HTMLElement {
  const wrapper = document.createElement('div')
  wrapper.className = 'empty-state'
  const card = document.createElement('div')
  card.className = 'empty-card'
  const heading = document.createElement('h3')
  heading.textContent = title
  const paragraph = document.createElement('p')
  paragraph.className = 'muted'
  paragraph.textContent = body
  card.append(heading, paragraph)
  wrapper.append(card)
  return wrapper
}

export function roleToneClass(seed: string | undefined): string {
  const source = seed || 'Themis'
  let hash = 0
  for (let index = 0; index < source.length; index += 1) hash = (hash + source.charCodeAt(index) * (index + 1)) % 6
  return `role-tone-${hash} ${profileAvatarClass(source)}`
}

export function roleAvatarLabel(name: string | undefined): string {
  return getAvatarInitial(name)
}

export function getChatRecentSummary(chat: GroupChat, store: OpenTeamStore): string {
  const lastMessageId = chat.messageIds[chat.messageIds.length - 1]
  const message = lastMessageId ? store.messagesById[lastMessageId] : undefined
  if (!message) return 'No messages yet. Restore a chat, add agents, or send your first task.'
  return `${messageTitle(message)}: ${truncate(message.content, 72)}`
}

export function messageTitle(message: GroupMessage): string {
  if (message.type === 'user') return 'Me'
  if (message.type === 'assistant') return message.roleName || 'AI agent'
  return 'System'
}

export function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value
}
