// What the tests use from the shared (store, i18n, templates) source, under real names.
export { createDefaultStore, loadStore, saveStore } from '../src/group/store'
export { PROMPT_I18N, localizeGroupTemplate, localizeRoleTemplate, normalizeLanguage, translateUi } from '../src/shared/i18n'
export { createGroupRole, createRoleTemplate, getAllRoleTemplates, updateRoleTemplate } from '../src/group/roleTemplates'
export { buildBuiltinGroupTemplateWelcomeMessage, filterBuiltinGroupTemplates, getBuiltinGroupTemplate } from '../src/group/builtinGroupTemplates'
export { createIndexedDbImageAttachmentRepository } from '../src/shared/imageAttachmentRepository'
