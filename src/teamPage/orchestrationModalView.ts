import { BUILTIN_ORCHESTRATION_TEMPLATES, getBuiltinOrchestrationTemplate, type BuiltinOrchestrationTemplate, type OrchestrationTemplateCategory, type OrchestrationTemplateRole } from '../group/orchestrationTemplates'
import type { ChatSite, ExternalModelConfig, GroupChat, GroupRole, OpenTeamStore, OrchestrationAutoPlanHistoryEntry, OrchestrationFlow, OrchestrationGraphSnapshot, OrchestrationStage } from '../group/types'
import { DEFAULT_ORCHESTRATION_MAX_NODE_EXECUTIONS, DEFAULT_ORCHESTRATION_REVIEW_MAX_ATTEMPTS, MAX_ORCHESTRATION_MAX_NODE_EXECUTIONS } from '../group/types'
import { arrangeOrchestrationGraph, createOrchestrationCanvas, reviewEdgeBranch, type LoadX6, type OrchestrationCanvas } from './orchestrationCanvas'
import { appendStageConnections } from '../../team-ui.js'
import { normalizeLanguage } from '../shared/i18n'
import { runCommandWithReconnect } from './sendWithReconnect'
import { applyTeamLanguage } from './languageController'

export interface OrchestrationModalDependencies {
  openOrchestrationEl: HTMLButtonElement
  orchestrationModalEl: HTMLElement
  orchestrationAutoModalEl: HTMLElement
  closeOrchestrationEl: HTMLButtonElement
  orchestrationTaskEl: HTMLTextAreaElement
  autoOrchestrationEl: HTMLButtonElement
  openOrchestrationTemplateEl: HTMLButtonElement
  orchestrationTemplateModalEl: HTMLElement
  closeOrchestrationTemplateEl: HTMLButtonElement
  orchestrationTemplateContentEl: HTMLElement
  closeAutoOrchestrationEl: HTMLButtonElement
  orchestrationAutoContentEl: HTMLElement
  orchestrationPeopleListEl: HTMLElement
  arrangeOrchestrationEl: HTMLButtonElement
  orchestrationCanvasEl: HTMLElement
  orchestrationHintEl: HTMLElement
  orchestrationStageSettingsEl: HTMLElement
  orchestrationReviewSettingsEl: HTMLElement
  orchestrationMaxRoundsEl: HTMLInputElement
  saveOrchestrationEl: HTMLButtonElement
  runOrchestrationEl: HTMLButtonElement
  getStore(): OpenTeamStore
  applyStore(store: OpenTeamStore): void
  getCurrentChat(): GroupChat | undefined
  getCurrentRoles(): GroupRole[]
  reconnectRolesForSend(chat: GroupChat, roles: GroupRole[]): Promise<void>
  sendRuntimeMessage<T>(type: string, payload?: Record<string, unknown>): Promise<{ ok?: boolean; error?: string; store?: OpenTeamStore; flow?: OrchestrationFlow; roles?: GroupRole[]; createdRoleIds?: string[]; reusedRoleIds?: string[]; data?: T }>
  runCommand(type: string, payload?: Record<string, unknown>): Promise<void>
  openExternalModels(): void
  showError(message: string): void
  showSuccess(message: string): void
  loadX6?: LoadX6
}

export interface OrchestrationModalView {
  close(): void
  render(): void
  registerOrchestrationEvents(): void
  handleRuntimeMessage(message: unknown): boolean
}

interface FlowDraft {
  flowId?: string
  task: string
  stages: OrchestrationStage[]
  graphEdges: OrchestrationGraphSnapshot['edges']
  autoPlanHistory: OrchestrationAutoPlanHistoryEntry[]
  maxNodeExecutions: number
  selectedStageId?: string
}

export function createOrchestrationModalView(deps: OrchestrationModalDependencies): OrchestrationModalView {
  let draft: FlowDraft = emptyDraft()
  let canvas: OrchestrationCanvas | undefined
  let mounted = false
  let saving = false
  let running = false
  let autoGenerating = false
  let applyingTemplate = false
  let autoPanelOpen = false
  let autoInstruction = ''
  let autoStreamId: string | undefined
  let autoPendingUserContent = ''
  let autoStreamingAssistantContent = ''
  const templateManagedRoleIds = new Set<string>()
  const externalApiRequiredMessage = 'Orchestration requires an external model API. Configure an external model first.'

  function emptyDraft(): FlowDraft {
    return { task: '', stages: [], graphEdges: [], autoPlanHistory: [], maxNodeExecutions: DEFAULT_ORCHESTRATION_MAX_NODE_EXECUTIONS }
  }

  function open(): void {
    const chat = deps.getCurrentChat()
    if (!chat) {
      deps.showError('Select a group chat before orchestrating a task')
      return
    }
    loadDraft(chat)
    deps.orchestrationModalEl.hidden = false
    deps.openOrchestrationTemplateEl.textContent = 'Template'
    deps.orchestrationTaskEl.value = draft.task
    deps.orchestrationMaxRoundsEl.value = String(draft.maxNodeExecutions)
    deps.orchestrationMaxRoundsEl.max = String(MAX_ORCHESTRATION_MAX_NODE_EXECUTIONS)
    mountCanvas()
    render()
    deps.orchestrationTaskEl.focus()
  }

  function close(): void {
    deps.orchestrationModalEl.hidden = true
    autoPanelOpen = false
    autoInstruction = ''
    clearAutoStreamingState()
    removeAutoPanel()
    closeTemplatePicker()
    canvas?.destroy()
    canvas = undefined
    mounted = false
    draft = emptyDraft()
  }

  function loadDraft(chat: GroupChat): void {
    const store = deps.getStore()
    const flowId = store.orchestrationFlowOrderByChatId[chat.id]?.[0]
    const flow = flowId ? store.orchestrationFlowsById[flowId] : undefined
    if (!flow) {
      draft = emptyDraft()
      return
    }
    const stages = cloneStages(flow.graph?.stageNodes?.length ? flow.graph.stageNodes : flow.stages)
    draft = {
      flowId: flow.id,
      task: flow.description?.trim() ?? '',
      stages,
      graphEdges: flow.graph?.edges ? cloneGraphEdges(flow.graph.edges) : sequentialGraphEdges(stages),
      autoPlanHistory: cloneAutoPlanHistory(flow.autoPlanHistory ?? []),
      maxNodeExecutions: clampMaxNodeExecutions(flow.maxNodeExecutions ?? DEFAULT_ORCHESTRATION_MAX_NODE_EXECUTIONS),
      selectedStageId: undefined,
    }
  }

  function mountCanvas(): void {
    canvas?.destroy()
    canvas = createOrchestrationCanvas({
      rootEl: deps.orchestrationCanvasEl,
      getRoleName,
      getRoleSiteLabel,
      onStageSelected(stageId, keyboard) {
        draft.selectedStageId = stageId
        renderStageSettings()
        canvas?.selectStage(stageId)
        if (keyboard) deps.orchestrationStageSettingsEl.querySelector('select')?.focus()
      },
      onRoleDropped(roleId) {
        addRoleAsStage(roleId)
      },
      onGraphChanged(edges) {
        draft.graphEdges = cloneGraphEdges(edges)
        renderStageSettings()
      },
      loadX6: deps.loadX6,
    })
    canvas.mount(draft.stages, draft.selectedStageId, draft.graphEdges).then(() => {
      mounted = true
    }).catch(error => deps.showError(error instanceof Error ? error.message : String(error)))
  }

  function render(): void {
    if (deps.orchestrationModalEl.hidden) return
    draft.maxNodeExecutions = clampMaxNodeExecutions(Number(deps.orchestrationMaxRoundsEl.value || DEFAULT_ORCHESTRATION_MAX_NODE_EXECUTIONS))
    deps.orchestrationHintEl.hidden = draft.stages.length > 0
    deps.orchestrationHintEl.textContent = document.documentElement.lang === 'en' ? 'Choose a teammate to add a node. Link nodes from their settings or connect their ports.' : 'Chọn thành viên để thêm nút. Nối nút trong phần cài đặt hoặc nối trực tiếp các cổng.'
    renderPeopleList()
    renderStageSettings()
    renderAutoPanel()
    if (mounted) canvas?.render(draft.stages, draft.selectedStageId, draft.graphEdges)
    applyTeamLanguage(normalizeLanguage(deps.getStore().settings.language), deps.orchestrationModalEl)
  }

  function renderPeopleList(): void {
    const roles = deps.getCurrentRoles()
    deps.orchestrationPeopleListEl.replaceChildren()
    if (roles.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'empty-card compact'
      empty.textContent = 'This group chat has no agents. Cannot orchestrate a task.'
      deps.orchestrationPeopleListEl.append(empty)
      return
    }
    for (const role of roles) {
      // A button, so a teammate can be added to the canvas without dragging.
      const card = document.createElement('button')
      card.className = 'orchestration-person'
      card.type = 'button'
      card.dataset.roleId = role.id
      card.title = document.documentElement.lang === 'en' ? `Add ${role.name} to the canvas` : `Thêm ${role.name} vào sơ đồ`
      card.draggable = true
      card.addEventListener('click', () => {
        addRoleAsStage(role.id)
        deps.orchestrationPeopleListEl.querySelector<HTMLElement>(`[data-role-id="${CSS.escape(role.id)}"]`)?.focus({ preventScroll: true })
        canvas?.fitView()
      })
      card.addEventListener('dragstart', event => {
        event.dataTransfer?.setData('application/x-themis-role-id', role.id)
      })
      const avatar = document.createElement('span')
      avatar.className = `orchestration-person-avatar ${roleToneClass(role.id)}`
      avatar.textContent = roleInitial(role.name)
      const body = document.createElement('div')
      body.className = 'orchestration-person-body'
      const row = document.createElement('div')
      row.className = 'orchestration-person-title'
      const name = document.createElement('strong')
      name.textContent = role.name
      row.append(name, roleSitePill(role))
      const description = document.createElement('span')
      description.className = 'tiny'
      description.textContent = role.description || ''
      body.append(row)
      if (role.description) body.append(description)
      card.append(avatar, body)
      deps.orchestrationPeopleListEl.append(card)
    }
  }

  function openTemplatePicker(): void {
    if (deps.orchestrationModalEl.hidden) return
    deps.orchestrationTemplateModalEl.hidden = false
    renderTemplatePicker()
    deps.orchestrationTemplateContentEl.querySelector<HTMLButtonElement>('.orchestration-template-card')?.focus()
  }

  function closeTemplatePicker(): void {
    deps.orchestrationTemplateModalEl.hidden = true
    deps.orchestrationTemplateContentEl.replaceChildren()
  }

  function renderTemplatePicker(): void {
    deps.orchestrationTemplateContentEl.replaceChildren()
    const panel = document.createElement('section')
    panel.className = 'orchestration-template-panel'
    const heading = document.createElement('div')
    heading.className = 'orchestration-template-heading'
    const title = document.createElement('h3')
    title.textContent = 'Start from a template'
    const subtitle = document.createElement('span')
    subtitle.className = 'tiny'
    subtitle.textContent = 'Select a template to generate a draft you can continue editing.'
    heading.append(title, subtitle)
    panel.append(heading)

    for (const category of ['structure', 'scenario'] as const) {
      const group = document.createElement('div')
      group.className = 'orchestration-template-group'
      const groupTitle = document.createElement('span')
      groupTitle.className = 'orchestration-template-group-title'
      groupTitle.textContent = templateCategoryLabel(category)
      const list = document.createElement('div')
      list.className = 'orchestration-template-list'
      for (const template of BUILTIN_ORCHESTRATION_TEMPLATES.filter(item => item.category === category)) {
        list.append(templateCard(template))
      }
      group.append(groupTitle, list)
      panel.append(group)
    }

    deps.orchestrationTemplateContentEl.append(panel)
    applyTeamLanguage(normalizeLanguage(deps.getStore().settings.language), deps.orchestrationTemplateModalEl)
  }

  function templateCard(template: BuiltinOrchestrationTemplate): HTMLElement {
    const button = document.createElement('button')
    button.className = 'orchestration-template-card'
    button.type = 'button'
    button.dataset.templateId = template.id
    button.disabled = saving || running || autoGenerating || applyingTemplate
    button.addEventListener('click', () => applyTemplate(template.id).catch(error => deps.showError(error instanceof Error ? error.message : String(error))))

    const top = document.createElement('span')
    top.className = 'orchestration-template-card-top'
    const name = document.createElement('strong')
    name.textContent = template.name
    const tags = document.createElement('span')
    tags.className = 'orchestration-template-tags'
    tags.textContent = template.capabilities.map(templateCapabilityLabel).join(' · ')
    top.append(name, tags)

    const summary = document.createElement('span')
    summary.className = 'orchestration-template-summary'
    summary.textContent = template.summary
    const structure = document.createElement('span')
    structure.className = 'orchestration-template-structure'
    structure.textContent = template.structure
    button.append(top, summary, structure)
    return button
  }

  function roleSitePill(role: GroupRole): HTMLElement {
    const model = roleModelDisplay(role, deps.getStore())
    const pill = document.createElement('span')
    pill.className = `site-pill orchestration-person-site ${model.className}`
    pill.textContent = model.label
    return pill
  }

  function renderStageSettings(): void {
    const selected = selectedStage()
    deps.orchestrationStageSettingsEl.replaceChildren()
    deps.orchestrationReviewSettingsEl.replaceChildren()
    const settingsPanel = deps.orchestrationStageSettingsEl.closest<HTMLElement>('.orchestration-settings')
    const layout = deps.orchestrationStageSettingsEl.closest<HTMLElement>('.orchestration-layout')
    settingsPanel?.toggleAttribute('hidden', !selected)
    layout?.classList.toggle('settings-hidden', !selected)
    if (!selected) {
      return
    }

    const header = document.createElement('div')
    header.className = 'orchestration-node-editor-header'
    const title = document.createElement('h3')
    title.textContent = selected.kind === 'review' ? 'Review node' : 'Execution node'
    const closeButton = document.createElement('button')
    closeButton.className = 'icon-btn orchestration-node-editor-close'
    closeButton.type = 'button'
    closeButton.ariaLabel = 'Close node settings'
    closeButton.textContent = '×'
    closeButton.addEventListener('click', clearSelectedStage)
    header.append(title, closeButton)
    const kindField = document.createElement('label')
    kindField.className = 'field'
    kindField.textContent = 'Node type'
    const kindSelect = document.createElement('select')
    kindSelect.dataset.stageKind = 'true'
    kindSelect.append(new Option('Execute', 'roles'), new Option('Review', 'review'))
    kindSelect.value = selected.kind
    kindSelect.addEventListener('change', () => {
      setStageKind(selected, kindSelect.value === 'review' ? 'review' : 'roles')
    })
    kindField.append(kindSelect)
    const nameField = document.createElement('label')
    nameField.className = 'field'
    nameField.textContent = 'Node name'
    const nameInput = document.createElement('input')
    nameInput.value = selected.name
    nameInput.addEventListener('input', () => {
      selected.name = nameInput.value.trim() || (selected.kind === 'review' ? 'Review' : 'Execution node')
      canvas?.render(draft.stages, draft.selectedStageId, draft.graphEdges)
    })
    nameField.append(nameInput)
    const descriptionField = document.createElement('label')
    descriptionField.className = 'field'
    descriptionField.textContent = 'Task description'
    const descriptionInput = document.createElement('textarea')
    descriptionInput.value = selected.description ?? ''
    descriptionInput.placeholder = 'Add instructions for this node, for example: clarify the goal first, then output only priorities and risks.'
    descriptionInput.addEventListener('input', () => {
      const description = descriptionInput.value.trim()
      if (description) selected.description = description
      else delete selected.description
    })
    descriptionField.append(descriptionInput)
    const rolesField = document.createElement('div')
    rolesField.className = 'field'
    rolesField.textContent = selected.kind === 'review' ? 'Reviewer' : 'Executor'
    const roles = document.createElement('div')
    roles.className = 'stage-role-chips'
    for (const roleId of selectedRoleIds(selected)) roles.append(roleChip(roleId))
    rolesField.append(roles)
    const autoRoleSiteField = autoGeneratedRoleSettingsField(selected)
    const remove = document.createElement('button')
    remove.className = 'btn btn-danger'
    remove.type = 'button'
    remove.textContent = 'Delete node'
    remove.addEventListener('click', () => removeStage(selected.id))
    deps.orchestrationStageSettingsEl.append(header, kindField, nameField, descriptionField, rolesField)
    if (autoRoleSiteField) deps.orchestrationStageSettingsEl.append(autoRoleSiteField)
    // team-ui.js: link this node to others from a list, an alternative to dragging ports on the canvas.
    appendStageConnections(
      deps.orchestrationStageSettingsEl,
      selected,
      draft.stages,
      draft.graphEdges,
      (edges: OrchestrationGraphSnapshot['edges']) => {
        draft.graphEdges = cloneGraphEdges(edges)
        canvas?.render(draft.stages, draft.selectedStageId, draft.graphEdges)
      },
      normalizeLanguage(deps.getStore().settings.language),
      (edge: OrchestrationGraphSnapshot['edges'][number]) => selected.kind === 'review' ? reviewEdgeBranch(edge, draft.stages) : undefined,
    )
    deps.orchestrationStageSettingsEl.append(remove)

    if (selected.kind === 'review') renderReviewSettings(selected)
    applyTeamLanguage(normalizeLanguage(deps.getStore().settings.language), deps.orchestrationStageSettingsEl.closest('.orchestration-settings')!)
  }

  function renderReviewSettings(stage: OrchestrationStage): void {
    const intro = settingsNote('A review node uses one group chat agent to decide pass or fail against the criteria.')
    const criteriaField = document.createElement('label')
    criteriaField.className = 'field'
    criteriaField.textContent = 'Review criteria'
    const criteria = document.createElement('textarea')
    criteria.value = stage.review?.instructions ?? ''
    criteria.placeholder = 'For example: the answer must cover risks, a solution, and next steps. Return fail if these requirements are not met.'
    criteria.addEventListener('input', () => {
      stage.review = normalizedReviewConfig(stage, { instructions: criteria.value })
    })
    criteriaField.append(criteria)
    const attemptsField = document.createElement('label')
    attemptsField.className = 'field'
    attemptsField.textContent = 'Maximum review attempts'
    const attemptsInput = document.createElement('input')
    attemptsInput.type = 'number'
    attemptsInput.min = '1'
    attemptsInput.max = '50'
    attemptsInput.value = String(stage.review?.maxAttempts ?? DEFAULT_ORCHESTRATION_REVIEW_MAX_ATTEMPTS)
    attemptsInput.addEventListener('input', () => {
      stage.review = normalizedReviewConfig(stage, { maxAttempts: clampReviewAttempts(Number(attemptsInput.value || DEFAULT_ORCHESTRATION_REVIEW_MAX_ATTEMPTS)) })
    })
    attemptsField.append(attemptsInput)
    const actionField = document.createElement('label')
    actionField.className = 'field'
    actionField.textContent = 'When the limit is reached'
    const actionSelect = document.createElement('select')
    actionSelect.append(new Option('Stop workflow', 'stop'), new Option('Continue to the next node', 'continue'))
    actionSelect.value = stage.review?.onMaxAttempts ?? 'stop'
    actionSelect.addEventListener('change', () => {
      stage.review = normalizedReviewConfig(stage, { onMaxAttempts: actionSelect.value === 'continue' ? 'continue' : 'stop' })
    })
    actionField.append(actionSelect)
    const preview = document.createElement('div')
    preview.className = 'orchestration-json-preview'
    const previewTitle = document.createElement('span')
    previewTitle.className = 'tiny'
    previewTitle.textContent = 'Review response JSON preview'
    const schema = document.createElement('pre')
    schema.textContent = '{\n  "decision": "pass | fail",\n  "reason": "Review explanation",\n  "failedCriteria": [],\n  "nextRoundInstruction": "Retry instructions if review fails"\n}'
    preview.append(previewTitle, schema)
    deps.orchestrationReviewSettingsEl.append(intro, criteriaField, attemptsField, actionField, preview)
  }

  function settingsNote(message: string): HTMLElement {
    const note = document.createElement('p')
    note.className = 'tiny orchestration-note'
    note.textContent = message
    return note
  }

  function roleChip(roleId: string): HTMLElement {
    const chip = document.createElement('span')
    chip.className = 'stage-role-chip'
    chip.textContent = getRoleName(roleId)
    return chip
  }

  function autoGeneratedRoleSettingsField(stage: OrchestrationStage): HTMLElement | undefined {
    const editableRoles = selectedRoleIds(stage)
      .map(roleId => deps.getStore().rolesById[roleId])
      .filter((role): role is GroupRole => Boolean(role) && isGeneratedEditableRole(role) && role.modelSource !== 'external')
    if (editableRoles.length === 0) return undefined

    const field = document.createElement('div')
    field.className = 'field orchestration-auto-role-sites'
    const title = document.createElement('span')
    title.textContent = editableRoles.length > 1 ? 'Generated agent settings' : 'Generated agent settings'
    field.append(title)

    for (const role of editableRoles) {
      const row = document.createElement('label')
      row.className = 'orchestration-auto-role-site-row'
      const name = document.createElement('span')
      name.textContent = role.name
      const select = document.createElement('select')
      for (const site of editableChatSites()) select.append(new Option(siteLabel(site), site))
      select.value = visibleChatSite(role.chatSite ?? deps.getStore().settings.defaultChatSite)
      select.addEventListener('change', () => {
        updateAutoGeneratedRoleSite(role.id, select.value as ChatSite).catch(error => {
          deps.showError(error instanceof Error ? error.message : String(error))
          renderStageSettings()
        })
      })
      row.append(name, select)
      field.append(row)

      const promptRow = document.createElement('label')
      promptRow.className = 'orchestration-auto-role-prompt-row'
      const promptTitle = document.createElement('span')
      promptTitle.textContent = `${role.name} persona prompt`
      const promptInput = document.createElement('textarea')
      promptInput.className = 'orchestration-auto-role-prompt'
      promptInput.value = role.systemPrompt ?? ''
      promptInput.placeholder = 'Edit only personas generated by automatic orchestration. Existing group members are not changed here.'
      promptInput.addEventListener('change', () => {
        updateAutoGeneratedRolePrompt(role.id, promptInput.value).catch(error => {
          deps.showError(error instanceof Error ? error.message : String(error))
          renderStageSettings()
        })
      })
      promptRow.append(promptTitle, promptInput)
      field.append(promptRow)
    }
    return field
  }

  async function updateAutoGeneratedRoleSite(roleId: string, chatSite: ChatSite): Promise<void> {
    const role = deps.getStore().rolesById[roleId]
    if (!role || !isGeneratedEditableRole(role)) throw new Error('Only agents generated by orchestration can have their site changed here')
    if (role.modelSource === 'external') throw new Error('External model agents cannot switch web sites')
    await deps.runCommand('GROUP_ROLE_UPDATE', { roleId, patch: { modelSource: 'site', chatSite } })
    deps.showSuccess('Agent site updated')
    render()
  }

  async function updateAutoGeneratedRolePrompt(roleId: string, systemPrompt: string): Promise<void> {
    const role = deps.getStore().rolesById[roleId]
    if (!role || !isGeneratedEditableRole(role)) throw new Error('Only agents generated by orchestration can have their persona changed here')
    await deps.runCommand('GROUP_ROLE_UPDATE', { roleId, patch: { systemPrompt } })
    deps.showSuccess('Agent persona updated')
    render()
  }

  function selectedRoleIds(stage: OrchestrationStage): string[] {
    if (stage.kind === 'review') return stage.review?.reviewerRoleIds.length ? stage.review.reviewerRoleIds : stage.roleIds
    return stage.roleIds
  }

  function addRoleAsStage(roleId: string): void {
    const stage: OrchestrationStage = { id: newId('stage'), kind: 'roles', name: getRoleName(roleId), roleIds: [roleId] }
    const reviewIndex = draft.stages.findIndex(item => item.kind === 'review')
    if (reviewIndex >= 0) draft.stages.splice(reviewIndex, 0, stage)
    else draft.stages.push(stage)
    draft.selectedStageId = undefined
    render()
  }

  function setStageKind(stage: OrchestrationStage, kind: OrchestrationStage['kind']): void {
    if (stage.kind === kind) return
    stage.kind = kind
    if (kind === 'review') {
      stage.name = stage.name.trim() || 'Review'
      stage.roleIds = stage.roleIds.slice(0, 1)
      stage.review = normalizedReviewConfig(stage)
    } else {
      delete stage.review
      stage.name = stage.name.trim() || getRoleName(stage.roleIds[0] ?? '') || 'Execute'
    }
    render()
  }

  function removeStage(stageId: string): void {
    draft.stages = draft.stages.filter(stage => stage.id !== stageId)
    draft.graphEdges = draft.graphEdges.filter(edge => edge.sourceStageId !== stageId && edge.targetStageId !== stageId)
    draft.selectedStageId = undefined
    render()
  }

  function clearSelectedStage(): void {
    draft.selectedStageId = undefined
    renderStageSettings()
    canvas?.selectStage(undefined)
  }

  function arrangeCanvas(): void {
    const arranged = arrangeOrchestrationGraph(draft.stages, draft.graphEdges)
    draft.stages = arranged.stages
    draft.graphEdges = arranged.edges
    render()
    canvas?.fitView()
  }

  function openAutoPanel(): void {
    if (!ensureExternalApiConfigured()) return
    autoPanelOpen = true
    renderAutoPanel()
    updateActionButtons()
    deps.orchestrationAutoContentEl.querySelector<HTMLTextAreaElement>('.orchestration-auto-input')?.focus()
  }

  function closeAutoPanel(): void {
    autoPanelOpen = false
    autoInstruction = ''
    clearAutoStreamingState()
    removeAutoPanel()
    updateActionButtons()
  }

  function renderAutoPanel(): void {
    if (!autoPanelOpen || deps.orchestrationModalEl.hidden) {
      removeAutoPanel()
      return
    }
    deps.orchestrationAutoModalEl.hidden = false
    let chat = deps.orchestrationAutoContentEl.querySelector<HTMLElement>('.orchestration-auto-chat')
    if (!chat) {
      chat = document.createElement('section')
      chat.className = 'orchestration-auto-chat'
      deps.orchestrationAutoContentEl.append(chat)
    }
    chat.replaceChildren()

    const messages = document.createElement('div')
    messages.className = 'orchestration-auto-messages'
    const entries = currentAutoChatEntries()
    if (entries.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'orchestration-auto-empty'
      empty.textContent = 'Enter your orchestration requirements. Automatic orchestration will respond as in a web chat.'
      messages.append(empty)
    } else {
      for (const entry of entries) messages.append(renderAutoChatMessage(entry))
    }

    const form = document.createElement('form')
    form.className = 'orchestration-auto-composer'
    form.addEventListener('submit', event => {
      event.preventDefault()
      autoGenerate().catch(error => deps.showError(error instanceof Error ? error.message : String(error)))
    })
    const inputShell = document.createElement('div')
    inputShell.className = 'orchestration-auto-input-shell'
    const textarea = document.createElement('textarea')
    textarea.className = 'orchestration-auto-input'
    textarea.value = autoInstruction
    textarea.placeholder = draft.stages.length > 0 ? 'Continue editing the current workflow...' : 'Enter automatic orchestration requirements...'
    textarea.disabled = autoGenerating || saving || running
    textarea.addEventListener('input', () => {
      autoInstruction = textarea.value
    })
    textarea.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
      event.preventDefault()
      form.requestSubmit()
    })
    const submit = document.createElement('button')
    submit.className = 'btn btn-primary orchestration-auto-submit'
    submit.type = 'submit'
    submit.textContent = autoGenerating ? 'Generating...' : 'Send'
    submit.disabled = autoGenerating || saving || running
    inputShell.append(textarea, submit)
    form.append(inputShell)

    chat.append(messages, form)
    applyTeamLanguage(normalizeLanguage(deps.getStore().settings.language), deps.orchestrationAutoModalEl)
    messages.scrollTop = messages.scrollHeight
  }

  function currentAutoChatEntries(): OrchestrationAutoPlanHistoryEntry[] {
    const entries = cloneAutoPlanHistory(draft.autoPlanHistory)
    if (autoGenerating && autoPendingUserContent) {
      entries.push({ id: 'auto-pending-user', role: 'user', content: autoPendingUserContent, createdAt: Date.now() })
      entries.push({ id: 'auto-pending-assistant', role: 'assistant', content: autoStreamingAssistantContent || '...', createdAt: Date.now() })
    }
    return entries
  }

  function renderAutoChatMessage(entry: OrchestrationAutoPlanHistoryEntry): HTMLElement {
    const message = document.createElement('article')
    message.className = `orchestration-auto-message ${entry.role}`
    const content = document.createElement('div')
    content.className = 'orchestration-auto-message-content'
    content.textContent = entry.content
    message.append(content)
    return message
  }

  function handleRuntimeMessage(message: unknown): boolean {
    if (!isRecord(message)) return false
    if (message.type !== 'GROUP_ORCHESTRATION_AUTO_STREAM_CHUNK') return false
    if (message.streamId !== autoStreamId) return false
    const content = readOptionalString(message.content)
    const chunk = readOptionalString(message.chunk)
    if (!content && !chunk) return true
    autoStreamingAssistantContent = content ?? `${autoStreamingAssistantContent}${chunk ?? ''}`
    renderAutoPanel()
    return true
  }

  function clearAutoStreamingState(): void {
    autoStreamId = undefined
    autoPendingUserContent = ''
    autoStreamingAssistantContent = ''
  }

  function removeAutoPanel(): void {
    deps.orchestrationAutoContentEl.replaceChildren()
    deps.orchestrationAutoModalEl.hidden = true
  }

  async function applyTemplate(templateId: string): Promise<void> {
    if (saving || running || autoGenerating || applyingTemplate) return
    const chat = deps.getCurrentChat()
    const template = getBuiltinOrchestrationTemplate(templateId)
    if (!chat || !template) return
    if (draft.stages.length > 0 && !window.confirm(`Replace the current canvas draft with “${template.name}”?`)) return

    applyingTemplate = true
    updateActionButtons()
    try {
      await removeTemplateCreatedRoles(chat)
      const roleIdsByKey = await resolveTemplateRoleIds(chat, template)
      const stageIdByTemplateId = new Map(template.stages.map(stage => [stage.id, newId('stage')]))
      const stages = template.stages.map(stage => {
        const roleIds = stage.roleKeys.map(roleKey => requireTemplateRoleId(roleIdsByKey, roleKey, template.name))
        const review = stage.review
          ? {
              reviewerRoleIds: stage.review.reviewerRoleKeys.map(roleKey => requireTemplateRoleId(roleIdsByKey, roleKey, template.name)),
              instructions: stage.review.instructions,
              maxAttempts: stage.review.maxAttempts,
              onMaxAttempts: stage.review.onMaxAttempts,
            }
          : undefined
        return {
          id: stageIdByTemplateId.get(stage.id) ?? newId('stage'),
          kind: stage.kind,
          name: stage.name,
          description: stage.description,
          roleIds,
          ...(review ? { review } : {}),
        } satisfies OrchestrationStage
      })
      const edges = template.edges.flatMap(edge => {
        const sourceStageId = stageIdByTemplateId.get(edge.from)
        const targetStageId = stageIdByTemplateId.get(edge.to)
        if (!sourceStageId || !targetStageId) return []
        return [{
          sourceStageId,
          targetStageId,
          ...(edge.sourcePort ? { sourcePort: edge.sourcePort } : {}),
        }]
      })
      const arranged = arrangeOrchestrationGraph(stages, edges)
      const task = deps.orchestrationTaskEl.value.trim() || template.defaultTask
      deps.orchestrationTaskEl.value = task
      draft = {
        flowId: draft.flowId,
        task,
        stages: arranged.stages,
        graphEdges: arranged.edges,
        autoPlanHistory: [],
        maxNodeExecutions: clampMaxNodeExecutions(template.maxNodeExecutions),
        selectedStageId: undefined,
      }
      deps.orchestrationMaxRoundsEl.value = String(draft.maxNodeExecutions)
      deps.showSuccess(`Applied “${template.name}” template`)
      closeTemplatePicker()
      render()
      canvas?.fitView()
    } finally {
      applyingTemplate = false
      updateActionButtons()
    }
  }

  async function removeTemplateCreatedRoles(chat: GroupChat): Promise<void> {
    const templateRoleIds = collectTemplateRoleIdsToDelete(chat)
    for (const roleId of templateRoleIds) {
      await deps.runCommand('GROUP_ROLE_DELETE', { roleId })
      templateManagedRoleIds.delete(roleId)
    }
  }

  function collectTemplateRoleIdsToDelete(chat: GroupChat): string[] {
    const store = deps.getStore()
    const roleIds = new Set<string>()
    for (const roleId of templateManagedRoleIds) {
      const role = store.rolesById[roleId]
      if (!role) {
        templateManagedRoleIds.delete(roleId)
        continue
      }
      if (role.chatId === chat.id) roleIds.add(roleId)
    }
    for (const roleId of chat.roleIds) {
      if (shouldRemoveRoleBeforeApplyingTemplate(roleId)) roleIds.add(roleId)
    }
    return [...roleIds]
  }

  function shouldRemoveRoleBeforeApplyingTemplate(roleId: string): boolean {
    const role = deps.getStore().rolesById[roleId]
    if (!role) return false
    if (role.createdBy === 'orchestration-template') return true
    if (role.createdBy !== 'orchestration-auto') return false
    if (draftGeneratedRoleIds().has(role.id)) return true
    return isBuiltinOrchestrationTemplateRoleName(role.name)
  }

  function draftGeneratedRoleIds(): Set<string> {
    const roleIds = new Set<string>()
    for (const stage of draft.stages) {
      for (const roleId of stage.roleIds) roleIds.add(roleId)
      for (const roleId of stage.review?.reviewerRoleIds ?? []) roleIds.add(roleId)
    }
    return roleIds
  }

  async function resolveTemplateRoleIds(chat: GroupChat, template: BuiltinOrchestrationTemplate): Promise<Map<string, string>> {
    const roleIdsByKey = new Map<string, string>()
    const usedRoleIds = new Set<string>()
    const missingRoles: OrchestrationTemplateRole[] = []
    for (const templateRole of template.roles) {
      const reusable = findReusableTemplateRole(templateRole, deps.getCurrentRoles(), usedRoleIds)
      if (reusable) {
        roleIdsByKey.set(templateRole.key, reusable.id)
        usedRoleIds.add(reusable.id)
      } else {
        missingRoles.push(templateRole)
      }
    }
    if (missingRoles.length === 0) return roleIdsByKey

    const createdRoles = await createTemplateRoles(chat, missingRoles)
    missingRoles.forEach((templateRole, index) => {
      const createdRole = createdRoles[index]
      if (!createdRole) throw new Error(`Template “${template.name}” is missing agents:${templateRole.name}`)
      roleIdsByKey.set(templateRole.key, createdRole.id)
    })
    return roleIdsByKey
  }

  async function createTemplateRoles(chat: GroupChat, roles: OrchestrationTemplateRole[]): Promise<GroupRole[]> {
    const response = await deps.sendRuntimeMessage('GROUP_ROLES_CREATE_BATCH', {
      chatId: chat.id,
      items: roles.map(role => ({
        source: 'temporary',
        createdBy: 'orchestration-template',
        name: role.name,
        description: role.description,
        systemPrompt: role.systemPrompt,
        modelSource: 'site',
        chatSite: 'deepseek',
      })),
    })
    if (response.ok === false) throw new Error(response.error || 'Failed to create template agents')
    if (response.store) deps.applyStore(response.store)
    const createdRoles = response.roles ?? findCreatedTemplateRoles(roles)
    if (createdRoles.length !== roles.length) throw new Error('Failed to create template agents')
    for (const role of createdRoles) templateManagedRoleIds.add(role.id)
    return createdRoles
  }

  function findCreatedTemplateRoles(roles: OrchestrationTemplateRole[]): GroupRole[] {
    const usedRoleIds = new Set<string>()
    return roles.flatMap(role => {
      const reusable = findReusableTemplateRole(role, deps.getCurrentRoles(), usedRoleIds)
      if (!reusable) return []
      usedRoleIds.add(reusable.id)
      return [reusable]
    })
  }

  async function save(): Promise<void> {
    if (saving || running) return
    const chat = deps.getCurrentChat()
    if (!chat || !validateDraft(false)) return
    saving = true
    updateActionButtons()
    try {
      const flow = buildFlow(chat)
      await deps.runCommand('GROUP_ORCHESTRATION_FLOW_SAVE', { chatId: chat.id, flow })
      draft.flowId = flow.id
      deps.showSuccess('Workflow saved')
    } finally {
      saving = false
      updateActionButtons()
    }
  }

  async function run(): Promise<void> {
    if (running || saving) return
    const chat = deps.getCurrentChat()
    const task = deps.orchestrationTaskEl.value.trim()
    if (chat && !ensureExternalApiConfigured()) return
    if (!chat || !validateDraft(true)) return
    if (!task) {
      deps.showError('Enter an orchestration task')
      return
    }
    running = true
    updateActionButtons()
    try {
      const flow = buildFlow(chat)
      await runCommandWithReconnect(deps, { chat, roles: getDraftRoles(), type: 'GROUP_ORCHESTRATION_RUN', payload: { chatId: chat.id, task, flow }, preconnectAll: true })
      draft.flowId = flow.id
      deps.showSuccess('Orchestration task started')
      close()
    } finally {
      running = false
      updateActionButtons()
    }
  }

  async function autoGenerate(): Promise<void> {
    if (autoGenerating || saving || running) return
    const chat = deps.getCurrentChat()
    let task = deps.orchestrationTaskEl.value.trim()
    if (!chat) return
    if (!ensureExternalApiConfigured()) return
    // With the task field empty, the automatic orchestration message is the task.
    if (!task && autoInstruction.trim()) {
      task = autoInstruction.trim()
      deps.orchestrationTaskEl.value = task
    }
    if (!task) {
      deps.showError('Enter an orchestration task')
      return
    }
    const instruction = autoInstruction.trim()
    if (draft.stages.length > 0 && !instruction) {
      deps.showError('Enter an automatic orchestration message')
      return
    }
    const userContent = instruction || task
    autoGenerating = true
    autoStreamId = newId('auto-stream')
    autoPendingUserContent = userContent
    autoStreamingAssistantContent = ''
    autoInstruction = ''
    updateActionButtons()
    renderAutoPanel()
    try {
      const flow = draft.stages.length > 0 ? buildFlow(chat) : undefined
      const payload: Record<string, unknown> = {
        chatId: chat.id,
        task,
        instruction: userContent,
        flowId: draft.flowId,
        history: cloneAutoPlanHistory(draft.autoPlanHistory),
        streamId: autoStreamId,
      }
      if (flow) payload.flow = flow
      const response = await deps.sendRuntimeMessage('GROUP_ORCHESTRATION_AUTO_GENERATE', payload)
      if (response.ok === false) throw new Error(response.error || 'Automatic orchestration failed')
      if (response.store) deps.applyStore(response.store)
      const generatedFlow = response.flow
      if (!generatedFlow) throw new Error('Automatic orchestration did not return a workflow')
      applyGeneratedFlow(generatedFlow)
      clearAutoStreamingState()
      renderAutoPanel()
      deps.showSuccess(autoGenerateSuccessMessage(response.createdRoleIds?.length ?? 0, response.reusedRoleIds?.length ?? 0))
    } finally {
      autoGenerating = false
      updateActionButtons()
      renderAutoPanel()
    }
  }

  function updateActionButtons(): void {
    deps.autoOrchestrationEl.disabled = autoGenerating || saving || running || applyingTemplate
    deps.autoOrchestrationEl.textContent = autoGenerating ? 'Generating...' : 'Automatic orchestration'
    deps.openOrchestrationTemplateEl.disabled = autoGenerating || saving || running || applyingTemplate
    deps.saveOrchestrationEl.disabled = saving || running || autoGenerating || applyingTemplate
    deps.runOrchestrationEl.disabled = saving || running || autoGenerating || applyingTemplate
    if (!deps.orchestrationTemplateModalEl.hidden) renderTemplatePicker()
  }

  function applyGeneratedFlow(flow: OrchestrationFlow): void {
    const stages = cloneStages(flow.graph?.stageNodes?.length ? flow.graph.stageNodes : flow.stages)
    const arranged = arrangeOrchestrationGraph(stages, flow.graph?.edges ? cloneGraphEdges(flow.graph.edges) : sequentialGraphEdges(stages))
    draft = {
      flowId: flow.id,
      task: deps.orchestrationTaskEl.value.trim(),
      stages: arranged.stages,
      graphEdges: arranged.edges,
      autoPlanHistory: cloneAutoPlanHistory(flow.autoPlanHistory ?? []),
      maxNodeExecutions: clampMaxNodeExecutions(flow.maxNodeExecutions ?? DEFAULT_ORCHESTRATION_MAX_NODE_EXECUTIONS),
      selectedStageId: undefined,
    }
    deps.orchestrationMaxRoundsEl.value = String(draft.maxNodeExecutions)
    render()
  }

  function buildFlow(chat: GroupChat): OrchestrationFlow {
    const now = Date.now()
    const graphEdges = filterGraphEdges(draft.graphEdges, draft.stages)
    const stages = orderStagesByGraph(cloneStages(draft.stages), graphEdges)
    const task = deps.orchestrationTaskEl.value.trim()
    return {
      id: draft.flowId ?? newId('flow'),
      chatId: chat.id,
      name: `${chat.name} workflow`,
      description: task || undefined,
      stages,
      graph: {
        stageNodes: stages,
        edges: graphEdges,
      },
      autoPlanHistory: cloneAutoPlanHistory(draft.autoPlanHistory),
      maxNodeExecutions: readMaxNodeExecutionsInput(deps.orchestrationMaxRoundsEl),
      maxRounds: readMaxNodeExecutionsInput(deps.orchestrationMaxRoundsEl),
      createdAt: now,
      updatedAt: now,
    }
  }

  function validateDraft(requireTask: boolean): boolean {
    if (deps.getCurrentRoles().length === 0) {
      deps.showError('This group chat has no agents. Cannot orchestrate a task')
      return false
    }
    if (requireTask && !deps.orchestrationTaskEl.value.trim()) {
      deps.showError('Enter an orchestration task')
      return false
    }
    if (draft.stages.length === 0) {
      deps.showError('Add at least one workflow node')
      return false
    }
    if (draft.stages.some(stage => stage.roleIds.length === 0)) {
      deps.showError('Each node needs at least one agent')
      return false
    }
    const review = draft.stages.find(stage => stage.kind === 'review')
    if (review && (!review.review?.reviewerRoleIds.length || !review.review.instructions?.trim())) {
      deps.showError('Review nodes require a reviewer and review criteria')
      return false
    }
    const rawMaxNodeExecutions = Number(deps.orchestrationMaxRoundsEl.value)
    if (!Number.isFinite(rawMaxNodeExecutions) || rawMaxNodeExecutions < 1 || rawMaxNodeExecutions > MAX_ORCHESTRATION_MAX_NODE_EXECUTIONS) {
      deps.showError(`Maximum node executions must be between 1-${MAX_ORCHESTRATION_MAX_NODE_EXECUTIONS} inclusive`)
      return false
    }
    return true
  }

  function selectedStage(): OrchestrationStage | undefined {
    return draft.stages.find(stage => stage.id === draft.selectedStageId)
  }

  function getRoleName(roleId: string): string {
    return deps.getStore().rolesById[roleId]?.name ?? 'Unknown agent'
  }

  function getRoleSiteLabel(roleId: string): string {
    const role = deps.getStore().rolesById[roleId]
    return role ? roleModelDisplay(role, deps.getStore()).label : ''
  }

  function getDraftRoles(): GroupRole[] {
    const rolesById = new Map(deps.getCurrentRoles().map(role => [role.id, role]))
    const roleIds = new Set<string>()
    for (const stage of draft.stages) {
      for (const roleId of stage.roleIds) roleIds.add(roleId)
      if (stage.kind === 'review') {
        for (const roleId of stage.review?.reviewerRoleIds ?? []) roleIds.add(roleId)
      }
    }
    return [...roleIds].map(roleId => rolesById.get(roleId)).filter((role): role is GroupRole => Boolean(role))
  }

  function ensureExternalApiConfigured(): boolean {
    if (hasExternalApiConfigured()) return true
    deps.showError(externalApiRequiredMessage)
    deps.openExternalModels()
    return false
  }

  function hasExternalApiConfigured(): boolean {
    const store = deps.getStore()
    return store.settings.externalModelOrder.some(modelId => {
      const model = store.settings.externalModelsById[modelId]
      return Boolean(model?.name.trim() && model.baseUrl.trim() && model.apiKey.trim() && model.modelName.trim())
    })
  }

  function registerOrchestrationEvents(): void {
    deps.openOrchestrationEl.addEventListener('click', open)
    deps.closeOrchestrationEl.addEventListener('click', close)
    deps.closeAutoOrchestrationEl.addEventListener('click', closeAutoPanel)
    deps.openOrchestrationTemplateEl.addEventListener('click', openTemplatePicker)
    deps.closeOrchestrationTemplateEl.addEventListener('click', closeTemplatePicker)
    deps.arrangeOrchestrationEl.addEventListener('click', arrangeCanvas)
    deps.autoOrchestrationEl.addEventListener('click', openAutoPanel)
    deps.orchestrationMaxRoundsEl.addEventListener('input', render)
    deps.saveOrchestrationEl.addEventListener('click', () => save().catch(error => deps.showError(error instanceof Error ? error.message : String(error))))
    deps.runOrchestrationEl.addEventListener('click', () => run().catch(error => deps.showError(error instanceof Error ? error.message : String(error))))
  }

  return { close, render, registerOrchestrationEvents, handleRuntimeMessage }
}

function autoGenerateSuccessMessage(createdCount: number, reusedCount: number): string {
  if (createdCount > 0 && reusedCount > 0) return `Workflow draft generated automatically, reusing ${reusedCount} members and adding ${createdCount} agents`
  if (createdCount > 0) return `Workflow draft generated automatically, adding ${createdCount} agents`
  return 'Workflow draft generated automatically. Edit it further, then save or run it.'
}

function templateCategoryLabel(category: OrchestrationTemplateCategory): string {
  return category === 'structure' ? 'Orchestration type' : 'Use case'
}

function templateCapabilityLabel(capability: string): string {
  if (capability === 'sequential') return 'Sequential'
  if (capability === 'parallel') return 'Parallel'
  if (capability === 'review') return 'Review'
  if (capability === 'loop') return 'Loop'
  if (capability === 'merge') return 'Synthesis'
  return capability
}

function requireTemplateRoleId(roleIdsByKey: Map<string, string>, roleKey: string, templateName: string): string {
  const roleId = roleIdsByKey.get(roleKey)
  if (!roleId) throw new Error(`Template “${templateName}” is missing agents:${roleKey}`)
  return roleId
}

function findReusableTemplateRole(templateRole: OrchestrationTemplateRole, roles: GroupRole[], usedRoleIds: Set<string>): GroupRole | undefined {
  const acceptableNames = new Set([templateRole.name, ...(templateRole.aliases ?? [])].map(normalizeTemplateRoleName))
  return roles.find(role => !usedRoleIds.has(role.id) && acceptableNames.has(normalizeTemplateRoleName(role.name)))
}

function isGeneratedEditableRole(role: GroupRole): boolean {
  return role.createdBy === 'orchestration-auto' || role.createdBy === 'orchestration-template'
}

function isBuiltinOrchestrationTemplateRoleName(name: string): boolean {
  const normalizedName = normalizeTemplateRoleName(name)
  return builtinOrchestrationTemplateRoleNames().has(normalizedName)
}

function builtinOrchestrationTemplateRoleNames(): Set<string> {
  return new Set(BUILTIN_ORCHESTRATION_TEMPLATES.flatMap(template => template.roles.map(role => normalizeTemplateRoleName(role.name))))
}

function normalizeTemplateRoleName(name: string): string {
  return name.trim().toLowerCase()
}

function cloneStages(stages: OrchestrationStage[]): OrchestrationStage[] {
  return stages.map(stage => ({
    ...stage,
    position: stage.position ? { x: stage.position.x, y: stage.position.y } : undefined,
    roleIds: [...stage.roleIds],
    review: stage.review ? { ...stage.review, reviewerRoleIds: [...stage.review.reviewerRoleIds] } : undefined,
  }))
}

function normalizedReviewConfig(stage: OrchestrationStage, patch: Partial<NonNullable<OrchestrationStage['review']>> = {}): NonNullable<OrchestrationStage['review']> {
  return {
    reviewerRoleIds: stage.review?.reviewerRoleIds?.length ? [...stage.review.reviewerRoleIds] : [...stage.roleIds.slice(0, 1)],
    instructions: stage.review?.instructions ?? '',
    maxAttempts: clampReviewAttempts(stage.review?.maxAttempts ?? DEFAULT_ORCHESTRATION_REVIEW_MAX_ATTEMPTS),
    onMaxAttempts: stage.review?.onMaxAttempts === 'continue' ? 'continue' : 'stop',
    ...patch,
  }
}

function cloneGraphEdges(edges: OrchestrationGraphSnapshot['edges']): OrchestrationGraphSnapshot['edges'] {
  return edges.map(edge => ({
    sourceStageId: edge.sourceStageId,
    targetStageId: edge.targetStageId,
    ...(edge.sourcePort ? { sourcePort: edge.sourcePort } : {}),
    ...(edge.targetPort ? { targetPort: edge.targetPort } : {}),
    ...(edge.vertices && edge.vertices.length > 0 ? { vertices: edge.vertices.map(vertex => ({ x: vertex.x, y: vertex.y })) } : {}),
  }))
}

function cloneAutoPlanHistory(history: OrchestrationAutoPlanHistoryEntry[]): OrchestrationAutoPlanHistoryEntry[] {
  return history.map(entry => ({ id: entry.id, role: entry.role, content: entry.content, createdAt: entry.createdAt }))
}

function sequentialGraphEdges(stages: OrchestrationStage[]): OrchestrationGraphSnapshot['edges'] {
  return stages.slice(1).map((stage, index) => ({ sourceStageId: stages[index].id, targetStageId: stage.id }))
}

function filterGraphEdges(edges: OrchestrationGraphSnapshot['edges'], stages: OrchestrationStage[]): OrchestrationGraphSnapshot['edges'] {
  const stageIds = new Set(stages.map(stage => stage.id))
  const seen = new Set<string>()
  const result: OrchestrationGraphSnapshot['edges'] = []
  for (const edge of edges) {
    if (!stageIds.has(edge.sourceStageId) || !stageIds.has(edge.targetStageId) || edge.sourceStageId === edge.targetStageId) continue
    const sourcePort = edge.sourcePort ?? ''
    const targetPort = edge.targetPort ?? ''
    const key = `${edge.sourceStageId}:${sourcePort}->${edge.targetStageId}:${targetPort}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push({
      sourceStageId: edge.sourceStageId,
      targetStageId: edge.targetStageId,
      ...(edge.sourcePort ? { sourcePort: edge.sourcePort } : {}),
      ...(edge.targetPort ? { targetPort: edge.targetPort } : {}),
      ...(edge.vertices && edge.vertices.length > 0 ? { vertices: edge.vertices.map(vertex => ({ x: vertex.x, y: vertex.y })) } : {}),
    })
  }
  return result
}

export function orderStagesByGraph(stages: OrchestrationStage[], edges: OrchestrationGraphSnapshot['edges']): OrchestrationStage[] {
  const stageIds = new Set(stages.map(stage => stage.id))
  const validEdges = filterGraphEdges(edges, stages)
  if (validEdges.length === 0) return stages

  const outgoing = new Map<string, string[]>()
  const indegree = new Map(stages.map(stage => [stage.id, 0]))
  for (const edge of validEdges) {
    outgoing.set(edge.sourceStageId, [...outgoing.get(edge.sourceStageId) ?? [], edge.targetStageId])
    indegree.set(edge.targetStageId, (indegree.get(edge.targetStageId) ?? 0) + 1)
  }

  const byId = new Map(stages.map(stage => [stage.id, stage]))
  const queue = stages.filter(stage => (indegree.get(stage.id) ?? 0) === 0)
  const ordered: OrchestrationStage[] = []
  const emitted = new Set<string>()
  for (let index = 0; index < queue.length; index += 1) {
    const stage = queue[index]
    if (!stage || emitted.has(stage.id)) continue
    ordered.push(stage)
    emitted.add(stage.id)
    for (const targetId of outgoing.get(stage.id) ?? []) {
      if (!stageIds.has(targetId)) continue
      const nextIndegree = (indegree.get(targetId) ?? 0) - 1
      indegree.set(targetId, nextIndegree)
      const target = byId.get(targetId)
      if (target && nextIndegree === 0) queue.push(target)
    }
  }

  if (ordered.length === stages.length) return ordered
  return [...ordered, ...stages.filter(stage => !emitted.has(stage.id))]
}

function clampMaxNodeExecutions(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_ORCHESTRATION_MAX_NODE_EXECUTIONS
  return Math.min(MAX_ORCHESTRATION_MAX_NODE_EXECUTIONS, Math.max(1, Math.trunc(value)))
}

function readMaxNodeExecutionsInput(input: HTMLInputElement): number {
  return clampMaxNodeExecutions(Number(input.value || DEFAULT_ORCHESTRATION_MAX_NODE_EXECUTIONS))
}

function clampReviewAttempts(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_ORCHESTRATION_REVIEW_MAX_ATTEMPTS
  return Math.min(50, Math.max(1, Math.trunc(value)))
}

function roleInitial(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || 'Agent'
}

function roleToneClass(seed: string): string {
  const tones = ['tone-blue', 'tone-green', 'tone-purple', 'tone-orange']
  const total = [...seed].reduce((sum, char) => sum + char.charCodeAt(0), 0)
  return tones[total % tones.length]
}

function roleModelDisplay(role: Pick<GroupRole, 'modelSource' | 'externalModelId' | 'chatSite'>, store: OpenTeamStore): { label: string; className: string } {
  if (role.modelSource === 'external' && role.externalModelId) {
    return { label: externalModelLabel(store.settings.externalModelsById[role.externalModelId]), className: 'site-pill-external' }
  }
  const site = visibleChatSite(role.chatSite ?? store.settings.defaultChatSite)
  return { label: siteLabel(site), className: `site-pill-${site}` }
}

function siteLabel(site: ChatSite): string {
  if (site === 'chatgpt') return 'ChatGPT'
  if (site === 'claude') return 'Claude'
  if (site === 'deepseek') return 'DeepSeek'
  if (site === 'grok') return 'Grok'
  return 'Gemini'
}

function editableChatSites(): ChatSite[] {
  return ['deepseek', 'grok', 'chatgpt', 'gemini', 'claude']
}

function externalModelLabel(model: ExternalModelConfig | undefined): string {
  return model ? `API · ${model.name}` : 'API · Not configured'
}

function visibleChatSite(site: ChatSite): ChatSite {
  return ['gemini', 'chatgpt', 'claude', 'deepseek', 'grok'].includes(site) ? site : 'gemini'
}

function newId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `${prefix}-${crypto.randomUUID()}`
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}
