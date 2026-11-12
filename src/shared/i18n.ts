import type { BuiltinGroupTemplate, BuiltinGroupTemplateRole } from '../group/builtinGroupTemplates'
import type { OpenTeamLanguage, RoleTemplate } from '../group/types'
import { localizeUI } from '../../localization.js'

export type TeamLanguage = OpenTeamLanguage

export const DEFAULT_LANGUAGE: TeamLanguage = 'vi'

export const PROMPT_I18N = {
  vi: {
    responseLanguageInstruction: 'Ưu tiên ngôn ngữ người dùng yêu cầu. Nếu không có, làm theo ngôn ngữ trong persona. Nếu cả hai đều không chỉ định, trả lời bằng tiếng Việt.',
    personaLanguageInstruction: 'Viết tên, mô tả và systemPrompt bằng tiếng Việt. Persona phải cụ thể và có thể thực hiện.',
    jsonOnly: 'Chỉ trả về JSON hợp lệ, không dùng Markdown, lời giải thích hoặc khối mã.',
  },
  en: {
    responseLanguageInstruction: 'Use the reply language explicitly requested by the user. Otherwise, follow the reply language specified by your persona. If neither specifies a reply language, respond in English.',
    personaLanguageInstruction: 'Write name, description, and systemPrompt in English. Keep the systemPrompt concrete and actionable.',
    jsonOnly: 'Return valid JSON only. Do not include Markdown, explanations, or code fences.',
  },
} satisfies Record<TeamLanguage, Record<string, string>>

interface GroupTemplateLocalization {
  name: string
  summary?: string
  userTypes?: string[]
}

interface RoleTemplateLocalization {
  name: string
  description: string
  systemPrompt?: string
}

const GROUP_TEMPLATE_LOCALIZATIONS: Record<string, GroupTemplateLocalization> = {
  'study-master': { name: 'Study Master Group', summary: 'Breaks real study work into goals, materials, schedules, practice, review, and feedback loops. Produces study plans, clear explanations, mistake reviews, memory-card plans, exam strategy, and next actions.', userTypes: ['Middle school students', 'College students', 'Self-learners'] },
  'exam-prep': { name: 'Exam Prep Group', summary: 'Turns long-cycle exam prep into scope maps, practice plans, mock questioning, weak-point reviews, feedback loops, and recovery plans.' },
  'thesis-writing': { name: 'Thesis Writing Group', summary: 'Supports topic narrowing, literature mapping, method design, structure, academic language, and research-risk review without replacing the student author.' },
  'study-abroad-application': { name: 'Study Abroad Application Group', summary: 'Helps applicants organize positioning, background evidence, narratives, resumes, interview prep, and visa materials while keeping final admissions judgment external.' },
  'daily-work-secretary': { name: 'Daily Work Secretary Group', summary: 'Converts schedules, emails, meetings, tasks, priorities, and daily reviews into executable work materials and follow-up plans.' },
  'project-delivery': { name: 'Project Delivery Group', summary: 'Breaks complex projects into goals, milestones, owners, progress tracking, risks, cross-team coordination, metrics, and retrospective outputs.' },
  'job-interview': { name: 'Job Interview Group' },
  'wechat-editorial': { name: 'WeChat Editorial Team' },
  'short-video-creation': { name: 'Short Video Creation Group' },
  'xiaohongshu-seeding': { name: 'Xiaohongshu Content Group' },
  'novel-writing': { name: 'Novel Writing Group' },
  'startup-advisory': { name: 'Startup Advisory Group' },
  'product-requirement-review': { name: 'Product Requirement Review Group' },
  'indie-developer-growth': { name: 'Indie Developer Growth Group' },
  'fundraising-bp-review': { name: 'Fundraising BP Review Group' },
  'growth-marketing': { name: 'Growth Marketing Group' },
  'sales-coaching': { name: 'Sales Coaching Group' },
  'brand-positioning': { name: 'Brand Positioning Group' },
  'software-development': { name: 'Software Development Group' },
  'ai-agent-development': { name: 'AI Agent Development Group' },
  'data-analysis': { name: 'Data Analysis Group' },
  'ceo-decision': { name: 'CEO Decision Group' },
  'manager-coaching': { name: 'Manager Coaching Group' },
  'hr-recruiting': { name: 'HR Recruiting Group' },
  'personal-finance': { name: 'Personal Finance Group' },
  'small-business-finance': { name: 'Small Business Finance Group' },
  'contract-review': { name: 'Contract Review Group' },
  'ecommerce-operations': { name: 'E-commerce Operations Group' },
  'local-store-growth': { name: 'Local Store Growth Group' },
  'restaurant-operations': { name: 'Restaurant Operations Group' },
  'consulting-advisory': { name: 'Consulting Advisory Group' },
  'teacher-lesson-planning': { name: 'Teacher Lesson Planning Group' },
  'mental-support-growth': { name: 'Mental Support and Growth Group' },
  'real-estate-analysis': { name: 'Real Estate Analysis Group' },
  'renovation-design': { name: 'Renovation Design Group' },
  'travel-planning': { name: 'Travel Planning Group' },
  'fitness-fat-loss': { name: 'Fitness and Fat Loss Group' },
  'medical-visit-prep': { name: 'Medical Visit Prep Group' },
  'agriculture-planting': { name: 'Agriculture Planting Group' },
  'manufacturing-improvement': { name: 'Manufacturing Improvement Group' },
  'supply-chain-procurement': { name: 'Supply Chain Procurement Group' },
  'construction-project': { name: 'Construction Project Group' },
  'law-firm-assistant': { name: 'Law Firm Assistant Group' },
  'medical-research': { name: 'Medical Research Group' },
  'financial-research': { name: 'Financial Research Group' },
}

const ROLE_NAME_TRANSLATIONS: Record<string, string> = Object.fromEntries([
  ['Turns courses, exams, and self-study goals into realistic daily plans, weekly plans, checkpoints, and review loops.', 'StudyPlanner'],
  ['Explains a requested concept clearly and checks understanding with examples, counterexamples, mistakes, and short exercises.', 'ConceptTutor'],
  ['Finds knowledge gaps, reading errors, process mistakes, and habit issues from problems, answers, and working steps.', 'MistakeReviewer'],
  ['Turns memorization and long-term retention work into active-recall, spaced-review, and testing systems.', 'MemoryCoach'],
  ['Builds practical exam strategies from scope, scoring rules, time limits, and weak points.', 'ExamStrategist'],
  ['Reviews learning progress and turns feedback into focused next actions.', 'StudyFeedbackCoach'],
  ['Breaks an exam syllabus into topics, priorities, and review checkpoints.', 'SyllabusMapper'],
  ['Studies past papers to find patterns, high-frequency topics, and practice priorities.', 'PastPaperResearcher'],
  ['Creates review plans that balance scope, time, weak points, and repetition.', 'ReviewPlanner'],
  ['Simulates exam questioning and gives structured feedback.', 'MockExaminer'],
  ['Diagnoses weak areas and turns them into targeted practice plans.', 'WeaknessDiagnostician'],
  ['Helps recover confidence and focus during stressful preparation cycles.', 'MindsetRecoveryCoach'],
  ['Topic Evaluation Advisor', 'TopicEvaluator'],
  ['Literature Mapper', 'LiteratureMapper'],
  ['Research Methods Advisor', 'MethodsAdvisor'],
  ['Thesis Structure Editor', 'ThesisStructureEditor'],
  ['Academic Language Polisher', 'AcademicLanguageEditor'],
  ['Academic Risk Reviewer', 'AcademicRiskReviewer'],
  ['School Selection Advisor', 'SchoolPositioningAdvisor'],
  ['Background Assessor', 'BackgroundEvaluator'],
  ['Personal Statement Mentor', 'EssayNarrativeCoach'],
  ['Application Resume Advisor', 'ApplicationResumeAdvisor'],
  ['Interview Coach', 'InterviewCoach'],
  ['Visa Document Reviewer', 'VisaMaterialsReviewer'],
  ['Schedule Manager', 'ScheduleSteward'],
  ['Email and Message Assistant', 'EmailMessageAssistant'],
  ['Meeting Note Taker', 'MeetingNoteTaker'],
  ['Task Breakdown Specialist', 'TaskDecomposer'],
  ['Prioritization Advisor', 'PriorityAdvisor'],
  ['Daily Review Coach', 'DailyReviewFacilitator'],
  ['Project Planning Manager', 'ProjectPlanningManager'],
  ['Progress Tracker', 'ProgressTracker'],
  ['Project Risk Reviewer', 'ProjectRiskReviewer'],
  ['Cross-team Coordinator', 'CrossTeamCoordinator'],
  ['Project Metrics Analyst', 'ProjectMetricsAnalyst'],
  ['Retrospective Facilitator', 'RetrospectiveFacilitator'],
  ['Career Direction Planner', 'CareerDirectionPlanner'],
  ['Job Description Analyst', 'JDAnalyzer'],
  ['Resume Evidence Optimizer', 'ResumeEvidenceOptimizer'],
  ['Interviewer Simulator', 'InterviewerSimulator'],
  ['Case Interview Coach', 'CaseInterviewCoach'],
  ['Salary Negotiation Advisor', 'SalaryNegotiationAdvisor'],
  ['Topic Editor', 'TopicEditor'],
  ['Research Assistant', 'Researcher'],
  ['Lead Writer', 'LeadWriter'],
  ['Headline and Opening Advisor', 'HeadlineOpeningAdvisor'],
  ['Fact Checker', 'FactChecker'],
  ['Distribution Design Advisor', 'DistributionDesignAdvisor'],
  ['Content Planner', 'TopicPlanner'],
  ['Viral Content Analyst', 'ViralContentAnalyst'],
  ['Script Writer', 'Scriptwriter'],
  ['Storyboard Director', 'StoryboardDirector'],
  ['Title and Cover Advisor', 'TitleCoverAdvisor'],
  ['Watch-through Rate Optimizer', 'CompletionRateOptimizer'],
  ['Audience Insight Analyst', 'UserInsightAnalyst'],
  ['Post Topic Planner', 'PostTopicPlanner'],
  ['Product Recommendation Copywriter', 'SeedingCopywriter'],
  ['Comment Section Manager', 'CommentOpsManager'],
  ['Content Compliance Reviewer', 'ContentComplianceReviewer'],
  ['Worldbuilding Designer', 'WorldbuildingDesigner'],
  ['Character Designer', 'CharacterDesigner'],
  ['Plot Architect', 'PlotArchitect'],
  ['Scene Writer', 'SceneWriter'],
  ['Dialogue Editor', 'DialogueEditor'],
  ['Reader Experience Reviewer', 'ReaderExperienceReviewer'],
  ['Business Model Advisor', 'BusinessModelAdvisor'],
  ['User Researcher', 'UserResearcher'],
  ['MVP Product Manager', 'MVPProductManager'],
  ['Growth Experiment Advisor', 'GrowthExperimentAdvisor'],
  ['Startup Finance Advisor', 'StartupFinanceAdvisor'],
  ['Startup Risk Reviewer', 'StartupRiskReviewer'],
  ['Requirements Product Manager', 'RequirementsProductManager'],
  ['Engineering Estimator', 'EngineeringEvaluator'],
  ['Product Designer', 'ProductDesigner'],
  ['Metrics and Experiment Analyst', 'MetricsExperimentAnalyst'],
  ['Growth Value Reviewer', 'GrowthValueReviewer'],
  ['Product Positioning Advisor', 'ProductPositioningAdvisor'],
  ['Lightweight Tech Architect', 'LeanTechArchitect'],
  ['Pricing and Packaging Advisor', 'PricingPackagingAdvisor'],
  ['Cold Start Advisor', 'ColdStartAdvisor'],
  ['Execution Coach', 'ExecutionCoach'],
  ['User Feedback Analyst', 'UserFeedbackAnalyst'],
  ['Investor Simulator', 'InvestorSimulator'],
  ['Business Plan Structure Advisor', 'BPStructureAdvisor'],
  ['Market Sizing Analyst', 'MarketSizingAnalyst'],
  ['Financial Modeler', 'FinancialModeler'],
  ['Competitive Analyst', 'CompetitiveAnalyst'],
  ['Risk Interrogator', 'RiskQuestioner'],
  ['User Persona Analyst', 'PersonaAnalyst'],
  ['Channel Strategist', 'ChannelStrategist'],
  ['Conversion Rate Optimizer', 'ConversionRateOptimizer'],
  ['A/B Test Designer', 'ABTestDesigner'],
  ['Growth Data Analyst', 'GrowthDataAnalyst'],
  ['Retention Advisor', 'RetentionOpsAdvisor'],
  ['Customer Segmentation Analyst', 'CustomerSegmentationAnalyst'],
  ['Discovery Questioning Coach', 'DiscoveryScriptCoach'],
  ['Customer Objection Simulator', 'ObjectionSimulator'],
  ['Follow-up Cadence Strategist', 'FollowUpCadenceStrategist'],
  ['Deal Process Advisor', 'DealFlowAdvisor'],
  ['CRM Review Recorder', 'CRMReviewRecorder'],
  ['Brand Positioning Architect', 'BrandPositioningArchitect'],
  ['Customer Perception Researcher', 'CustomerMindsetResearcher'],
  ['Brand Messaging Copy Director', 'BrandCopyDirector'],
  ['Visual Direction Advisor', 'VisualDirectionAdvisor'],
  ['Competitive Differentiation Analyst', 'CompetitorDifferentiationAnalyst'],
  ['PR Risk Reviewer', 'PRRiskReviewer'],
  ['Requirements Clarification Architect', 'RequirementClarificationArchitect'],
  ['Backend Implementation Engineer', 'BackendImplementationEngineer'],
  ['Frontend Interaction Engineer', 'FrontendInteractionEngineer'],
  ['QA Test Engineer', 'QAEngineer'],
  ['DevOps Release Engineer', 'DevOpsReleaseEngineer'],
  ['Defensive Security Reviewer', 'DefensiveSecurityReviewer'],
  ['Agent Task Product Manager', 'AgentTaskProductManager'],
  ['Prompt Specification Engineer', 'PromptSpecEngineer'],
  ['Workflow Orchestration Architect', 'WorkflowOrchestrationArchitect'],
  ['Tool Use and Permissions Engineer', 'ToolPermissionEngineer'],
  ['Agent Evaluation Engineer', 'AgentEvaluationEngineer'],
  ['Safety and Governance Reviewer', 'SafetyGovernanceReviewer'],
  ['Metric Definition Analyst', 'MetricDefinitionAnalyst'],
  ['Metrics Framework Advisor', 'MetricsSystemAdvisor'],
  ['SQL Query Builder', 'SQLQueryBuilder'],
  ['Dashboard Designer', 'DashboardDesigner'],
  ['Business Hypothesis Interpreter', 'BusinessHypothesisInterpreter'],
  ['Data Decision Experiment Designer', 'DataDecisionExperimentDesigner'],
  ['Strategic Trade-off Advisor', 'StrategicTradeoffAdvisor'],
  ['Business Finance Advisor', 'BusinessFinanceAdvisor'],
  ['Organizational Capability Advisor', 'OrgCapabilityAdvisor'],
  ['Market Opportunity Advisor', 'MarketOpportunityAdvisor'],
  ['Compliance and Legal Risk Advisor', 'ComplianceLegalRiskAdvisor'],
  ['Devil\'s Advocate Advisor', 'DevilAdvocate'],
  ['Management Goals Coach', 'ManagementGoalCoach'],
  ['Performance Standards Advisor', 'PerformanceStandardsAdvisor'],
  ['Difficult Conversations Coach', 'DifficultConversationCoach'],
  ['Conflict Mediator', 'ConflictMediator'],
  ['Meeting System Designer', 'MeetingSystemDesigner'],
  ['Employee Perspective Simulator', 'EmployeePerspectiveSimulator'],
  ['Role Competency Designer', 'RoleCapabilityDesigner'],
  ['Resume Evidence Screener', 'ResumeEvidenceScreener'],
  ['Structured Interviewer', 'StructuredInterviewer'],
  ['Compensation Range Advisor', 'CompensationRangeAdvisor'],
  ['Culture and Collaboration Assessor', 'CultureCollaborationEvaluator'],
  ['Onboarding Experience Designer', 'OnboardingExperienceDesigner'],
  ['Budget Planner', 'BudgetPlanner'],
  ['Savings and Emergency Fund Coach', 'SavingsEmergencyFundCoach'],
  ['Debt Management Advisor', 'DebtManagementAdvisor'],
  ['Investment Education Teacher', 'InvestmentLiteracyTutor'],
  ['Financial Risk Reminder', 'FinancialRiskReminder'],
  ['Protection and Lifestyle Advisor', 'ProtectionLifestyleAdvisor'],
  ['Bookkeeping Advisor', 'BookkeepingAdvisor'],
  ['Cost Analyst', 'CostAnalyst'],
  ['Pricing Advisor', 'PricingAdvisor'],
  ['Cash Flow Advisor', 'CashflowAdvisor'],
  ['Tax Reminder', 'TaxReminder'],
  ['Business Advice Specialist', 'BusinessOperationsAdvisor'],
  ['Contract Structure Analyst', 'ContractStructureAnalyst'],
  ['Contract Risk Reviewer', 'ContractRiskReviewer'],
  ['Business Negotiation Advisor', 'CommercialNegotiationAdvisor'],
  ['Rights and Obligations Checker', 'RightsObligationsMapper'],
  ['Payment Terms Reviewer', 'PaymentTermsReviewer'],
  ['Jurisdiction and Lawyer Checklist Specialist', 'LegalJurisdictionChecklistReviewer'],
  ['Product Selection Advisor', 'ProductSelectionAdvisor'],
  ['Competitor Analyst', 'CompetitorAnalyst'],
  ['Product Page Copywriter', 'ProductPageCopywriter'],
  ['Ad Campaign Advisor', 'AdCampaignAdvisor'],
  ['Customer Service Script Writer', 'CustomerServiceScriptwriter'],
  ['Repeat Purchase Advisor', 'RepeatPurchaseOpsAdvisor'],
  ['Store Positioning Advisor', 'StorePositioningAdvisor'],
  ['Event Planner', 'CampaignPlanner'],
  ['Review Optimization Specialist', 'ReviewOptimizationAdvisor'],
  ['Private Community Advisor', 'PrivateTrafficOpsAdvisor'],
  ['Short Video Advisor', 'ShortVideoAdvisor'],
  ['Repeat Business Advisor', 'RepeatPurchaseAdvisor'],
  ['Menu Advisor', 'MenuAdvisor'],
  ['Cost Controller', 'CostController'],
  ['Delivery Operations Advisor', 'DeliveryOpsAdvisor'],
  ['Customer Review Analyst', 'CustomerReviewAnalyst'],
  ['Store Manager Advisor', 'StoreManagerAdvisor'],
  ['Problem Diagnostician', 'ProblemDiagnostician'],
  ['Industry Researcher', 'IndustryResearcher'],
  ['Framework Advisor', 'FrameworkAdvisor'],
  ['Solution Designer', 'SolutionDesigner'],
  ['Slide Deck Structurer', 'DeckStructureDesigner'],
  ['Client Challenge Simulator', 'ClientQuestionSimulator'],
  ['Curriculum Designer', 'CurriculumDesigner'],
  ['Lesson Plan Writer', 'LessonPlanWriter'],
  ['Exercise Designer', 'ExerciseDesigner'],
  ['Student Understanding Simulator', 'StudentUnderstandingSimulator'],
  ['Classroom Interaction Designer', 'ClassroomInteractionDesigner'],
  ['Homework Grading Assistant', 'HomeworkReviewAssistant'],
  ['Emotional Listener', 'EmotionListener'],
  ['CBT Self-help Guide', 'CBTSelfHelpGuide'],
  ['Habit Coach', 'HabitCoach'],
  ['Relationship Communication Advisor', 'RelationshipCommunicationAdvisor'],
  ['Values Clarification Coach', 'ValuesClarificationCoach'],
  ['Safety and Help Resources Reminder', 'SafetyResourceReminder'],
  ['Market Analyst', 'MarketAnalyst'],
  ['Neighborhood Researcher', 'RegionalResearcher'],
  ['Loan Advisor', 'LoanAdvisor'],
  ['Contract Risk Specialist', 'ContractRiskChecker'],
  ['Negotiation Advisor', 'NegotiationAdvisor'],
  ['Renovation Budget Advisor', 'RenovationBudgetAdvisor'],
  ['Space Designer', 'SpaceDesigner'],
  ['Budget Controller', 'BudgetController'],
  ['Materials Advisor', 'MaterialsAdvisor'],
  ['Construction Supervisor', 'ConstructionSupervisor'],
  ['Storage Advisor', 'StorageAdvisor'],
  ['Style Advisor', 'StyleAdvisor'],
  ['Itinerary Planner', 'ItineraryPlanner'],
  ['Hotel Advisor', 'HotelAdvisor'],
  ['Food Advisor', 'FoodAdvisor'],
  ['Transport Advisor', 'TransportAdvisor'],
  ['Budget Advisor', 'BudgetAdvisor'],
  ['Risk Reminder', 'RiskReminder'],
  ['Training Coach', 'TrainingCoach'],
  ['Diet Planner', 'NutritionPlanner'],
  ['Form Corrector', 'MovementCorrectionCoach'],
  ['Data Logger', 'DataRecorder'],
  ['Health Risk Reminder', 'HealthRiskReminder'],
  ['Symptom Organizer', 'SymptomOrganizer'],
  ['Medical History Recorder', 'MedicalHistoryRecorder'],
  ['Test Report Explainer', 'TestReportExplainer'],
  ['Doctor Visit Question Designer', 'DoctorVisitQuestionDesigner'],
  ['Medication Information Reminder', 'MedicationInfoReminder'],
  ['Professional Care Reminder', 'ProfessionalCareReminder'],
  ['Crop Advisor', 'CropAdvisor'],
  ['Pest and Disease Analyst', 'PestDiseaseAnalyst'],
  ['Soil Advisor', 'SoilAdvisor'],
  ['Farm Supplies Purchasing Advisor', 'FarmInputProcurementAdvisor'],
  ['Sales Channel Advisor', 'SalesChannelAdvisor'],
  ['Weather Risk Reminder', 'WeatherRiskReminder'],
  ['Production Process Advisor', 'ProductionProcessAdvisor'],
  ['Quality Management Advisor', 'QualityManagementAdvisor'],
  ['Equipment Maintenance Advisor', 'EquipmentMaintenanceAdvisor'],
  ['Production Safety Officer', 'ProductionSafetyOfficer'],
  ['Delivery Planner', 'DeliveryPlanner'],
  ['Supplier Screener', 'SupplierScreener'],
  ['Quote Analyst', 'QuotationAnalyst'],
  ['Inventory Planner', 'InventoryPlanner'],
  ['Logistics Advisor', 'LogisticsAdvisor'],
  ['Supply Chain Quality Reviewer', 'SupplyChainQualityReviewer'],
  ['Project Planner', 'ProjectPlanner'],
  ['Cost Estimator', 'Estimator'],
  ['Construction Coordinator', 'ConstructionCoordinator'],
  ['Site Safety Reminder', 'EngineeringSafetyReminder'],
  ['Materials Procurement and Quality Records Clerk', 'MaterialsProcurementQualityClerk'],
  ['Engineering Risk Reviewer', 'EngineeringRiskReviewer'],
  ['Case Facts Organizer', 'CaseFactOrganizer'],
  ['Legal Research Specialist', 'LegalResearcher'],
  ['Evidence List Specialist', 'EvidenceChecklistClerk'],
  ['Document Drafter', 'LegalDraftingAssistant'],
  ['Opposing View Simulator', 'OpposingViewSimulator'],
  ['Procedure, Deadline and Risk Advisor', 'ProcedureDeadlineRiskReminder'],
  ['Literature Search Specialist', 'LiteratureSearcher'],
  ['Clinical Question Breakdown Specialist', 'ClinicalQuestionDecomposer'],
  ['Research Design Advisor', 'ResearchDesignAdvisor'],
  ['Statistical Analyst', 'StatisticalAnalyst'],
  ['Paper Editor', 'PaperEditor'],
  ['Ethics and Compliance Reminder', 'EthicsComplianceReminder'],
  ['Macro Analyst', 'MacroAnalyst'],
  ['Company and Valuation Scenario Analyst', 'CompanyValuationScenarioAnalyst'],
  ['Financial Statement Analyst', 'FinancialStatementAnalyst'],
  ['Financial Risk Controller', 'FinancialRiskController'],
  ['Contrarian Analyst', 'ContrarianAnalyst'],
] satisfies Array<readonly [string, string]>)

const ROLE_TEMPLATE_LOCALIZATIONS: Record<string, RoleTemplateLocalization> = {
  'builtin-frankl': { name: 'ViktorFrankl', description: 'Meaning therapy, responsibility, dignity in suffering, and direction for action.' },
  'builtin-camus': { name: 'AlbertCamus', description: 'Absurdity, revolt, freedom, dignity, and clear-eyed living.' },
  'builtin-nietzsche': { name: 'FriedrichNietzsche', description: 'Self-overcoming, revaluing values, amor fati, and life force.' },
  'builtin-wang-yangming': { name: 'WangYangming', description: 'Unity of knowing and doing, conscience, practice in real affairs, and self-cultivation.' },
  'builtin-steve-jobs': { name: 'SteveJobs', description: 'Product taste, focus, tradeoffs, aesthetics, and end-to-end experience.' },
  'builtin-inamori': { name: 'KazuoInamori', description: 'Management, self-cultivation, altruism, diligence, and long-term integrity.' },
  'builtin-drucker': { name: 'PeterDrucker', description: 'Self-management, contribution, time management, and results-oriented work.' },
  'builtin-munger': { name: 'CharlieMunger', description: 'Mental models, inversion, circle of competence, and avoiding major mistakes.' },
  'builtin-buffett': { name: 'WarrenBuffett', description: 'Long-term wealth, compounding, circle of competence, reputation, and prudent money habits.' },
  'builtin-howard-marks': { name: 'HowardMarks', description: 'Risk, cycles, probability, second-order thinking, and market psychology.' },
  'builtin-graham': { name: 'BenjaminGraham', description: 'Value investing, margin of safety, defensive investing, and Mr. Market.' },
  'builtin-peter-lynch': { name: 'PeterLynch', description: 'Everyday investment observation, fundamental research, and common-sense judgment.' },
  'builtin-dalio': { name: 'RayDalio', description: 'Principles, reflection, radical truth, systematic decision-making, and risk diversification.' },
  'builtin-naval': { name: 'NavalRavikant', description: 'Wealth, freedom, specific knowledge, leverage, ownership, and happiness.' },
  'builtin-zhang-yiming': { name: 'ZhangYiming', description: 'Long-term growth, delayed gratification, real feedback, and equanimity.' },
  'builtin-ren-zhengfei': { name: 'RenZhengfei', description: 'Organizational capability, customer value, crisis awareness, and growth from real battles.' },
  'builtin-feynman': { name: 'RichardFeynman', description: 'Learning, understanding, curiosity, simple explanation, and anti-jargon thinking.' },
  'builtin-kahneman': { name: 'DanielKahneman', description: 'Judgment bias, slow thinking, evidence, and decision process design.' },
  'builtin-taleb': { name: 'NassimTaleb', description: 'Antifragility, black swans, nonlinear risk, and barbell strategy.' },
  'builtin-bezos': { name: 'JeffBezos', description: 'Customer obsession, long-term thinking, flywheels, and working backwards.' },
  'builtin-musk': { name: 'ElonMusk', description: 'First principles, engineering decomposition, speed, and real constraints.' },
  'builtin-paul-graham': { name: 'PaulGraham', description: 'Early startups, MVPs, user pain, and doing things that do not scale.' },
  'builtin-thiel': { name: 'PeterThiel', description: 'Zero to one thinking, secrets, moats, and avoiding commodity competition.' },
  'builtin-huang-zheng': { name: 'HuangZheng', description: 'Supply-demand structure, group psychology, efficiency, price, and trust.' },
  'builtin-sam-altman': { name: 'SamAltman', description: 'AI-era opportunity, startups, fast learning, major trends, and leverage.' },
  'builtin-adler': { name: 'AlfredAdler', description: 'Inferiority and striving, separation of tasks, community feeling, and courage.' },
  'builtin-jung': { name: 'CarlJung', description: 'Shadow, persona, individuation, self-integration, and projection.' },
  'builtin-schopenhauer': { name: 'ArthurSchopenhauer', description: 'Desire, suffering, comparison, solitude, aesthetics, and restraint.' },
  'builtin-fei-xiaotong': { name: 'FeiXiaotong', description: 'Rural China, differential association, family ethics, and social pressure.' },
  'builtin-liang-shuming': { name: 'LiangShuming', description: 'Chinese culture, ethical relationships, life settlement, and modern tensions.' },
  'builtin-waldinger': { name: 'RobertWaldinger', description: 'Harvard adult development research, relationship quality, happiness, and long-term connection.' },
  'builtin-school-of-life': { name: 'SchoolOfLife', description: 'Emotional education, relationship repair, self-understanding, and practical philosophy.' },
  'builtin-kevin-kelly': { name: 'KevinKelly', description: 'Technology trends, complex systems, AI, creator economy, and experimentation.' },
  'builtin-toffler': { name: 'AlvinToffler', description: 'Future shock, the third wave, technology speed, and adaptation.' },
  'builtin-einstein': { name: 'AlbertEinstein', description: 'Curiosity, imagination, independent thinking, simple questions, and scientific spirit.' },
  'builtin-80000-hours': { name: 'EightyThousandHours', description: 'High-impact careers, fit, career capital, and exploration value.' },
  'builtin-who-health': { name: 'WHOHealth', description: 'Sleep, movement, nutrition, stress, and sustainable health habits.' },
  'builtin-wef-future': { name: 'WEFFuture', description: 'Global trends, future work, AI, macro risks, and skill building.' },
  'default-custom-product-manager': { name: 'ProductManager', description: 'Focuses on user needs, priorities, tradeoffs, and product experience.' },
  'default-custom-engineer': { name: 'Engineer', description: 'Focuses on implementation, complexity, stability, and maintainability.' },
  'default-custom-growth': { name: 'GrowthAdvisor', description: 'Focuses on target users, conversion paths, distribution, retention, and experiments.' },
}

export function normalizeLanguage(value: unknown): TeamLanguage {
  return value === 'en' ? 'en' : 'vi'
}

// Themis no longer guesses the language from the browser; new installs start in Vietnamese.
export function defaultLanguageForEnvironment(): TeamLanguage {
  return DEFAULT_LANGUAGE
}

// Interface text is written in English and translated by localization.js.
export function translateUi(source: string, language: TeamLanguage): string {
  return localizeUI(source, normalizeLanguage(language))
}

export function localizeCategory(category: string | undefined, language: TeamLanguage): string | undefined {
  if (!category) return undefined
  return localizeUI(category, normalizeLanguage(language))
}

// Built-in templates keep their English text in every language; localization.js translates on display.
export function localizeGroupTemplate(template: BuiltinGroupTemplate, _language: TeamLanguage): BuiltinGroupTemplate {
  const localization = GROUP_TEMPLATE_LOCALIZATIONS[template.id]
  const name = localization?.name ?? fallbackGroupTemplateName(template)
  return {
    ...template,
    name,
    category: localizeCategory(template.category, 'en') ?? template.category,
    summary: localization?.summary ?? fallbackGroupSummary(name),
    userTypes: localizeUserTypes(template.userTypes, localization),
    aliases: englishTemplateAliases(template, name),
    suggestedQuestions: englishTemplateQuestions(name),
    defaultChatName: name,
    roles: template.roles.map(role => localizeGroupTemplateRole(template, role, name)),
  }
}

export function localizeRoleTemplate(template: RoleTemplate, _language: TeamLanguage): RoleTemplate {
  if (template.type === 'custom') return template
  const direct = ROLE_TEMPLATE_LOCALIZATIONS[template.id]
  if (direct) {
    return {
      ...template,
      name: direct.name,
      category: localizeCategory(template.category, 'en'),
      description: direct.description,
      sourceTemplateName: localizeSourceTemplateName(template.sourceTemplateId, template.sourceTemplateName),
      systemPrompt: direct.systemPrompt ?? (template.systemPrompt?.trim() || englishAdvisorPrompt(direct.name, direct.description)),
    }
  }

  if (template.sourceTemplateId) {
    const sourceTemplateName = localizeSourceTemplateName(template.sourceTemplateId, template.sourceTemplateName)
    const roleName = localizeRoleName(template.name, sourceTemplateName, template.sourceTemplateId)
    const description = template.description?.trim() || localizeRoleDescription(template.name, sourceTemplateName)
    return {
      ...template,
      name: roleName,
      category: localizeCategory(template.category, 'en'),
      description,
      sourceTemplateName,
      systemPrompt: template.systemPrompt?.trim() || englishRolePrompt(roleName, description),
    }
  }

  if (template.type === 'builtin') {
    const roleName = fallbackRoleName(template.name, 'BuiltInAdvisor')
    const description = template.description?.trim() || 'Built-in advisor persona.'
    return {
      ...template,
      name: roleName,
      category: localizeCategory(template.category, 'en'),
      description,
      systemPrompt: template.systemPrompt?.trim() || englishRolePrompt(roleName, description),
    }
  }

  return template
}

function localizeGroupTemplateRole(template: BuiltinGroupTemplate, role: BuiltinGroupTemplateRole, groupName: string): BuiltinGroupTemplateRole {
  const name = localizeRoleName(role.name, groupName, template.id)
  const description = role.description?.trim() || fallbackRoleDescription(name, groupName)
  return {
    name,
    description,
    systemPrompt: role.systemPrompt?.trim() || englishRolePrompt(name, description),
  }
}

function localizeRoleName(rawName: string, groupName: string | undefined, sourceTemplateId?: string): string {
  const baseName = baseRoleName(rawName)
  return ROLE_NAME_TRANSLATIONS[baseName] ?? fallbackRoleName(groupName ?? sourceTemplateId ?? rawName, 'Specialist')
}

function localizeRoleDescription(rawName: string, groupName: string | undefined): string {
  return fallbackRoleDescription(localizeRoleName(rawName, groupName), groupName ?? 'this workflow')
}

function localizeSourceTemplateName(sourceTemplateId: string | undefined, sourceTemplateName: string | undefined): string | undefined {
  if (!sourceTemplateId && !sourceTemplateName) return undefined
  return sourceTemplateId ? GROUP_TEMPLATE_LOCALIZATIONS[sourceTemplateId]?.name ?? sourceTemplateName : sourceTemplateName
}

function baseRoleName(name: string): string {
  const parts = name.split('·')
  return parts[parts.length - 1]?.trim() || name
}

function englishRolePrompt(name: string, description: string): string {
  return [
    `You are ${name}.`,
    description,
    'Ask for missing context before making firm recommendations. Give concrete outputs, state assumptions, and call out risks or limits. Follow the user\'s requested reply language and the persona language. Otherwise, use the language of the latest user message.',
  ].join('\n\n')
}

function englishAdvisorPrompt(name: string, description: string): string {
  return [
    `You are ${name}, an advisory persona inspired by public ideas around: ${description}`,
    'You are not the original person and should not fabricate quotes. Help the user reason clearly, separate facts from judgments, and turn insight into practical next actions. Follow the user\'s requested reply language and the persona language. Otherwise, use the language of the latest user message.',
  ].join('\n\n')
}

function fallbackGroupTemplateName(template: Pick<BuiltinGroupTemplate, 'id' | 'name'>): string {
  return `${titleCaseIdentifier(template.id || template.name)} Group`
}

function fallbackGroupSummary(groupName: string): string {
  return `Ready-made AI team for ${stripGroupSuffix(groupName).toLowerCase()} work. It helps clarify goals, organize inputs, draft useful outputs, review risks, and define next actions.`
}

function fallbackRoleDescription(name: string, groupName: string): string {
  return `${name} supports ${stripGroupSuffix(groupName).toLowerCase()} work with concrete analysis, useful drafts, risk checks, and next actions.`
}

function localizeUserTypes(userTypes: string[], localization: GroupTemplateLocalization | undefined): string[] {
  if (localization?.userTypes) return localization.userTypes
  return userTypes.map(fallbackUserType)
}

function fallbackUserType(userType: string): string {
  if (/^[\w\s./+-]+$/.test(userType)) return userType
  return 'Relevant users'
}

function englishTemplateAliases(template: BuiltinGroupTemplate, groupName: string): string[] {
  return [
    stripGroupSuffix(groupName),
    template.id,
    localizeCategory(template.category, 'en') ?? '',
    ...template.roles.map(role => localizeRoleName(role.name, groupName, template.id)),
  ].filter(Boolean)
}

function englishTemplateQuestions(groupName: string): string[] {
  return [
    'What problem do I want to solve?',
    'What materials or background do I already have?',
    'What final output do I need?',
    `Help me clarify the goal, context, and missing information for this ${stripGroupSuffix(groupName).toLowerCase()} task.`,
    'Create an information checklist from my materials.',
    'Ask the right roles to review this and summarize consensus, risks, and next actions.',
  ]
}

function fallbackRoleName(value: string, suffix: string): string {
  const readable = titleCaseIdentifier(value)
  const collapsed = readable.replace(/\s+/g, '')
  return collapsed.endsWith(suffix) ? collapsed : `${collapsed}${suffix}`
}

function titleCaseIdentifier(value: string): string {
  const withoutHan = value.replace(/[\u3400-\u9fff]+/g, ' ')
  const words = withoutHan
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (words.length === 0) return 'Themis'
  return words.map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}

function stripGroupSuffix(value: string): string {
  return value.replace(/\s+Group$/, '')
}
