import { buildUnsyncedContext } from '../group/contextSync'
import { contextCharBudgetForRole } from '../group/contextBudget'
import { buildExternalModelPrompt, type ExternalMemoryPatch } from '../group/externalModelContext'
import { buildOrchestrationReviewResponseInstruction } from '../group/orchestrationPrompts'
import { buildPrompt, roleUsesChatGptGptsPersona } from '../group/promptBuilder'
import type { ExternalModelConfig, GroupChat, GroupMessage, GroupRole, MessageReference, OpenTeamStore } from '../group/types'
import type { PromptDelivery } from './promptDelivery'
import type { RuntimeFrameRegistry } from './runtimeFrames'
import { promptSignature } from './promptSync'

export interface ExternalPromptDelivery {
  roleId: string
  chatId: string
  messageId: string
  replyAttemptId: string
  model: ExternalModelConfig
  prompt: string
}

export type PreparedRolePromptDelivery = {
  includesPersona: boolean
  replyAttemptId: string
} & (
  | { delivery: PromptDelivery; externalDelivery?: undefined }
  | { delivery?: undefined; externalDelivery: ExternalPromptDelivery }
)

export interface PrepareRolePromptDeliveryInput {
  store: OpenTeamStore
  chat: GroupChat
  role: GroupRole
  userMessage: GroupMessage
  roles: GroupRole[]
  messages: GroupMessage[]
  reference?: MessageReference
  timestamp: number
  newId(prefix: string): string
  runtimeFrames: Pick<RuntimeFrameRegistry, 'getByRole'>
}

export function prepareRolePromptDelivery(input: PrepareRolePromptDeliveryInput): PreparedRolePromptDelivery {
  const signature = promptSignature(input.store, input.chat, input.role, input.roles)
  const includesPersona = shouldIncludePersonaForPrompt(input.role, signature)
  const replyAttemptId = input.newId('attempt')
  const responseInstruction = responseInstructionForMessage(input.userMessage, input.store.settings.language)
  const maxContextChars = contextCharBudgetForRole(input.store, input.role)

  if (isExternalModelRole(input.role)) {
    const model = requireExternalModelForRole(input.store, input.role)
    const prompt = buildExternalModelPrompt(input.store, input.chat, input.role, input.userMessage, input.roles, { responseInstruction, maxContextChars })
    if (prompt.memoryPatch) applyExternalMemoryPatch(input.store, prompt.memoryPatch, input.timestamp)
    return {
      includesPersona,
      replyAttemptId,
      externalDelivery: {
        roleId: input.role.id,
        chatId: input.chat.id,
        messageId: input.userMessage.id,
        replyAttemptId,
        model,
        prompt: prompt.content,
      },
    }
  }

  const binding = input.runtimeFrames.getByRole(input.chat.id, input.role.id)
  if (!binding?.ready) throw new Error('The member iframe is not ready. Please restore the member first')
  const unsyncedContext = buildUnsyncedContext(input.chat, input.role, input.messages, input.userMessage, maxContextChars, input.store.settings.language)
  const content = buildPrompt({
    chat: input.chat,
    role: input.role,
    userMessage: input.userMessage,
    roles: input.roles,
    unsyncedContext,
    reference: input.reference,
    includePersona: includesPersona,
    personaSynced: !includesPersona && !roleUsesChatGptGptsPersona(input.role),
    responseInstruction,
    language: input.store.settings.language,
  })
  // Committed to role.promptSync once the reply arrives, so a failed send resends the persona.
  if (includesPersona) input.role.promptSyncPending = { messageId: input.userMessage.id, signature }
  else delete input.role.promptSyncPending

  return {
    includesPersona,
    replyAttemptId,
    delivery: {
      roleId: input.role.id,
      chatSite: input.role.chatSite ?? input.store.settings.defaultChatSite,
      tabId: binding.tabId,
      frameId: binding.frameId,
      message: {
        type: 'TEAM_SEND_PROMPT',
        chatId: input.chat.id,
        roleId: input.role.id,
        messageId: input.userMessage.id,
        replyAttemptId,
        content,
        includesPersona,
      },
    },
  }
}

export function isExternalModelRole(role: GroupRole): boolean {
  return role.modelSource === 'external'
}

export function getExternalModelForRole(store: OpenTeamStore, role: GroupRole): ExternalModelConfig | undefined {
  if (!isExternalModelRole(role) || !role.externalModelId) return undefined
  return store.settings.externalModelsById[role.externalModelId]
}

export function requireExternalModelForRole(store: OpenTeamStore, role: GroupRole): ExternalModelConfig {
  const model = getExternalModelForRole(store, role)
  if (!model) throw new Error(`External model not found: ${role.externalModelId ?? role.name}`)
  return model
}

function applyExternalMemoryPatch(store: OpenTeamStore, patch: ExternalMemoryPatch, timestamp: number): void {
  if (patch.scope === 'chat') {
    store.externalChatMemoriesById ??= {}
    store.externalChatMemoriesById[patch.id] = {
      chatId: patch.id,
      summary: patch.summary,
      summarizedThroughSeq: patch.summarizedThroughSeq,
      updatedAt: timestamp,
    }
    return
  }

  store.externalRoleMemoriesById ??= {}
  store.externalRoleMemoriesById[patch.id] = {
    roleId: patch.id,
    summary: patch.summary,
    summarizedThroughSeq: patch.summarizedThroughSeq,
    updatedAt: timestamp,
  }
}

function shouldIncludePersonaForPrompt(role: GroupRole, signature: string): boolean {
  return !roleUsesChatGptGptsPersona(role) && role.promptSync?.signature !== signature
}

function responseInstructionForMessage(message: GroupMessage, language: OpenTeamStore['settings']['language']): string | undefined {
  return message.orchestrationKind === 'review'
    ? buildOrchestrationReviewResponseInstruction(language)
    : undefined
}
