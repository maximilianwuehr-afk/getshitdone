import { App, TFile } from "obsidian";
import { PROMPTS } from "./prompts";

// ============================================================================
// Settings Management
// ============================================================================

/**
 * Interface for components that need to be notified of settings changes.
 * Implement this interface and register with the plugin to receive updates.
 */
export interface SettingsAware {
  updateSettings(settings: PluginSettings): void;
}

// ============================================================================
// Plugin Settings
// ============================================================================

export interface PluginSettings {
  // API Configuration
  geminiApiKey: string;
  openaiApiKey: string;
  anthropicApiKey: string;
  appsScriptUrl: string;
  appsScriptSecret: string;

  // Identity (for filtering)
  yourDomain: string;
  excludeEmails: string[];
  excludeNames: string[];

  // Folder Paths
  peopleFolder: string;
  organizationsFolder: string;
  meetingsFolder: string;

  // Triggers (explicit toggles)
  autoResearchPeopleOnOpen: boolean;
  autoResearchOrgsOnOpen: boolean;

  // Meeting Behavior
  excludeTitles: string[];
  maxListedParticipants: number;

  // Performance Settings
  parallelBriefings: number; // How many briefings to process in parallel
  apiDelayMs: number; // Minimum delay between API batches

  // Models (editable in settings)
  models: ModelSettings;

  // Prompts (editable in settings)
  prompts: PromptSettings;

  // Gemini generation config (editable in settings)
  generationConfigs: GenerationConfigMap;

  // Inbox settings
  inbox: InboxSettings;

  // LLM Council settings
  llmCouncil: LlmCouncilSettings;

  // O3 prep settings
  o3: O3Settings;
  o3Coach: O3CoachSettings;

  // Webhook settings
  webhook: WebhookSettings;
}

export interface ModelSettings {
  filterModel: string;
  briefingModel: string;
  personResearchModel: string;
  orgResearchModel: string;
  phoneValidationModel: string;
  inboxRoutingModel: string;
  settingsHelperModel: string;
  o3PrepModel: string;
}

export interface PromptSettings {
  meetingFilter: string;
  meetingBriefing: string;
  personResearch: string;
  orgResearch: string;
  inboxRouting: string;
  research: string;
}

export interface O3Settings {
  enabled: boolean;
  masterNotePath: string;
  meetingTitleRegex: string;
  dailyNoteInsert: boolean;
}

export interface O3CoachSettings {
  lookbackDays: number;
  perfReviewFolder: string;
  perfReviewMax: number;
  currentNotesMax: number;
}

// ============================================================================
// Webhook Types
// ============================================================================

export interface WebhookSettings {
  enabled: boolean;
  port: number;
  apiKey: string;
  bindAddress: "127.0.0.1" | "0.0.0.0";
}

export interface AmieWebhookPayload {
  recordingId: string;
  workspaceId: string;
  userId: string;
  userEmail: string;
  title: string;
  summary: string;
  shortSummary: string;
  mdSummary: string;
  suggestedTitle: string;
  transcript: string;
  recordingLink: string;
  createdAt: string;
  updatedAt: string;
  metadata: {
    providerCalendarEventId: string;
    providerCalendarId: string;
    startAt: string;
    endAt: string;
    title: string;
    description: string;
    guests: Array<{ email: string; displayName: string }>;
  };
}

// ============================================================================
// Inbox Types
// ============================================================================

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

// Note: routing rules are defined in InboxRoutingRule (above).

export interface InboxItem {
  content: string;
  type: InboxContentType;
  source: "share" | "shortcut" | "manual" | "uri";
  timestamp: string;
  // Routing result
  destination?: InboxRouteDestination;
  meetingContext?: CalendarEvent;
  formatted?: string;
}

export interface InboxURIParams {
  content?: string;
  type?: string;
  source?: string;
  [key: string]: string | undefined;  // Allow additional params from Obsidian URI handler
}

// ============================================================================
// LLM Council Types
// ============================================================================

export interface LlmCouncilIdeatorPrompts {
  feynman: string;
  taleb: string;
  daVinci: string;
  fuller: string;
}

export interface LlmCouncilIdeatorModels {
  feynman: string;
  taleb: string;
  daVinci: string;
  fuller: string;
}

export interface LlmCouncilExecutorModels {
  executor1: string;
  executor2: string;
  executor3: string;
}

export interface LlmCouncilPrompts {
  ideators: LlmCouncilIdeatorPrompts;
  executor: string;
  judge: string;
}

export interface LlmCouncilGenerationConfigs {
  ideation: GenerationConfigSettings;
  execution: GenerationConfigSettings;
  judgment: GenerationConfigSettings;
}

export interface LlmCouncilSettings {
  enabled: boolean;
  runsPath: string;
  prompts: LlmCouncilPrompts;
  ideatorModels: LlmCouncilIdeatorModels;
  executorModels: LlmCouncilExecutorModels;
  judgeModel: string;
  generationConfig: LlmCouncilGenerationConfigs;
}

// LLM Council Result Types
export interface LlmCouncilIdea {
  run_id: string;
  phase: "ideas";
  persona_id: string;
  persona: string;
  thesis: string;
  plan_steps: Array<{
    step: string;
    rationale: string;
    mini_artifact: string;
  }>;
  risks: string[];
  anti_plan: string[];
  falsifiers: string[];
  sources: Array<{
    title?: string;
    url: string;
  }>;
  markdown_body?: string; // Full markdown body from response
}

export interface LlmCouncilExecution {
  executorName: string;
  model: string;
  content: string;
  title: string;
}

export interface LlmCouncilJudgeScore {
  executor: string;
  raw_scores: Record<string, number>;
  weighted_total: number;
  notes: string;
}

export interface LlmCouncilJudgment {
  run_id: string;
  phase: "judge";
  rubric_weights: Record<string, number>;
  scores: LlmCouncilJudgeScore[];
  winner: string;
  synthesis: string;
  next_actions: string[];
  sources: Array<{
    title?: string;
    url: string;
  }>;
}

export interface LlmCouncilRunResult {
  runId: string;
  inputPath: string;
  ideas: LlmCouncilIdea[];
  executions: LlmCouncilExecution[];
  judgment: LlmCouncilJudgment | null;
  outputPath: string;
}

// ============================================================================
// Gemini Generation Config
// ============================================================================

export interface GenerationConfigSettings {
  temperature: number;
  /**
   * Reasoning effort level (low/medium/high).
   * - For Gemini: Maps to thinkingBudget tokens (low=512, medium=2048, high=4096)
   * - For OpenAI o1/o3 models: Maps to reasoning_effort parameter
   * - If null, omitted entirely (no thinking/reasoning)
   */
  thinkingBudget: "low" | "medium" | "high" | null;
}

export interface GenerationConfigMap {
  meetingFilter: GenerationConfigSettings;
  meetingBriefing: GenerationConfigSettings;
  personResearch: GenerationConfigSettings;
  orgResearch: GenerationConfigSettings;
  phoneValidation: GenerationConfigSettings;
  inboxRouting: GenerationConfigSettings;
  research: GenerationConfigSettings;
  o3Prep: GenerationConfigSettings;
}

// ============================================================================
// Feedback Types
// ============================================================================

export interface FeedbackEntry {
  id: string;
  timestamp: string;
  type: "briefing" | "person" | "org";
  notePath: string;
  issue: string;
  originalContent?: string;
}

export interface FeedbackStore {
  entries: FeedbackEntry[];
  lastUpdated: string;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  geminiApiKey: "",
  openaiApiKey: "",
  anthropicApiKey: "",
  appsScriptUrl: "",
  appsScriptSecret: "",

  yourDomain: "finn.com",
  excludeEmails: [],
  excludeNames: [],

  peopleFolder: "People",
  organizationsFolder: "Organizations",
  meetingsFolder: "Meetings",

  autoResearchPeopleOnOpen: true,
  autoResearchOrgsOnOpen: true,

  excludeTitles: [
    "Blocker",
    "Deep Work",
    "Deep Work Day",
    "Travel",
    "Lunch",
    "Focus Time",
  ],
  maxListedParticipants: 10,

  // Performance defaults
  parallelBriefings: 3, // Process 3 meetings in parallel
  apiDelayMs: 500, // 500ms between batches

  models: {
    // Gemini models: gemini-flash-latest, gemini-pro-latest
    // OpenAI models: gpt-4o, gpt-4o-mini, o1-preview, o3-mini
    filterModel: "gemini-flash-latest", // or "gpt-4o-mini"
    briefingModel: "gemini-pro-latest", // or "gpt-4o"
    personResearchModel: "gemini-pro-latest", // or "gpt-4o"
    orgResearchModel: "gemini-pro-latest", // or "gpt-4o"
    phoneValidationModel: "gemini-pro-latest", // or "gpt-4o-mini"
    inboxRoutingModel: "gemini-flash-latest", // or "gpt-4o-mini"
    settingsHelperModel: "gemini-flash-latest",
    o3PrepModel: "gemini-flash-latest",
  },

  prompts: {
    // Prompts are loaded from markdown files in the prompts/ directory
    // See src/prompts.ts (auto-generated) and scripts/generate-prompts.js
    // Edit prompts in prompts/*.md files, then run: npm run generate-prompts
    // Or rebuild the plugin, which will automatically regenerate prompts.ts
    meetingFilter: PROMPTS.meetingFilter,
    meetingBriefing: PROMPTS.meetingBriefing,
    personResearch: PROMPTS.personResearch,
    orgResearch: PROMPTS.orgResearch,
    inboxRouting: PROMPTS.inboxRouting,
    research: PROMPTS.research,
  },

  generationConfigs: {
    // Fast, deterministic routing
    meetingFilter: { temperature: 0.0, thinkingBudget: null },
    // Short, grounded synthesis (thinking optional)
    meetingBriefing: { temperature: 0.2, thinkingBudget: "medium" },
    // Deep research with web search
    personResearch: { temperature: 0.2, thinkingBudget: "medium" },
    orgResearch: { temperature: 0.2, thinkingBudget: "medium" },
    // Deterministic extraction / selection
    phoneValidation: { temperature: 0.0, thinkingBudget: "low" },
    // Fast inbox routing classification
    inboxRouting: { temperature: 0.0, thinkingBudget: null },
    // Deep research with web search (max effort)
    research: { temperature: 0.2, thinkingBudget: "high" },
    // O3 prep synthesis
    o3Prep: { temperature: 0.2, thinkingBudget: "low" },
  },

  o3: {
    enabled: true,
    masterNotePath: "FINN/O3 prep.md",
    meetingTitleRegex: "\\bO3\\b|\\b1:1\\b|\\b1-1\\b|one-on-one",
    dailyNoteInsert: true,
  },

  o3Coach: {
    lookbackDays: 21,
    perfReviewFolder: "Y_Resources/FINN Files",
    perfReviewMax: 6,
    currentNotesMax: 50,
  },

  // Inbox settings
  inbox: {
    enabled: true,
    thoughtsSection: "## Thoughts",
    smartSuggestionsEnabled: true, // enable smart suggestions
    meetingWindowMinutes: 15,      // 15 min before/after meeting
    triggers: {
      enabled: true,
      followupPhrases: ["follow up", "follow-up", "followup"],
      researchPhrases: ["research"],
      contentPhrases: ["read", "watch", "listen", "review", "summarize", "check out"],
    },
    routing: {
      aiFallbackEnabled: true,
      defaultDestination: "daily_thoughts",
      defaultFormat: "auto",
      defaultAddDueDate: true,
      rules: [
        {
          id: "task-type-meeting",
          name: "Task type (in meeting)",
          enabled: true,
          match: { contentTypes: ["task"], inMeeting: true },
          action: {
            destination: "meeting_followup",
            format: "task",
            addDueDate: true,
          },
        },
        {
          id: "task-type",
          name: "Task type",
          enabled: true,
          match: { contentTypes: ["task"] },
          action: {
            destination: "daily_thoughts",
            format: "task",
            addDueDate: true,
          },
        },
        {
          id: "task-checkbox-meeting",
          name: "Task checkbox (in meeting)",
          enabled: true,
          match: { hasTaskCheckbox: true, inMeeting: true },
          action: {
            destination: "meeting_followup",
            format: "task",
            addDueDate: true,
          },
        },
        {
          id: "task-checkbox",
          name: "Task checkbox",
          enabled: true,
          match: { hasTaskCheckbox: true },
          action: {
            destination: "daily_thoughts",
            format: "task",
            addDueDate: true,
          },
        },
        {
          id: "explicit-transcript",
          name: "Explicit transcript/screenshot",
          enabled: true,
          match: { contentTypes: ["transcript", "screenshot"] },
          action: {
            destination: "daily_thoughts",
            format: "thought",
            addDueDate: false,
          },
        },
        {
          id: "url-content",
          name: "URL content",
          enabled: true,
          match: { isUrl: true },
          action: {
            destination: "daily_thoughts",
            format: "thought",
            addDueDate: false,
          },
        },
        {
          id: "long-content",
          name: "Long content",
          enabled: true,
          match: { minLength: 500 },
          action: {
            destination: "daily_thoughts",
            format: "thought",
            addDueDate: false,
          },
        },
        {
          id: "action-item-meeting",
          name: "Action item (in meeting)",
          enabled: true,
          match: { actionItem: true, inMeeting: true },
          action: {
            destination: "meeting_followup",
            format: "task",
            addDueDate: true,
          },
        },
        {
          id: "action-item",
          name: "Action item",
          enabled: true,
          match: { actionItem: true },
          action: {
            destination: "daily_thoughts",
            format: "task",
            addDueDate: true,
          },
        },
      ],
    },
    actionDetection: {
      enabled: true,
      verbs: [
        "call",
        "email",
        "send",
        "follow up",
        "followup",
        "follow-up",
        "check",
        "schedule",
        "book",
        "set up",
        "setup",
        "arrange",
        "organize",
        "review",
        "prepare",
        "draft",
        "write",
        "create",
        "update",
        "remind",
        "ask",
        "confirm",
        "reach out",
        "contact",
        "todo",
        "to-do",
        "action",
        "task",
        "need to",
        "remember to",
        "do",
        "make",
        "fix",
        "complete",
        "finish",
        "start",
        "begin",
      ],
      matchMode: "both",
      includeImperativePattern: true,
      includeShortContent: true,
      shortContentMaxChars: 100,
    },
    formatting: {
      defaultDueDateOffset: 1,
      dueDateEmoji: "📅",
      taskPrefix: "- [ ]",
      timeFormat: "HH:mm",
    },
    contentSummary: {
      enabled: true,
      takeawaysCount: 4,
      maxWordsPerTakeaway: 15,
    },
  },

  // LLM Council settings
  llmCouncil: {
    enabled: true,
    runsPath: "Z_Settings & Tools/llm_council/runs",
    prompts: {
      ideators: {
        feynman: "Z_Settings & Tools/llm_council/prompts/Ideator_Richard_Feynman.md",
        taleb: "Z_Settings & Tools/llm_council/prompts/Ideator_Nassim_Taleb.md",
        daVinci: "Z_Settings & Tools/llm_council/prompts/Ideator_Leonard_daVinci.md",
        fuller: "Z_Settings & Tools/llm_council/prompts/Ideator_Buckminster_Fuller.md",
      },
      executor: "Z_Settings & Tools/llm_council/prompts/Executor.md",
      judge: "Z_Settings & Tools/llm_council/prompts/Judge.md",
    },
    ideatorModels: {
      feynman: "gemini-pro-latest",
      taleb: "gemini-pro-latest",
      daVinci: "gemini-pro-latest",
      fuller: "gemini-pro-latest",
    },
    executorModels: {
      executor1: "gemini-pro-latest",
      executor2: "claude-opus-4-5-20251101",
      executor3: "gpt-5.2",
    },
    judgeModel: "claude-opus-4-5-20251101",
    generationConfig: {
      ideation: { temperature: 1.0, thinkingBudget: "high" },
      execution: { temperature: 0.2, thinkingBudget: "high" },
      judgment: { temperature: 0.1, thinkingBudget: "high" },
    },
  },

  // Webhook settings
  webhook: {
    enabled: false,
    port: 3456,
    apiKey: "",
    bindAddress: "127.0.0.1",
  },
};

// ============================================================================
// Calendar & Event Types
// ============================================================================

export interface CalendarEvent {
  id: string;
  recurringEventId?: string;
  summary?: string;
  description?: string;
  start: {
    dateTime?: string;
    date?: string;
  };
  end: {
    dateTime?: string;
    date?: string;
  };
  attendees?: Attendee[];
  attachments?: Attachment[];
}

export interface Attendee {
  email: string;
  displayName?: string;
  responseStatus?: "needsAction" | "declined" | "tentative" | "accepted";
  self?: boolean;
}

export interface Attachment {
  title: string;
  fileUrl: string;
  mimeType?: string;
}

// ============================================================================
// Gmail Types
// ============================================================================

export interface GmailMessage {
  messageId?: string;
  subject: string;
  from: string;
  to?: string;
  date: string;
  snippet?: string;
  body?: string;
}

// ============================================================================
// Research Types
// ============================================================================

export interface PersonResearchResult {
  success: boolean;
  personName: string;
  email?: string;
  orgResult?: OrgLinkResult;
  extractedInfo?: ExtractedPersonInfo;
}

export interface ExtractedPersonInfo {
  title?: string;
  organization?: string;
  location?: string;
  phone?: string;
}

export interface OrgLinkResult {
  name: string;
  created: boolean;
  domain?: string;
}

export interface OrgResearchResult {
  success: boolean;
  orgName: string;
  domain?: string;
}

// ============================================================================
// Frontmatter Types
// ============================================================================

export interface PersonFrontmatter {
  Title?: string;
  Organization?: string;
  Location?: string;
  Phone?: string;
  Email?: string;
  researched?: boolean | string;
  tags?: string[];
  created?: string;
}

export interface OrgFrontmatter {
  Domain?: string;
  researched?: boolean | string;
  tags?: string[];
}

// ============================================================================
// Queue Types (for async briefing processing)
// ============================================================================

export interface BriefingQueueItem {
  event: CalendarEvent;
  anchor: string;
  participants: Attendee[];
  noteTitle: string;
}

// ============================================================================
// Meeting Routing Rules
// ============================================================================

export interface MeetingRule {
  match: RegExp | ((e: CalendarEvent) => boolean);
  to?: string | ((e: CalendarEvent) => string);
  folder?: string | ((e: CalendarEvent) => string);
  listParticipants?: number | false;
  title?: string | ((e: CalendarEvent) => string);
}

// ============================================================================
// Templater Integration
// ============================================================================

export interface TemplaterObject {
  file: {
    path: (relative?: boolean) => string;
    content: string;
  };
}

// ============================================================================
// API Response Types
// ============================================================================

export interface AppsScriptResponse {
  success: boolean;
  emails?: GmailMessage[];
  text?: string;
  error?: string;
}

export interface GeminiResponse {
  candidates?: {
    content?: {
      parts?: { text: string }[];
    };
  }[];
  error?: {
    message: string;
  };
}
