// ============================================================================
// Types Index - Re-exports all types for convenient imports
// ============================================================================

// Settings
export type {
  SettingsAware,
  PluginSettings,
  ModelSettings,
  PromptSettings,
  GenerationConfigSettings,
  GenerationConfigMap,
} from "./settings";

// Defaults
export { DEFAULT_SETTINGS } from "./defaults";

// Calendar
export type {
  CalendarEvent,
  Attendee,
  Attachment,
  BriefingQueueItem,
  MeetingRule,
} from "./calendar";

// Gmail
export type { GmailMessage } from "./gmail";

// API
export type {
  AppsScriptResponse,
  GeminiResponse,
  TemplaterObject,
} from "./api";

// Inbox
export type {
  InboxContentType,
  InboxRouteDestination,
  InboxFormatStyle,
  InboxTriggerSettings,
  InboxRuleMatch,
  InboxRuleAction,
  InboxRoutingRule,
  InboxRoutingSettings,
  InboxActionDetectionSettings,
  InboxFormattingSettings,
  InboxContentSummarySettings,
  InboxSettings,
  InboxItem,
  InboxURIParams,
} from "./inbox";

// Council
export type {
  LlmCouncilIdeatorPrompts,
  LlmCouncilIdeatorModels,
  LlmCouncilExecutorModels,
  LlmCouncilPrompts,
  LlmCouncilGenerationConfigs,
  LlmCouncilSettings,
  LlmCouncilIdea,
  LlmCouncilExecution,
  LlmCouncilJudgeScore,
  LlmCouncilJudgment,
  LlmCouncilRunResult,
} from "./council";

// Research
export type {
  PersonResearchResult,
  ExtractedPersonInfo,
  OrgLinkResult,
  OrgResearchResult,
  PersonFrontmatter,
  OrgFrontmatter,
} from "./research";

// Reference
export type {
  ReferenceSourceType,
  TopicNode,
  TopicHierarchy,
  ReferenceSettings,
} from "./reference";

// O3
export type { O3Settings, O3CoachSettings } from "./o3";

// OpenRouter
export type {
  OpenRouterModelPricing,
  OpenRouterModelArchitecture,
  OpenRouterModel,
  OpenRouterSettings,
} from "./openrouter";

// Webhook
export type { WebhookSettings, AmieWebhookPayload } from "./webhook";

// Feedback
export type { FeedbackEntry, FeedbackStore } from "./feedback";
