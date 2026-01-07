// ============================================================================
// Settings Management
// ============================================================================

import type { InboxSettings } from "./inbox";
import type { LlmCouncilSettings } from "./council";
import type { O3Settings, O3CoachSettings } from "./o3";
import type { WebhookSettings } from "./webhook";
import type { OpenRouterSettings } from "./openrouter";
import type { ReferenceSettings } from "./reference";

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
  openrouterApiKey: string;
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
  parallelBriefings: number;
  apiDelayMs: number;

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

  // OpenRouter settings
  openrouter: OpenRouterSettings;

  // Reference system settings
  reference: ReferenceSettings;
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

// ============================================================================
// Generation Config
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
