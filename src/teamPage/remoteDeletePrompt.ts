// The second, opt-in question when deleting a chat: also delete the members' conversations on the AI sites.
import type { GroupChat, GroupRole, OpenTeamStore } from '../group/types'

const REMOTE_SITE_LABELS: Record<string, string> = { chatgpt: 'ChatGPT', claude: 'Claude', deepseek: 'DeepSeek', gemini: 'Gemini', grok: 'Grok' }

export interface RemoteDeleteResult {
  name: string
  site: string
  ok: boolean
  error?: string
}

function remoteDeleteTargets(store: OpenTeamStore, chat: GroupChat): GroupRole[] {
  return chat.roleIds
    .map(roleId => store.rolesById[roleId])
    .filter(role => role && role.modelSource !== 'external' && REMOTE_SITE_LABELS[role.chatSite ?? store.settings.defaultChatSite] && role.geminiConversationId)
}

// Asked only when some member has a conversation on a site that supports deleting it.
export function askRemoteDelete(store: OpenTeamStore, chat: GroupChat): boolean {
  const targets = remoteDeleteTargets(store, chat)
  if (targets.length === 0) return false
  const list = targets.map(role => `• ${role.name} (${REMOTE_SITE_LABELS[role.chatSite ?? store.settings.defaultChatSite]})`).join('\n')
  return document.documentElement.lang === 'en'
    ? window.confirm(`Also delete these conversations on the AI sites?\n\n${list}\n\nThis cannot be undone. Choose Cancel to delete the chat only in Themis.`)
    : window.confirm(`Xoá luôn các cuộc hội thoại này trên trang AI?\n\n${list}\n\nKhông thể hoàn tác. Chọn Huỷ để chỉ xoá trong Themis.`)
}

export function reportRemoteDelete(
  results: RemoteDeleteResult[] | undefined,
  notify: { showSuccess(message: string): void; showError(message: string): void },
): void {
  if (!results?.length) return
  const english = document.documentElement.lang === 'en'
  const failed = results.filter(result => !result.ok)
  const label = (result: RemoteDeleteResult) => `${result.name} (${REMOTE_SITE_LABELS[result.site] ?? result.site}${result.ok ? '' : `: ${result.error}`})`
  if (failed.length === 0) notify.showSuccess(english ? `Deleted ${results.length} conversation(s) on the AI sites.` : `Đã xoá ${results.length} cuộc hội thoại trên trang AI.`)
  else notify.showError(english ? `Could not delete on the AI site, please delete manually: ${failed.map(label).join(', ')}` : `Chưa xoá được trên trang AI, hãy xoá tay: ${failed.map(label).join(', ')}`)
}

// Date heading for the chat list, newest first.
export function chatGroupLabel(updatedAt: number | undefined, english: boolean): string {
  const date = new Date(updatedAt ?? 0)
  const today = new Date()
  const day = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime()
  const days = Math.round((day(today) - day(date)) / 864e5)
  if (days <= 0) return english ? 'Today' : 'Hôm nay'
  if (days === 1) return english ? 'Yesterday' : 'Hôm qua'
  if (days < 7) return english ? 'Previous 7 days' : '7 ngày trước'
  if (days < 30) return english ? 'Previous 30 days' : '30 ngày trước'
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}
