// ============================================================================
// Default Settings
// ============================================================================

import { PROMPTS } from "../prompts";
import type { PluginSettings } from "./settings";

export const DEFAULT_SETTINGS: PluginSettings = {
  geminiApiKey: "",
  openaiApiKey: "",
  anthropicApiKey: "",
  openrouterApiKey: "",
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
  parallelBriefings: 3,
  apiDelayMs: 500,

  models: {
    filterModel: "gemini-flash-latest",
    briefingModel: "gemini-pro-latest",
    personResearchModel: "gemini-pro-latest",
    orgResearchModel: "gemini-pro-latest",
    phoneValidationModel: "gemini-pro-latest",
    inboxRoutingModel: "gemini-flash-latest",
    settingsHelperModel: "gemini-flash-latest",
    o3PrepModel: "gemini-flash-latest",
  },

  prompts: {
    meetingFilter: PROMPTS.meetingFilter,
    meetingBriefing: PROMPTS.meetingBriefing,
    personResearch: PROMPTS.personResearch,
    orgResearch: PROMPTS.orgResearch,
    inboxRouting: PROMPTS.inboxRouting,
    research: PROMPTS.research,
  },

  generationConfigs: {
    meetingFilter: { temperature: 0.0, thinkingBudget: null },
    meetingBriefing: { temperature: 0.2, thinkingBudget: "medium" },
    personResearch: { temperature: 0.2, thinkingBudget: "medium" },
    orgResearch: { temperature: 0.2, thinkingBudget: "medium" },
    phoneValidation: { temperature: 0.0, thinkingBudget: "low" },
    inboxRouting: { temperature: 0.0, thinkingBudget: null },
    research: { temperature: 0.2, thinkingBudget: "high" },
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

  inbox: {
    enabled: true,
    thoughtsSection: "## Thoughts",
    smartSuggestionsEnabled: true,
    meetingWindowMinutes: 15,
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

  webhook: {
    enabled: false,
    port: 3456,
    apiKey: "",
    bindAddress: "127.0.0.1",
  },

  openrouter: {
    modelCache: [],
    lastFetched: null,
    selectedModels: [],
    freeModelRank: [],
    benchmarks: {
      arenaScores: {},
      openLlmScores: {},
      openLlmFetched: {},
      lastFetched: null,
    },
  },

  reference: {
    enabled: true,
    referencesFolder: "References",
    topicsFilePath: "Z_Settings & Tools/Topics.md",
    urlTriggers: ["Ref:", "Reference:", "Save:"],
    autoProcess: true,
    dailyNoteLink: true,
  },
};
