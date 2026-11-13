import { PROMPT_I18N, normalizeLanguage } from '../shared/i18n'
import type { OpenTeamLanguage, OrchestrationReviewResult, OrchestrationStage } from './types'

export interface BuildOrchestrationRoleMessageContentInput {
  userTask: string
  currentStage: OrchestrationStage
  previousReviewResult?: OrchestrationReviewResult
  language?: OpenTeamLanguage
}

export interface BuildOrchestrationReviewMessageContentInput {
  userTask: string
  currentStage: OrchestrationStage
  reviewCriteria?: string
  language?: OpenTeamLanguage
}

export function buildOrchestrationRoleMessageContent(input: BuildOrchestrationRoleMessageContentInput): string {
  const language = normalizeLanguage(input.language)
  const previousInstruction = input.previousReviewResult?.nextRoundInstruction?.trim()
  return joinSections([
    `${language === 'en' ? 'Current task:' : 'Current task:'}\n${input.userTask}`,
    input.currentStage.description ? `${language === 'en' ? 'Current node task:' : 'Current node task:'}\n${input.currentStage.description}` : undefined,
    previousInstruction ? `${language === 'en' ? 'Previous review failed with this requirement:' : 'Requirements not met in the previous review:'}\n${previousInstruction}` : undefined,
  ])
}

export function buildOrchestrationReviewMessageContent(input: BuildOrchestrationReviewMessageContentInput): string {
  const language = normalizeLanguage(input.language)
  return joinSections([
    `${language === 'en' ? 'Current task:' : 'Current task:'}\n${input.userTask}`,
    input.currentStage.description ? `${language === 'en' ? 'Current review node task:' : 'Current review node task:'}\n${input.currentStage.description}` : undefined,
    `${language === 'en' ? 'Review criteria:' : 'Review criteria:'}\n${input.reviewCriteria?.trim() || input.currentStage.review?.instructions?.trim() || (language === 'en' ? 'Decide whether the current result satisfies the task requirements.' : 'Determine whether the current result meets the task requirements.')}`,
    buildOrchestrationReviewResponseInstruction(language),
  ])
}

export function buildOrchestrationReviewResponseInstruction(languageInput?: OpenTeamLanguage): string {
  const language = normalizeLanguage(languageInput)
  return joinSections([
    PROMPT_I18N[language].jsonOnly,
    `${language === 'en' ? 'The JSON format must match:' : 'The JSON format must match:'}\n${reviewSchema(language)}`,
    language === 'en'
      ? 'decision must be pass or fail. Use fail when the review does not pass, and write exactly what to improve in nextRoundInstruction.'
      : 'decision must be either pass or fail. If the review fails, use fail and clearly specify in nextRoundInstruction what must change in the next retry.',
  ])
}

function reviewSchema(language: OpenTeamLanguage): string {
  const schema = language === 'en'
    ? {
        decision: 'pass | fail',
        reason: 'Review explanation',
        failedCriteria: ['Criteria that were not met'],
        nextRoundInstruction: 'Required when decision is fail; otherwise an empty string',
      }
    : {
        decision: 'pass | fail',
        reason: 'Review explanation',
        failedCriteria: ['Unmet criteria'],
        nextRoundInstruction: 'Required when decision is fail; otherwise an empty string',
      }
  return JSON.stringify(schema, null, 2)
}

function joinSections(sections: Array<string | undefined>): string {
  return sections.filter((section): section is string => Boolean(section?.trim())).join('\n\n')
}
