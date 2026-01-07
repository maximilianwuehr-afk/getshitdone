// ============================================================================
// Inbox Module - Re-exports for convenient imports
// ============================================================================

// Main action class
export { InboxAction } from "./inbox-action";

// Types
export { DailyNoteNotReadyError } from "./types";
export type { InboxRouteDecision, SummarizeAPI } from "./types";

// Routing
export {
  routeItem,
  routeItemDeterministic,
  routeWithAI,
  formatDestinationLabel,
  isURL,
  looksLikeActionItem,
  hasTaskCheckbox,
} from "./router";

// Formatting
export {
  appendToDestination,
  appendToThoughtsSection,
  insertAfterMeetingLine,
  formatAsTask,
  formatAsThought,
  formatAsMeetingFollowup,
  getDailyNotePath,
  findDailyNoteByDate,
  findLatestDailyNote,
  extractFirstUrl,
  getSummarizeApi,
  parseSummaryWithTags,
  formatSummaryAsIndentedBullet,
} from "./formatter";

// Triggers
export {
  detectTriggerPhrase,
  handleReferenceTrigger,
  handleResearchTrigger,
  handleFollowupTrigger,
  escapeRegex,
  getLeadingPhraseMatch,
  stripLeadingPhrase,
  normalizeTriggerContent,
  stripTaskPrefix,
  stripDueDateMarkers,
} from "./triggers";

// Entity detection
export {
  extractEntities,
  detectEntityMentions,
  formatWithEntityLinks,
  SmartSuggestionModal,
  showSmartSuggestion,
} from "./entity-detector";

// Date parsing
export { parseNaturalLanguageDate, formatDueDate } from "./date-parser";
