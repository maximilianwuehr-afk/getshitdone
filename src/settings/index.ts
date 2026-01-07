// ============================================================================
// Settings Index - Re-exports for convenient imports
// ============================================================================

// Main settings tab
export { GetShitDoneSettingTab } from "./settings-tab";
export type { SettingsTabId } from "./settings-tab";

// Tab renderers (for direct use if needed)
export { renderGeneralTab } from "./general-tab";
export { renderDailyNotesTab } from "./daily-tab";
export { renderApiTab } from "./api-tab";
export { renderOpenRouterTab, createOpenRouterTabState } from "./openrouter-tab";
export type { OpenRouterTabState, OpenRouterSortKey } from "./openrouter-tab";
export { renderInboxTab } from "./inbox-tab";
export { renderAiTab } from "./ai-tab";
export { renderCouncilTab } from "./council-tab";

// Helpers (for use by other modules)
export {
  createSection,
  createSubsection,
  createDetailsSection,
  parseList,
  formatList,
  createListSetting,
  addSecretSetting,
  addTriStateDropdown,
  formatRuleSummary,
  filterContentTypes,
  parseOptionalNumber,
  createDefaultRoutingRule,
  cloneRoutingRule,
  createRuleId,
  getSettingsHelperModel,
  canUseModel,
  isOpenRouterModel,
  openSettingsHelperModal,
  cloneInboxSettings,
  createGenerationConfigSetting,
  createCouncilGenerationConfigSetting,
  createPromptSetting,
} from "./helpers";
export type { SettingsHelperOptions, SettingsHelperPlugin } from "./helpers";
