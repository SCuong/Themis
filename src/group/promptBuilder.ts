import { formatContextMessage, type UnsyncedContextResult } from './contextSync'
import { PROMPT_I18N, normalizeLanguage } from '../shared/i18n'
import type { GroupChat, GroupMessage, GroupRole, MessageReference, OpenTeamLanguage } from './types'

export interface BuildPromptInput {
  chat: GroupChat
  role: GroupRole
  userMessage: GroupMessage
  roles: GroupRole[]
  unsyncedContext?: UnsyncedContextResult
  unsyncedMessages?: GroupMessage[]
  maxContextChars?: number
  reference?: MessageReference
  includePersona?: boolean
  // The site conversation already has the persona (and, for group chats, the member list).
  personaSynced?: boolean
  responseInstruction?: string
  language?: OpenTeamLanguage
}

export function buildPrompt(input: BuildPromptInput): string {
  return input.chat.mode === 'collaborative'
    ? buildCollaborativePrompt(input)
    : buildIndependentPrompt(input)
}

export function buildIndependentPrompt(input: BuildPromptInput): string {
  const reference = input.reference ?? input.userMessage.references?.[0]
  const language = normalizeLanguage(input.language)
  const context = input.unsyncedContext
  return joinSections([
    language === 'en' ? `You are "${input.role.name}".` : `Bạn là "${input.role.name}".`,
    input.personaSynced ? undefined : buildRoleBlock(input.role, input.includePersona ?? true, language),
    context?.contextText
      ? `${context.omittedEarlyContext ? (language === 'en' ? '[Some earlier context has been omitted]\n' : '[Một phần ngữ cảnh cũ đã được lược bớt]\n') : ''}${language === 'en' ? 'Earlier conversation between you and the user:' : 'Cuộc trò chuyện trước đó giữa bạn và người dùng:'}\n${context.contextText}`
      : undefined,
    buildReferenceBlock(reference, language),
    language === 'en' ? `User message:\n${input.userMessage.content}` : `Tin nhắn của người dùng:
${input.userMessage.content}`,
    input.responseInstruction ?? independentResponseInstruction(input.role.name, Boolean(reference), language),
  ])
}

export function buildCollaborativePrompt(input: BuildPromptInput): string {
  const reference = input.reference ?? input.userMessage.references?.[0]
  const language = normalizeLanguage(input.language)
  const synced = input.personaSynced

  return joinSections([
    synced ? undefined : (language === 'en' ? 'You are in an AI group chat.' : 'Bạn đang tham gia một cuộc trò chuyện nhóm AI.'),
    synced ? undefined : buildMemberList(input.roles, language),
    language === 'en' ? `Your identity is "${input.role.name}".` : `Bạn đang đóng vai "${input.role.name}".`,
    synced ? undefined : buildRoleBlock(input.role, input.includePersona ?? true, language),
    buildContextBlock(input, language),
    buildReferenceBlock(reference, language),
    language === 'en' ? `User latest message:\n${input.userMessage.content}` : `Tin nhắn mới nhất của người dùng:
${input.userMessage.content}`,
    input.responseInstruction ?? collaborativeResponseInstruction(input.role.name, Boolean(reference), language),
  ])
}

export function buildInitializationPrompt(chat: GroupChat, role: GroupRole, roles: GroupRole[], includePersona = true, languageInput?: OpenTeamLanguage): string {
  const language = normalizeLanguage(languageInput)
  if (chat.mode === 'collaborative') {
    return joinSections([
      language === 'en' ? 'You are in an AI group chat.' : 'Bạn đang tham gia một cuộc trò chuyện nhóm AI.',
      buildMemberList(roles, language),
      language === 'en' ? `Your identity is "${role.name}".` : `Bạn đang đóng vai "${role.name}".`,
      buildRoleBlock(role, includePersona, language),
      language === 'en'
        ? `Keep your assigned perspective. You may respond to, add to, or challenge other members' points. When the user quotes a member, respond directly to that quoted point. ${PROMPT_I18N.en.responseLanguageInstruction}`
        : `Maintain your member's perspective. You may respond to, expand on, or challenge other members' views. When the user quotes a member's statement, explicitly address that point.${PROMPT_I18N.vi.responseLanguageInstruction}`,
    ])
  }

  return joinSections([
    language === 'en' ? `You are "${role.name}".` : `Bạn là "${role.name}".`,
    buildRoleBlock(role, includePersona, language),
    language === 'en'
      ? `The user will give you tasks. Always keep your assigned perspective and answer independently. Do not assume there are other AI members. ${PROMPT_I18N.en.responseLanguageInstruction}`
      : `The user will give you tasks. Always maintain your member's perspective and answer independently, without assuming there are other AI members.${PROMPT_I18N.vi.responseLanguageInstruction}`,
  ])
}

export function buildInitPrompt(chat: GroupChat, role: GroupRole, roles: GroupRole[], includePersona = true, language?: OpenTeamLanguage): string {
  return buildInitializationPrompt(chat, role, roles, includePersona, language)
}

export function buildReinitializationPrompt(chat: GroupChat, role: GroupRole, roles: GroupRole[], includePersona = true, language?: OpenTeamLanguage): string {
  return buildInitializationPrompt(chat, role, roles, includePersona, language)
}

export function buildReinitPrompt(chat: GroupChat, role: GroupRole, roles: GroupRole[], includePersona = true, language?: OpenTeamLanguage): string {
  return buildReinitializationPrompt(chat, role, roles, includePersona, language)
}

export function roleUsesChatGptGptsPersona(role: GroupRole): boolean {
  return role.chatSite === 'chatgpt' && Boolean(role.chatGptGptsUrl?.trim())
}

export function buildMemberList(roles: GroupRole[], languageInput?: OpenTeamLanguage): string {
  const language = normalizeLanguage(languageInput)
  const members = roles.map(role => `- ${role.name}${role.description ? `${language === 'en' ? ': ' : ': '}${role.description}` : ''}`).join('\n')
  return language === 'en' ? `Group chat members:\n${members}` : `Thành viên trong nhóm:
${members}`
}

function buildRoleBlock(role: GroupRole, includePersona: boolean, language: OpenTeamLanguage): string {
  return joinSections([
    role.description ? `${language === 'en' ? 'Your responsibility:' : 'Trách nhiệm của bạn:'}\n${role.description}` : undefined,
    includePersona && role.systemPrompt ? `${language === 'en' ? 'Persona:' : 'Persona:'}\n${role.systemPrompt}` : undefined,
  ])
}

function buildContextBlock(input: BuildPromptInput, language: OpenTeamLanguage): string {
  if (input.unsyncedContext) {
    return joinSections([
      input.unsyncedContext.omittedEarlyContext ? (language === 'en' ? 'Some earlier context has been omitted.' : 'Some earlier context has been omitted.') : undefined,
      input.unsyncedContext.contextText
        ? `${language === 'en' ? 'Since your last turn, the group chat has these new items:' : 'The following new content has appeared in the group chat since your last turn:'}\n${input.unsyncedContext.contextText}`
        : (language === 'en' ? 'Since your last turn, there is no new group-chat content to sync.' : 'There is no new group chat content to sync since your last turn.'),
    ])
  }

  const messages = input.unsyncedMessages ?? []
  if (messages.length === 0) return ''

  const maxContextChars = input.maxContextChars ?? 6000
  const context = messages.map(message => formatContextMessage(message, language)).join('\n\n')
  if (context.length <= maxContextChars) {
    return `${language === 'en' ? 'Since your last turn, the group chat has these new items:' : 'The following new content has appeared in the group chat since your last turn:'}\n${context}`
  }

  return `${language === 'en' ? '[Some earlier context has been omitted]' : '[Some earlier context has been omitted]'}\n\n${language === 'en' ? 'Since your last turn, the group chat has these new items:' : 'The following new content has appeared in the group chat since your last turn:'}\n${context.slice(-maxContextChars).trimStart()}`
}

function buildReferenceBlock(reference: MessageReference | undefined, language: OpenTeamLanguage): string {
  if (!reference) return ''
  if (language === 'en') {
    const source = reference.roleName ? `"${reference.roleName}"'s point` : 'a message'
    return `The user quoted ${source}:\n"${reference.contentSnapshot}"\nRespond directly to this quote.`
  }
  const source = reference.roleName ? `“${reference.roleName}”'s view` : 'a message'
  return `The user quoted ${source}:
“${reference.contentSnapshot}”
Please explicitly address this quotation.`
}

function independentResponseInstruction(roleName: string, hasReference: boolean, language: OpenTeamLanguage): string {
  if (language === 'en') {
    return `Reply as "${roleName}". ${PROMPT_I18N.en.responseLanguageInstruction}${hasReference ? ' State where you agree or disagree and suggest next steps.' : ''}`
  }
  return `Trả lời với vai trò "${roleName}". ${PROMPT_I18N.vi.responseLanguageInstruction}${hasReference ? ' Nêu rõ điểm bạn đồng ý hoặc không đồng ý, rồi đề xuất bước tiếp theo.' : ''}`
}

function collaborativeResponseInstruction(roleName: string, hasReference: boolean, language: OpenTeamLanguage): string {
  if (language === 'en') {
    return `Reply as "${roleName}". You may reference, add to, or challenge other members' points. ${PROMPT_I18N.en.responseLanguageInstruction}${hasReference ? ' Respond directly to the point quoted by the user.' : ''}`
  }
  return `Trả lời với vai trò "${roleName}". Bạn có thể bổ sung hoặc phản biện ý kiến của các thành viên khác. ${PROMPT_I18N.vi.responseLanguageInstruction}${hasReference ? ' Trả lời trực tiếp ý mà người dùng trích dẫn.' : ''}`
}

function joinSections(sections: Array<string | undefined>): string {
  return sections.filter((section): section is string => Boolean(section?.trim())).join('\n\n')
}
