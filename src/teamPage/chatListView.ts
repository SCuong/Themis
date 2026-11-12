import { createDefaultStore, loadStore, saveStore } from '../group/store'
import type { GroupChat, GroupRole, OpenTeamStore, RoleTemplate } from '../group/types'
import { normalizeLanguage, translateUi } from '../shared/i18n'
import type { TeamPageState } from './appState'
import { formatChatExportMarkdown, safeChatExportFilename } from './chatExport'
import { askRemoteDelete, chatGroupLabel, reportRemoteDelete, type RemoteDeleteResult } from './remoteDeletePrompt'
import type { RuntimeResponse } from './runtimeClient'

interface ChatListIframeHost {
  removeChat(chatId: string): void
  restoreChat(chat: GroupChat, roles: GroupRole[]): void
}

export interface ChatListViewDependencies {
  state: TeamPageState
  getStore(): OpenTeamStore
  applyStore(store: OpenTeamStore): void
  storeSummaryEl: HTMLElement
  chatListEl: HTMLElement
  iframeHost: ChatListIframeHost
  getTemplates(): RoleTemplate[]
  getChatRecentSummary(chat: GroupChat): string
  roleToneClass(value: string): string
  roleAvatarLabel(value: string): string
  emptyCard(title: string, body: string): HTMLElement
  renderSelectedChat(): void
  renderRolePanel(): void
  sendRuntimeMessage<T>(type: string, payload?: Record<string, unknown>): Promise<RuntimeResponse<T>>
  runCommand(type: string, payload?: Record<string, unknown>): Promise<void>
  log: {
    warn(event: string, details?: Record<string, unknown>): void
  }
  showError(message: string): void
  showSuccess(message: string): void
}

export interface ChatListView {
  renderChatList(): void
  switchChat(chatId: string): void
}

export function createChatListView(deps: ChatListViewDependencies): ChatListView {
  function renderChatList() {
    const store = deps.getStore()
    const chats = store.chatOrder.map(chatId => store.chatsById[chatId]).filter((chat): chat is GroupChat => Boolean(chat))
    deps.storeSummaryEl.textContent = language() === 'en'
      ? `${chats.length} ${chats.length === 1 ? 'chat' : 'chats'} · ${deps.getTemplates().length} people`
      : `${chats.length} chat · ${deps.getTemplates().length} nhân vật`
    deps.chatListEl.replaceChildren()

    if (chats.length === 0) {
      deps.chatListEl.append(deps.emptyCard(ui('No chats yet'), ui('Create a chat above, then add people from the library.')))
      return
    }

    // Newest first, under date headings. The name is the row's focusable button; re-rendering keeps focus on it.
    let groupLabel: string | undefined
    for (const chat of [...chats].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))) {
      const label = chatGroupLabel(chat.updatedAt, language() === 'en')
      if (label !== groupLabel) {
        groupLabel = label
        const heading = document.createElement('h3')
        heading.className = 'chat-group-label'
        heading.textContent = label
        deps.chatListEl.append(heading)
      }
      const item = document.createElement('section')
      const hasActivity = chat.id !== deps.state.selectedChatId && Boolean(store.viewState?.chatHasNewMessageById?.[chat.id])
      item.className = `chat-item${chat.id === deps.state.selectedChatId ? ' active' : ''}${hasActivity ? ' has-activity' : ''}`
      item.dataset.chatId = chat.id
      item.addEventListener('click', () => {
        switchChat(chat.id)
        if (!deps.chatListEl.closest('[inert]')) focusInRow(chat.id, '.chat-name')
      })

      const avatar = document.createElement('div')
      avatar.className = `chat-avatar ${deps.roleToneClass(chat.name)}`
      avatar.textContent = deps.roleAvatarLabel(chat.name)

      const body = document.createElement('div')
      body.className = 'chat-item-body'

      const row = document.createElement('div')
      row.className = 'chat-row chat-item-title'
      const name = document.createElement('button')
      name.type = 'button'
      name.className = 'chat-name'
      name.textContent = chat.name
      name.setAttribute('aria-current', String(chat.id === deps.state.selectedChatId))
      const menuButton = document.createElement('button')
      menuButton.type = 'button'
      menuButton.className = 'icon-btn chat-menu-btn'
      menuButton.setAttribute('aria-label', language() === 'en' ? `Open chat menu for ${chat.name}` : `Open ${chat.name} 's group chat menu`)
      menuButton.textContent = '⋯'
      menuButton.setAttribute('aria-expanded', String(deps.state.chatMenuChatId === chat.id))
      menuButton.addEventListener('click', event => {
        event.stopPropagation()
        deps.state.chatMenuChatId = deps.state.chatMenuChatId === chat.id ? undefined : chat.id
        renderChatList()
        focusInRow(chat.id, '.chat-menu-btn')
      })
      row.append(name)

      const summary = document.createElement('div')
      summary.className = 'summary-line'
      summary.textContent = deps.getChatRecentSummary(chat)

      body.append(row, summary)

      const side = document.createElement('div')
      side.className = 'chat-item-side'
      side.append(menuButton)

      item.append(avatar, body, side)
      if (deps.state.chatMenuChatId === chat.id) item.append(chatActionMenu(chat))
      deps.chatListEl.append(item)
    }
  }

  function focusInRow(chatId: string, selector: string) {
    deps.chatListEl.querySelector<HTMLElement>(`[data-chat-id="${CSS.escape(chatId)}"] ${selector}`)?.focus({ preventScroll: true })
  }

  function switchChat(chatId: string) {
    if (chatId === deps.state.selectedChatId) {
      deps.state.chatMenuChatId = undefined
      deps.state.roleSiteMenuRoleId = undefined
      renderChatList()
      deps.renderRolePanel()
      return
    }
    deps.state.selectedChatId = chatId
    deps.state.selectedRoleId = undefined
    deps.state.selectedReference = undefined
    deps.state.peopleDrawerOpen = false
    deps.state.chatMenuChatId = undefined
    deps.state.roleSiteMenuRoleId = undefined
    deps.renderSelectedChat()
    if (deps.state.pendingSwitchAnimationFrame !== undefined) window.cancelAnimationFrame(deps.state.pendingSwitchAnimationFrame)
    deps.state.pendingSwitchAnimationFrame = window.requestAnimationFrame(() => {
      deps.state.pendingSwitchAnimationFrame = undefined
      if (deps.state.selectedChatId !== chatId) return
      deps.runCommand('GROUP_CHAT_SWITCH', { chatId })
        .catch(error => deps.showError(error.message))
    })
  }

  function chatActionMenu(chat: GroupChat): HTMLElement {
    const menu = document.createElement('div')
    menu.className = 'chat-action-menu'
    menu.addEventListener('click', event => event.stopPropagation())
    const rename = document.createElement('button')
    rename.type = 'button'
    rename.className = 'btn btn-ghost'
    rename.textContent = ui('Edit name')
    rename.addEventListener('click', () => {
      const nextName = window.prompt(ui('Edit name'), chat.name)?.trim()
      deps.state.chatMenuChatId = undefined
      if (!nextName) {
        renderChatList()
        return
      }
      deps.runCommand('GROUP_CHAT_UPDATE', { chatId: chat.id, patch: { name: nextName } }).catch(error => deps.showError(error.message))
    })
    const duplicate = document.createElement('button')
    duplicate.type = 'button'
    duplicate.className = 'btn btn-ghost'
    duplicate.textContent = ui('Duplicate chat')
    duplicate.addEventListener('click', () => {
      deps.state.chatMenuChatId = undefined
      renderChatList()
      deps.runCommand('GROUP_CHAT_DUPLICATE', { chatId: chat.id }).catch(error => deps.showError(error.message))
    })
    const exportRecord = document.createElement('button')
    exportRecord.type = 'button'
    exportRecord.className = 'btn btn-ghost'
    exportRecord.textContent = ui('Export records')
    exportRecord.addEventListener('click', () => {
      deps.state.chatMenuChatId = undefined
      renderChatList()
      exportChatRecord(chat)
    })
    const clearMessages = document.createElement('button')
    clearMessages.type = 'button'
    clearMessages.className = 'btn btn-ghost'
    clearMessages.textContent = ui('Clear messages')
    clearMessages.addEventListener('click', () => {
      deps.state.chatMenuChatId = undefined
      renderChatList()
      if (!window.confirm(`Clear messages in “${chat.name}”? Agents will be kept, but all iframes will be recreated.`)) return
      clearChatMessages(chat.id).catch(error => deps.showError(error.message))
    })
    const closeFrames = document.createElement('button')
    closeFrames.type = 'button'
    closeFrames.className = 'btn btn-ghost'
    closeFrames.textContent = ui('Close chat')
    closeFrames.addEventListener('click', () => {
      deps.state.chatMenuChatId = undefined
      renderChatList()
      closeChatFrames(chat.id).catch(error => deps.showError(error.message))
    })
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'btn btn-ghost btn-danger'
    remove.textContent = ui('Delete chat')
    remove.addEventListener('click', () => {
      deps.state.chatMenuChatId = undefined
      renderChatList()
      if (!window.confirm(`Delete “${chat.name}”? This will remove all messages and roles in this group chat.`)) return
      deleteChat(chat.id, askRemoteDelete(deps.getStore(), chat)).catch(error => deps.showError(error.message))
    })
    menu.append(rename, duplicate, exportRecord, clearMessages, closeFrames, remove)
    return menu
  }

  function language() {
    return normalizeLanguage(deps.getStore().settings.language)
  }

  function ui(source: string): string {
    return translateUi(source, language())
  }

  function exportChatRecord(chat: GroupChat): void {
    try {
      const exportedAt = new Date()
      const markdown = formatChatExportMarkdown(deps.getStore(), chat, exportedAt)
      const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = safeChatExportFilename(chat.name, exportedAt)
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 0)
    } catch (error) {
      deps.showError(error instanceof Error ? error.message : 'Failed to export group chat history')
    }
  }

  async function clearChatMessages(chatId: string): Promise<void> {
    await deps.runCommand('GROUP_CHAT_CLEAR_MESSAGES', { chatId })
    deps.state.messageNodeCache.clear()
    deps.iframeHost.removeChat(chatId)
    const store = deps.getStore()
    const chat = store.chatsById[chatId]
    if (chat && deps.state.selectedChatId === chatId) {
      const roles = chat.roleIds.map(roleId => store.rolesById[roleId]).filter((role): role is GroupRole => Boolean(role) && role.modelSource !== 'external')
      deps.iframeHost.restoreChat({ ...chat, roleIds: roles.map(role => role.id) }, roles)
    }
  }

  async function closeChatFrames(chatId: string): Promise<void> {
    await deps.runCommand('GROUP_CHAT_CLOSE', { chatId })
    deps.iframeHost.removeChat(chatId)
  }

  async function deleteChat(chatId: string, deleteRemote: boolean): Promise<void> {
    const response: RuntimeResponse & { remoteDeletes?: RemoteDeleteResult[] } = await deps.sendRuntimeMessage('GROUP_CHAT_DELETE', { chatId, deleteRemote: deleteRemote === true })
    reportRemoteDelete(response.remoteDeletes, deps)
    if (response.ok === false) {
      if (response.error === 'Unknown Themis message') {
        deps.log.warn('chat-delete:fallback-local-store', { chatId, error: response.error })
        await deleteChatFromLocalStore(chatId)
        return
      }
      throw new Error(response.error || 'Failed to delete group chat')
    }
    deps.iframeHost.removeChat(chatId)
    deps.applyStore(response.store ?? createDefaultStore())
  }

  async function deleteChatFromLocalStore(chatId: string): Promise<void> {
    const nextStore = await loadStore()
    const chat = nextStore.chatsById[chatId]
    if (!chat) throw new Error(`Group chat not found:${chatId}`)

    for (const roleId of chat.roleIds) delete nextStore.rolesById[roleId]
    for (const messageId of chat.messageIds) delete nextStore.messagesById[messageId]
    nextStore.chatOrder = nextStore.chatOrder.filter(id => id !== chat.id)
    delete nextStore.chatsById[chat.id]
    if (nextStore.currentChatId === chat.id) nextStore.currentChatId = nextStore.chatOrder[0]
    if (nextStore.viewState?.chatReadSeqById) delete nextStore.viewState.chatReadSeqById[chat.id]
    if (nextStore.viewState?.chatHasNewMessageById) delete nextStore.viewState.chatHasNewMessageById[chat.id]

    await saveStore(nextStore)
    deps.iframeHost.removeChat(chatId)
    deps.applyStore(nextStore)
  }

  return { renderChatList, switchChat }
}
