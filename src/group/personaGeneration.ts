import { ROLE_NAME_MAX_CHARACTERS } from './roleTemplates'
import { PROMPT_I18N, normalizeLanguage } from '../shared/i18n'
import type { OpenTeamLanguage } from './types'

export interface GeneratedPersonDraft {
  name: string
  description: string
  systemPrompt: string
}

export interface RoleTemplatePersonaPromptInput {
  description: string
  language?: OpenTeamLanguage
}

export function buildRoleTemplatePersonaPrompt(input: RoleTemplatePersonaPromptInput): string {
  const language = normalizeLanguage(input.language)
  if (language === 'en') {
    return [
      'You are the Themis people-library persona generator.',
      PROMPT_I18N.en.jsonOnly,
      '',
      'Goal: based on a short user description, generate a reusable person suitable for an AI group chat.',
      '',
      'Hard requirements:',
      `1. name is a short person name, at most ${ROLE_NAME_MAX_CHARACTERS} characters.`,
      '2. description is a one-sentence responsibility summary.',
      '3. systemPrompt is a persona prompt that can be sent directly to a model. It must clearly describe identity, working style, output habits, and boundaries.',
      `4. ${PROMPT_I18N.en.personaLanguageInstruction}`,
      '',
      'Return JSON schema:',
      JSON.stringify({
        name: 'Growth Advisor',
        description: 'Advises from acquisition, conversion, and review perspectives.',
        systemPrompt: 'You are a growth advisor. First identify the goal and constraints, then give actionable recommendations.',
      }, null, 2),
      '',
      'User description:',
      input.description.trim(),
    ].join('\n')
  }

  return [
    'You are the persona generator for Themis\'s member library.',
    PROMPT_I18N.vi.jsonOnly,
    '',
    'Goal: Based on the user\'s description, generate a reusable member suitable for an AI group chat.',
    '',
    'Mandatory requirements:',
    `1. name is a short member name, with a maximum of ${ROLE_NAME_MAX_CHARACTERS} characters.`,
    '2. description is a one-sentence summary of responsibilities.',
    '3. systemPrompt is a persona prompt that can be sent directly to the model. Clearly specify the identity, working approach, output conventions, and boundaries.',
    `4. ${PROMPT_I18N.vi.personaLanguageInstruction}`,
    '',
    'Return this JSON schema:',
    JSON.stringify({
      name: 'Growth advisor',
      description: 'Responsible for advising on customer acquisition, conversion, and retrospective analysis.',
      systemPrompt: 'You are a growth advisor. Assess the goals and constraints first, then provide actionable recommendations.',
    }, null, 2),
    '',
    'User description:',
    input.description.trim(),
  ].join('\n')
}

export function parseGeneratedPersonDraft(text: string): GeneratedPersonDraft {
  try {
    const parsed = JSON.parse(extractJsonObject(text))
    if (!isRecord(parsed)) throw new Error('not object')
    const name = truncateRoleName(readString(parsed.name))
    const description = readString(parsed.description)
    const systemPrompt = readString(parsed.systemPrompt)
    if (!name || !systemPrompt) throw new Error('missing required fields')
    return { name, description, systemPrompt }
  } catch {
    throw new Error('Invalid response format from AI persona generation')
  }
}

function truncateRoleName(value: string): string {
  return Array.from(value.trim()).slice(0, ROLE_NAME_MAX_CHARACTERS).join('')
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function extractJsonObject(text: string): string {
  const source = text.trim()
  const start = source.indexOf('{')
  const end = source.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('missing json object')
  return source.slice(start, end + 1)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
