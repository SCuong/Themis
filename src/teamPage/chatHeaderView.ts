import type { GroupChat, GroupMessage, GroupRole, RoomMode } from '../group/types'
import { normalizeLanguage, translateUi, type TeamLanguage } from '../shared/i18n'
import type { TeamPageState } from './appState'

export interface ChatHeaderViewDependencies {
  state: TeamPageState
  chatTitleEl: HTMLElement
  chatSubtitleEl: HTMLElement
  chatStatusEl: HTMLElement
  togglePeopleDrawerEl: HTMLButtonElement
  openOrchestrationEl: HTMLButtonElement
  getLanguage(): TeamLanguage
  getCurrentChat(): GroupChat | undefined
  getCurrentRoles(): GroupRole[]
  getCurrentMessages(): GroupMessage[]
  runCommand(type: string, payload?: Record<string, unknown>): Promise<void>
}

export interface ChatHeaderView {
  renderChatHeader(): void
}

export function createChatHeaderView(deps: ChatHeaderViewDependencies): ChatHeaderView {
  let manualMentionToggle: HTMLButtonElement | undefined

  function renderChatHeader(): void {
    const chat = deps.getCurrentChat()
    const roles = deps.getCurrentRoles()
    if (!chat) {
      deps.chatTitleEl.textContent = ui('No chat selected')
      deps.chatSubtitleEl.hidden = true
      deps.chatStatusEl.className = 'status-pill'
      deps.chatStatusEl.textContent = ui('Empty')
      deps.chatStatusEl.removeAttribute('title')
      deps.togglePeopleDrawerEl.textContent = ui('Members 0')
      deps.togglePeopleDrawerEl.disabled = true
      deps.openOrchestrationEl.hidden = true
      if (manualMentionToggle) {
        manualMentionToggle.hidden = true
        manualMentionToggle.disabled = true
      }
      return
    }

    deps.chatTitleEl.textContent = chat.name
    deps.chatTitleEl.title = chat.name
    // The mode sits beside the title as a badge; the member count lives on the Members button.
    deps.chatSubtitleEl.hidden = false
    deps.chatSubtitleEl.textContent = ui(modeLabel(chat.mode))
    deps.chatStatusEl.className = `status-pill status-${chat.status}`
    deps.chatStatusEl.textContent = ui(chatStatusLabel(chat.status))
    // Shown as a dot alone when the header is tight; the tooltip still names it.
    deps.chatStatusEl.title = deps.chatStatusEl.textContent
    deps.togglePeopleDrawerEl.disabled = false
    deps.togglePeopleDrawerEl.textContent = ui(`Members ${roles.length}`)
    deps.togglePeopleDrawerEl.setAttribute('aria-label', ui(deps.state.peopleDrawerOpen ? 'Collapse people panel' : 'Open people panel'))
    deps.togglePeopleDrawerEl.setAttribute('aria-expanded', String(deps.state.peopleDrawerOpen))
    deps.openOrchestrationEl.hidden = chat.mode !== 'collaborative'

    if (!manualMentionToggle) {
      manualMentionToggle = document.createElement('button')
      manualMentionToggle.type = 'button'
      manualMentionToggle.className = 'btn drawer-summary manual-mention-toggle'
      manualMentionToggle.setAttribute('role', 'switch')
      manualMentionToggle.addEventListener('click', async () => {
        const current = deps.getCurrentChat()
        if (!current) return
        const plainMessagesReplyAll = current.requireManualMention === false
        await deps.runCommand('GROUP_CHAT_UPDATE', { chatId: current.id, requireManualMention: plainMessagesReplyAll ? true : false })
      })
      document.getElementById('composer-options')?.append(manualMentionToggle)
    }
    manualMentionToggle.hidden = chat.mode !== 'collaborative'
    // Locked with the composer until the chat has members.
    manualMentionToggle.disabled = roles.length === 0
    const plainMessagesReplyAll = chat.requireManualMention === false
    const ruleHint = 'When on, plain messages ask all members to reply; when off, only @ members or @all trigger replies.'
    manualMentionToggle.textContent = ui('Everyone replies')
    manualMentionToggle.title = ui(ruleHint)
    manualMentionToggle.setAttribute('aria-label', ui(ruleHint))
    manualMentionToggle.setAttribute('aria-pressed', String(plainMessagesReplyAll))
    manualMentionToggle.setAttribute('aria-checked', String(plainMessagesReplyAll))
  }

  function ui(source: string): string {
    return translateUi(source, normalizeLanguage(deps.getLanguage()))
  }

  return { renderChatHeader }
}

function modeLabel(mode: RoomMode): string {
  return mode === 'collaborative' ? 'Collaborative chat' : 'Independent experts'
}

function chatStatusLabel(status: GroupChat['status']): string {
  const labels: Record<GroupChat['status'], string> = {
    draft: 'Draft',
    initializing: 'Initializing',
    ready: 'Active',
    running: 'Running',
    error: 'Error',
  }
  return labels[status]
}
