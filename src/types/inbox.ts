// ============================================================================
// Inbox Types
// ============================================================================

import type { CalendarEvent } from "./calendar";

export type InboxContentType = "task" | "thought" | "link" | "transcript" | "screenshot" | "unknown";
export type InboxRouteDestination = "meeting_followup" | "daily_thoughts" | "daily_end";
export type InboxFormatStyle = "task" | "thought" | "auto";

export interface InboxTriggerSettings {
  enabled: boolean;
  followupPhrases: string[];
  researchPhrases: string[];
  contentPhrases: string[];
}

export interface InboxRuleMatch {
  contentTypes?: InboxContentType[];
  contentStartsWith?: string[];
  contentIncludes?: string[];
  contentRegex?: string;
  regexFlags?: string;
  isUrl?: boolean;
  hasTaskCheckbox?: boolean;
  actionItem?: boolean;
  minLength?: number;
  maxLength?: number;
  inMeeting?: boolean;
}

export interface InboxRuleAction {
  destination: InboxRouteDestination;
  format: InboxFormatStyle;
  addDueDate: boolean;
  dueDateOffset?: number;
}

export interface InboxRoutingRule {
  id: string;
  name: string;
  enabled: boolean;
  match: InboxRuleMatch;
  action: InboxRuleAction;
}

export interface InboxRoutingSettings {
  aiFallbackEnabled: boolean;
  rules: InboxRoutingRule[];
  defaultDestination: InboxRouteDestination;
  defaultFormat: InboxFormatStyle;
  defaultAddDueDate: boolean;
}

export interface InboxActionDetectionSettings {
  enabled: boolean;
  verbs: string[];
  matchMode: "starts_with" | "contains" | "both";
  includeImperativePattern: boolean;
  includeShortContent: boolean;
  shortContentMaxChars: number;
}

export interface InboxFormattingSettings {
  defaultDueDateOffset: number;
  dueDateEmoji: string;
  taskPrefix: string;
  timeFormat: string;
}

export interface InboxContentSummarySettings {
  enabled: boolean;
  takeawaysCount: number;
  maxWordsPerTakeaway: number;
}

export interface InboxSettings {
  enabled: boolean;
  thoughtsSection: string;
  meetingWindowMinutes: number;
  smartSuggestionsEnabled: boolean;
  triggers: InboxTriggerSettings;
  routing: InboxRoutingSettings;
  actionDetection: InboxActionDetectionSettings;
  formatting: InboxFormattingSettings;
  contentSummary: InboxContentSummarySettings;
}

export interface InboxItem {
  content: string;
  type: InboxContentType;
  source: "share" | "shortcut" | "manual" | "uri";
  timestamp: string;
  destination?: InboxRouteDestination;
  meetingContext?: CalendarEvent;
  formatted?: string;
}

export interface InboxURIParams {
  content?: string;
  type?: string;
  source?: string;
  [key: string]: string | undefined;
}
