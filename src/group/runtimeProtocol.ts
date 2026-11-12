import type { ChatSite, GroupRole, OpenTeamStore, ReplyImageSource, RoleStatus } from './types'

export type RuntimeRoleStatus =
  | 'opening'
  | 'online'
  | 'sending'
  | 'generating'
  | 'stopped'
  | 'idle'
  | 'offline'
  | 'error'

export type SiteStatus = 'ready' | 'generating' | 'error' | 'blocked' | 'unauthorized'

export type SendPromptMessage = {
  type: 'TEAM_SEND_PROMPT'
  chatId: string
  roleId: string
  messageId: string
  replyAttemptId?: string
  content: string
  autoSend?: boolean
  includesPersona?: boolean
  isRetry?: boolean
  files?: PromptFile[]
}

// A file attached in the composer, sent to each AI site as a data URL.
export type PromptFile = {
  name: string
  type?: string
  dataUrl: string
}

export type DeleteConversationMessage = {
  type: 'TEAM_DELETE_CONVERSATION'
  chatId?: string
  roleId?: string
  conversationId: string
}

export type StopGenerationMessage = {
  type: 'TEAM_STOP_GENERATION'
  chatId: string
  roleId: string
  messageId?: string
  replyAttemptId?: string
}

export type ResyncReplyMessage = {
  type: 'TEAM_RESYNC_REPLY'
  chatId: string
  roleId: string
  messageId: string
  currentContent?: string
}

export type BackgroundToRoleMessage = SendPromptMessage | DeleteConversationMessage | StopGenerationMessage | ResyncReplyMessage

export type RoleToBackgroundMessage =
  | { type: 'TEAM_FRAME_ROLE_READY'; chatId?: string; roleId: string; hostTabId?: number; conversationId: string; conversationUrl?: string }
  | { type: 'TEAM_ROLE_CONVERSATION_UPDATED'; chatId: string; roleId: string; conversationId?: string; conversationUrl?: string }
  | { type: 'TEAM_SEND_ACK'; chatId: string; roleId: string; messageId: string }
  | { type: 'TEAM_ROLE_ERROR'; chatId: string; roleId: string; messageId?: string; reason: string; replyAttemptId?: string }
  | { type: 'TEAM_ROLE_STATUS'; status: RuntimeRoleStatus; chatId?: string; roleId?: string; error?: string }
  | {
      type: 'TEAM_ROLE_REPLY_RESYNC'
      chatId?: string
      roleId?: string
      messageId: string
      content: string
      contentFormat?: 'markdown'
      images?: ReplyImageSource[]
      conversationId?: string
      conversationUrl?: string
    }
  | {
      type: 'TEAM_ROLE_REPLY'
      chatId?: string
      roleId?: string
      messageId?: string
      replyAttemptId?: string
      content: string
      contentFormat?: 'markdown'
      images?: ReplyImageSource[]
      conversationId?: string
      conversationUrl?: string
    }
  | { type: 'TEAM_SITE_STATUS_UPDATE'; siteId: string; status: SiteStatus; detail?: string }

export interface FrameRoleReadyResponse {
  ok: boolean
  role?: Pick<GroupRole, 'id' | 'name' | 'chatId'>
  store?: OpenTeamStore
  replyHistory?: string[]
  error?: string
}

export function mapRuntimeRoleStatus(value: unknown): RoleStatus | undefined {
  switch (value) {
    case 'opening':
    case 'offline':
      return 'loading'
    case 'sending':
    case 'generating':
      return 'thinking'
    case 'stopped':
      return 'stopped'
    case 'online':
    case 'idle':
      return 'ready'
    case 'error':
      return 'error'
    default:
      return undefined
  }
}

export function isRuntimeChatSite(value: unknown): value is ChatSite {
  return value === 'gemini' || value === 'chatgpt' || value === 'claude' || value === 'deepseek' || value === 'grok'
}
