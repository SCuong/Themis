import type { OpenTeamStore } from './types'

// Members added from a custom template always use that template's current persona,
// so editing the template updates every chat that uses it.
export function synchronizeCustomRolePersonas(store: OpenTeamStore): OpenTeamStore {
  for (const role of Object.values(store.rolesById)) {
    const template = store.roleTemplatesById[role?.templateId as string]
    if (template?.type !== 'custom' || role.createdBy === 'orchestration-auto' || role.createdBy === 'orchestration-template') continue
    role.systemPrompt = template.systemPrompt ?? ''
    if (template.description) role.description = template.description
    else delete role.description
  }
  return store
}
