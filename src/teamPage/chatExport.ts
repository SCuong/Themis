import type { GroupChat, GroupMessage, GroupRole, OpenTeamStore, RoomMode } from '../group/types'

export function formatChatExportMarkdown(store: OpenTeamStore, chat: GroupChat, exportedAt = new Date()): string {
  const roles = chat.roleIds
    .map(roleId => store.rolesById[roleId])
    .filter((role): role is GroupRole => Boolean(role))
  const messages = chat.messageIds
    .map(messageId => store.messagesById[messageId])
    .filter((message): message is GroupMessage => Boolean(message))
    .sort((left, right) => left.seq - right.seq || left.createdAt - right.createdAt)

  const lines = [
    `# ${chat.name}`,
    '',
    `- Exported at:${formatExportDateTime(exportedAt)}`,
    `- Group chat mode:${modeLabel(chat.mode)}`,
    `- Current members:${roles.map(role => role.name).join(', ') || 'None'}`,
    `- Message count:${messages.length}`,
    '',
    '## Chat history',
    '',
  ]

  for (const message of messages) {
    lines.push(`### ${messageSenderLabel(store, message)}`)
    lines.push('')
    lines.push(`> ${formatExportDateTime(new Date(message.createdAt))}`)
    lines.push('')
    lines.push(message.content || '(Empty message)')
    lines.push('')
  }

  return lines.join('\n').trimEnd() + '\n'
}

export function safeChatExportFilename(chatName: string, exportedAt = new Date()): string {
  const safeName = chatName
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    || 'group-chat'
  return `themis-${safeName}-${formatFilenameDateTime(exportedAt)}.md`
}

function messageSenderLabel(store: OpenTeamStore, message: GroupMessage): string {
  if (message.type === 'user') return 'Me'
  if (message.type === 'system') return 'System'
  if (message.roleName) return message.roleName
  if (message.roleId) return store.rolesById[message.roleId]?.name ?? 'AI agent'
  return 'AI agent'
}

function modeLabel(mode: RoomMode): string {
  return mode === 'collaborative' ? 'Collaborative chat' : 'Independent experts'
}

function formatExportDateTime(date: Date): string {
  const year = date.getFullYear()
  const month = pad(date.getMonth() + 1)
  const day = pad(date.getDate())
  const hour = pad(date.getHours())
  const minute = pad(date.getMinutes())
  const second = pad(date.getSeconds())
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`
}

function formatFilenameDateTime(date: Date): string {
  const year = date.getFullYear()
  const month = pad(date.getMonth() + 1)
  const day = pad(date.getDate())
  const hour = pad(date.getHours())
  const minute = pad(date.getMinutes())
  const second = pad(date.getSeconds())
  return `${year}${month}${day}-${hour}${minute}${second}`
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}
