import type { OrchestrationGraphSnapshot, OrchestrationStageKind, ReviewMaxAttemptsAction } from './types'

export type OrchestrationTemplateCategory = 'structure' | 'scenario'
export type OrchestrationTemplateCapability = 'sequential' | 'parallel' | 'review' | 'loop' | 'merge'

export interface OrchestrationTemplateRole {
  key: string
  name: string
  description: string
  systemPrompt: string
  aliases?: string[]
}

export interface OrchestrationTemplateReview {
  reviewerRoleKeys: string[]
  instructions: string
  maxAttempts: number
  onMaxAttempts: ReviewMaxAttemptsAction
}

export interface OrchestrationTemplateStage {
  id: string
  kind: OrchestrationStageKind
  name: string
  description: string
  roleKeys: string[]
  review?: OrchestrationTemplateReview
}

export interface OrchestrationTemplateEdge {
  from: string
  to: string
  sourcePort?: NonNullable<OrchestrationGraphSnapshot['edges'][number]['sourcePort']>
}

export interface BuiltinOrchestrationTemplate {
  id: string
  category: OrchestrationTemplateCategory
  name: string
  summary: string
  structure: string
  defaultTask: string
  capabilities: OrchestrationTemplateCapability[]
  maxNodeExecutions: number
  roles: OrchestrationTemplateRole[]
  stages: OrchestrationTemplateStage[]
  edges: OrchestrationTemplateEdge[]
}

const DEFAULT_REVIEW_MAX_ATTEMPTS = 3

export const BUILTIN_ORCHESTRATION_TEMPLATES: BuiltinOrchestrationTemplate[] = [
  {
    id: 'sequential-handoff',
    category: 'structure',
    name: 'Sequential handoff',
    summary: 'Each agent hands off to the next when finished, ideal for a linear workflow.',
    structure: 'Plan -> Execute -> Summarize',
    defaultTask: 'Please break down the goal of “launching a team knowledge base feature” into an execution plan, develop the main proposal, and summarize it as an actionable checklist.',
    capabilities: ['sequential'],
    maxNodeExecutions: 20,
    roles: [
      role('planner', 'Planner', 'Break down the goal and define an execution path', 'First break down the user\'s task, clarifying goals, constraints, priorities, and a checklist of next steps.'),
      role('executor', 'Executor', 'Produce the main deliverable based on the plan', 'Complete the main task based on the preceding plan. Provide concrete, actionable output and avoid vague statements.'),
      role('summarizer', 'Summarizer', 'Combine previous results into a conclusion', 'Organize all previous outputs and provide clear conclusions, key supporting evidence, and recommended next steps.'),
    ],
    stages: [
      stage('plan', 'roles', 'Task breakdown', 'Clarify the goal and break it down into execution steps.', ['planner']),
      stage('execute', 'roles', 'Main execution', 'Produce the main deliverable based on the task breakdown.', ['executor']),
      stage('summarize', 'roles', 'Final delivery', 'Combine the results and deliver the final version.', ['summarizer']),
    ],
    edges: [
      edge('plan', 'execute'),
      edge('execute', 'summarize'),
    ],
  },
  {
    id: 'parallel-merge',
    category: 'structure',
    name: 'Parallel synthesis',
    summary: 'Multiple agents explore ideas simultaneously, then one agent combines them into a single conclusion.',
    structure: 'Parallel exploration -> Synthesis',
    defaultTask: 'Please evaluate “whether to launch a shared team knowledge base” from three perspectives: user value, costs and risks, and growth and outreach. Summarize your findings as prioritized recommendations.',
    capabilities: ['parallel', 'merge'],
    maxNodeExecutions: 20,
    roles: [
      role('angle_a', 'Perspective A', 'Analyze user value', 'Analyze the task in terms of user value, real pain points, and use cases.'),
      role('angle_b', 'Perspective B', 'Analyze costs and risks', 'Analyze the task in terms of implementation costs, resource investment, risks, and boundary conditions.'),
      role('angle_c', 'Perspective C', 'Analyze growth and outreach', 'Analyze the task in terms of growth, outreach, differentiation, and perceived value.'),
      role('merger', 'Synthesizer', 'Combine multiple perspectives into a conclusion', 'Combine multiple perspectives, remove duplicates, prioritize findings, and provide clear final recommendations.'),
    ],
    stages: [
      stage('parallel', 'roles', 'Parallel exploration', 'Analyze the same task from multiple perspectives simultaneously.', ['angle_a', 'angle_b', 'angle_c']),
      stage('merge', 'roles', 'Synthesis', 'Combine parallel results into a single conclusion.', ['merger']),
    ],
    edges: [edge('parallel', 'merge')],
  },
  {
    id: 'review-gate',
    category: 'structure',
    name: 'Review gate',
    summary: 'Execute first, then review. Stop on failure to prevent low-quality results from moving forward.',
    structure: 'Execute -> Review',
    defaultTask: 'Please create “recommendations for improving new user onboarding” and have a reviewer check that they are clearly structured, sufficiently detailed, and actionable.',
    capabilities: ['sequential', 'review'],
    maxNodeExecutions: 20,
    roles: [
      role('worker', 'Executor', 'Produce the main deliverable', 'Produce the main deliverable for the user\'s task. Ensure it is clearly structured, sufficiently detailed, and ready for review.'),
      role('reviewer', 'Reviewer', 'Determine whether the output passes the criteria', 'Rigorously review previous output, determine pass or fail solely against the criteria, and identify specific issues.'),
    ],
    stages: [
      stage('work', 'roles', 'Produce output', 'Produce an initial version ready for review.', ['worker']),
      reviewStage('review', 'Review gate', 'Determine whether the output meets delivery standards.', ['reviewer'], 'Must fulfill the user\'s task, have a clear structure and sufficient key details, and provide actionable conclusions. Pass if all criteria are met; otherwise fail and explain the gaps.'),
    ],
    edges: [edge('work', 'review')],
  },
  {
    id: 'review-loop',
    category: 'structure',
    name: 'Review loop',
    summary: 'If review fails, return to the revision node until the output passes or the limit is reached.',
    structure: 'Produce -> Revise -> Review; return to revision on failure',
    defaultTask: 'Please draft announcement copy introducing Themis orchestration to new users. If review fails, revise it based on feedback until it is ready to publish.',
    capabilities: ['sequential', 'review', 'loop'],
    maxNodeExecutions: 30,
    roles: [
      role('writer', 'Executor', 'Produce and revise based on feedback', 'Produce the first draft, then address specific issues when review feedback arrives. Do not repeat content that has already passed review.'),
      role('reviewer', 'Reviewer', 'Determine whether further revision is needed', 'Check whether the output meets the criteria. Return only the review decision and actionable revision suggestions.'),
    ],
    stages: [
      stage('draft', 'roles', 'First draft', 'First provide an initial version ready for review.', ['writer']),
      stage('revise', 'roles', 'Revise and improve', 'Address issues raised in review feedback and produce an improved version.', ['writer']),
      reviewStage('review', 'Review gate', 'Determine whether the current version is ready for delivery.', ['reviewer'], 'Must fully address the user\'s task, have a clear structure and sufficient detail, and provide actionable conclusions. Pass if all criteria are met; otherwise fail and specify what must change in the next round.'),
    ],
    edges: [
      edge('draft', 'revise'),
      edge('revise', 'review'),
      edge('review', 'revise', 'fail'),
    ],
  },
  {
    id: 'product-review',
    category: 'scenario',
    name: 'Product proposal review',
    summary: 'Product breaks down the proposal, engineering estimates costs, and a reviewer decides whether rework is needed.',
    structure: 'Product breakdown -> Engineering assessment -> Review; return to product on failure',
    defaultTask: 'Please review the product proposal to “add built-in orchestration templates to Themis” and provide user value, implementation costs, risks, and launch recommendations.',
    capabilities: ['sequential', 'review', 'loop'],
    maxNodeExecutions: 30,
    roles: [
      role('pm', 'Product manager', 'Define user value and proposal boundaries', 'You are a product manager. Break down the task into user goals, core value, feature scope, priorities, and acceptance criteria.', ['Product']),
      role('engineer', 'Engineer', 'Assess implementation approach, costs, and risks', 'You are an engineer. Assess the technical approach, implementation costs, dependencies, edge cases, and test plan.', ['Engineering', 'Development']),
      role('reviewer', 'Proposal reviewer', 'Determine whether the proposal can move forward', 'You are a proposal reviewer. Check that product value, engineering costs, risks, and launch recommendations are complete.', ['Review']),
    ],
    stages: [
      stage('product', 'roles', 'Product breakdown', 'Define user value, scope, and success criteria.', ['pm']),
      stage('engineering', 'roles', 'Engineering assessment', 'Assess the implementation approach, costs, risks, and testing.', ['engineer']),
      reviewStage('review', 'Proposal review', 'Determine whether the proposal is ready for execution.', ['reviewer'], 'Must include user value, implementation costs, major risks, a test plan, and launch recommendations. Fail if any item is missing.'),
    ],
    edges: [
      edge('product', 'engineering'),
      edge('engineering', 'review'),
      edge('review', 'product', 'fail'),
    ],
  },
  {
    id: 'content-production',
    category: 'scenario',
    name: 'Content creation and review',
    summary: 'Choose a topic, write the article, then return to writing if editorial review fails.',
    structure: 'Topic selection -> Writing -> Editorial review; return to writing on failure',
    defaultTask: 'Please create a short WeChat public account article about Themis\'s orchestration templates, from topic selection through writing and editorial review, until it is ready to publish.',
    capabilities: ['sequential', 'review', 'loop'],
    maxNodeExecutions: 30,
    roles: [
      role('planner', 'Content planner', 'Define the angle, audience, and structure', 'You are a content planner. Define the target audience, content angle, title direction, structure, and key information.'),
      role('writer', 'Writer', 'Write and revise the first draft', 'You are a writer. Write natural, concrete, publishable content and revise it based on editorial feedback.'),
      role('editor', 'Edit', 'Review content quality and publishing readiness', 'You are an editor. Check that the content suits its audience, has a clear structure and sufficient detail, and is ready to publish.'),
    ],
    stages: [
      stage('plan', 'roles', 'Content planner', 'Define the audience, angle, title, and structure.', ['planner']),
      stage('write', 'roles', 'Article writing', 'Write an article ready for editorial review.', ['writer']),
      reviewStage('edit', 'Editorial review', 'Determine whether the content is ready to publish.', ['editor'], 'Must suit the target audience, have a clear structure and sufficient detail, sound natural, and be ready to publish. Otherwise fail and provide revision suggestions.'),
    ],
    edges: [
      edge('plan', 'write'),
      edge('write', 'edit'),
      edge('edit', 'write', 'fail'),
    ],
  },
  {
    id: 'competitor-analysis',
    category: 'scenario',
    name: 'Competitive analysis report',
    summary: 'Analyze competitors from multiple perspectives in parallel, then combine the results into strategic recommendations.',
    structure: 'Parallel analysis -> Report synthesis -> Quality review',
    defaultTask: 'Please analyze the orchestration capabilities of three team collaboration or AI Agent products and create a competitive analysis report covering differences, opportunities, and recommended actions.',
    capabilities: ['parallel', 'merge', 'review'],
    maxNodeExecutions: 25,
    roles: [
      role('product', 'Product analyst', 'Analyze differences in features and positioning', 'Analyze competitors in terms of product positioning, core features, user journeys, and differentiation.'),
      role('market', 'Market analyst', 'Analyze channels, pricing, and outreach', 'Analyze competitors in terms of pricing, channels, outreach, growth, and target customers.'),
      role('strategy', 'Strategy consultant', 'Identify opportunities and recommend actions', 'Analyze competitors in terms of opportunities, threats, and defensive and offensive strategies.'),
      role('reporter', 'Report writer', 'Combine findings into a report', 'Combine the parallel analyses into a clearly structured competitive analysis report with clear conclusions.'),
      role('reviewer', 'Report reviewer', 'Review the report for completeness and credibility', 'Check that the report covers competitors, differences, opportunities, risks, and recommended actions.'),
    ],
    stages: [
      stage('parallel', 'roles', 'Parallel analysis', 'Analyze product, market, and strategy perspectives simultaneously.', ['product', 'market', 'strategy']),
      stage('report', 'roles', 'Report synthesis', 'Combine the parallel results into a report.', ['reporter']),
      reviewStage('review', 'Report review', 'Determine whether the report is complete and credible.', ['reviewer'], 'Must cover competitor positioning, key differences, opportunities, major risks, and recommended actions. Conclusions must be supported by evidence. Fail if anything is missing.'),
    ],
    edges: [
      edge('parallel', 'report'),
      edge('report', 'review'),
    ],
  },
]

export function getBuiltinOrchestrationTemplate(templateId: string): BuiltinOrchestrationTemplate | undefined {
  return BUILTIN_ORCHESTRATION_TEMPLATES.find(template => template.id === templateId)
}

function role(key: string, name: string, description: string, systemPrompt: string, aliases: string[] = []): OrchestrationTemplateRole {
  return { key, name, description, systemPrompt, ...(aliases.length > 0 ? { aliases } : {}) }
}

function stage(id: string, kind: OrchestrationStageKind, name: string, description: string, roleKeys: string[]): OrchestrationTemplateStage {
  return { id, kind, name, description, roleKeys }
}

function reviewStage(id: string, name: string, description: string, reviewerRoleKeys: string[], instructions: string): OrchestrationTemplateStage {
  return {
    id,
    kind: 'review',
    name,
    description,
    roleKeys: reviewerRoleKeys,
    review: {
      reviewerRoleKeys,
      instructions,
      maxAttempts: DEFAULT_REVIEW_MAX_ATTEMPTS,
      onMaxAttempts: 'stop',
    },
  }
}

function edge(from: string, to: string, sourcePort?: OrchestrationTemplateEdge['sourcePort']): OrchestrationTemplateEdge {
  return { from, to, ...(sourcePort ? { sourcePort } : {}) }
}
