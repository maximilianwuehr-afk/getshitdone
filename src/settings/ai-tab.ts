// ============================================================================
// AI Tab - Models, prompts, and generation configs
// ============================================================================

import { Setting, Notice } from "obsidian";
import type GetShitDonePlugin from "../main";
import { DEFAULT_SETTINGS } from "../types";
import {
  createSection,
  createDetailsSection,
  createGenerationConfigSetting,
  createPromptSetting,
} from "./helpers";

// ============================================================================
// Public API
// ============================================================================

export function renderAiTab(
  containerEl: HTMLElement,
  plugin: GetShitDonePlugin,
  onRefresh: () => void
): void {
  containerEl.createEl("p", {
    text: "Choose models and (optionally) edit prompts and generation settings.",
    cls: "setting-item-description",
  });
  containerEl.createEl("p", {
    text: "OpenRouter models use provider/model IDs (e.g., openai/gpt-4o-mini).",
    cls: "setting-item-description",
  });

  renderModelQuickApply(containerEl, plugin, onRefresh);

  const modelDetails = createDetailsSection(
    containerEl,
    "Per-workflow models (advanced)",
    "Override the default model for specific workflows."
  );
  renderModels(modelDetails, plugin, onRefresh, { includeHeader: false });

  const configDetails = createDetailsSection(
    containerEl,
    "Generation config (advanced)",
    "Control temperature and reasoning effort per workflow."
  );
  renderGenerationConfigs(configDetails, plugin, onRefresh, { includeHeader: false });

  const promptDetails = createDetailsSection(
    containerEl,
    "Prompts (advanced)",
    "Edit the exact prompts used for each workflow."
  );
  renderPrompts(promptDetails, plugin, { includeHeader: false });
}

// ============================================================================
// Private Helpers
// ============================================================================

function renderModelQuickApply(
  containerEl: HTMLElement,
  plugin: GetShitDonePlugin,
  onRefresh: () => void
): void {
  createSection(
    containerEl,
    "Model defaults",
    "Set one model for everything, then override only where needed."
  );

  let bulkModel = plugin.settings.models.briefingModel || "";

  const bulkSetting = new Setting(containerEl)
    .setName("Default model")
    .setDesc("Apply this model name to all workflows.");

  bulkSetting.addText((text) =>
    text
      .setPlaceholder("gemini-flash-latest or gpt-4o-mini")
      .setValue(bulkModel)
      .onChange((value) => {
        bulkModel = value.trim();
      })
  );

  bulkSetting.addButton((button) =>
    button.setButtonText("Apply to all").setCta().onClick(async () => {
      if (!bulkModel) {
        new Notice("Enter a model name first.");
        return;
      }
      applyModelToAll(plugin, bulkModel);
      await plugin.saveSettings();
      onRefresh();
    })
  );
}

function applyModelToAll(plugin: GetShitDonePlugin, model: string): void {
  plugin.settings.models = {
    ...plugin.settings.models,
    filterModel: model,
    briefingModel: model,
    personResearchModel: model,
    orgResearchModel: model,
    phoneValidationModel: model,
    inboxRoutingModel: model,
    settingsHelperModel: model,
  };
}

function renderModels(
  containerEl: HTMLElement,
  plugin: GetShitDonePlugin,
  onRefresh: () => void,
  options: { includeHeader?: boolean } = {}
): void {
  if (options.includeHeader !== false) {
    createSection(containerEl, "AI Models", "Configure which models to use.");
  }

  new Setting(containerEl)
    .setName("Filter Model")
    .setDesc(
      "Model for determining if meetings need briefings (fast model recommended). Gemini: gemini-flash-latest. OpenAI: gpt-4o-mini"
    )
    .addText((text) =>
      text
        .setPlaceholder("gemini-flash-latest or gpt-4o-mini")
        .setValue(plugin.settings.models.filterModel)
        .onChange(async (value) => {
          plugin.settings.models.filterModel = value;
          await plugin.saveSettings();
        })
    );

  new Setting(containerEl)
    .setName("Briefing Model")
    .setDesc("Model for generating meeting briefings. Gemini: gemini-pro-latest. OpenAI: gpt-4o")
    .addText((text) =>
      text
        .setPlaceholder("gemini-pro-latest or gpt-4o")
        .setValue(plugin.settings.models.briefingModel)
        .onChange(async (value) => {
          plugin.settings.models.briefingModel = value;
          await plugin.saveSettings();
        })
    );

  new Setting(containerEl)
    .setName("Person Research Model")
    .setDesc("Model for researching people. Gemini: gemini-pro-latest. OpenAI: gpt-4o")
    .addText((text) =>
      text
        .setPlaceholder("gemini-pro-latest or gpt-4o")
        .setValue(plugin.settings.models.personResearchModel)
        .onChange(async (value) => {
          plugin.settings.models.personResearchModel = value;
          await plugin.saveSettings();
        })
    );

  new Setting(containerEl)
    .setName("Organization Research Model")
    .setDesc("Model for researching organizations. Gemini: gemini-pro-latest. OpenAI: gpt-4o")
    .addText((text) =>
      text
        .setPlaceholder("gemini-pro-latest or gpt-4o")
        .setValue(plugin.settings.models.orgResearchModel)
        .onChange(async (value) => {
          plugin.settings.models.orgResearchModel = value;
          await plugin.saveSettings();
        })
    );

  new Setting(containerEl)
    .setName("Phone Validation Model")
    .setDesc("Model for validating phone numbers from email signatures. Gemini: gemini-pro-latest. OpenAI: gpt-4o-mini")
    .addText((text) =>
      text
        .setPlaceholder("gemini-pro-latest or gpt-4o-mini")
        .setValue(plugin.settings.models.phoneValidationModel)
        .onChange(async (value) => {
          plugin.settings.models.phoneValidationModel = value;
          await plugin.saveSettings();
        })
    );

  new Setting(containerEl)
    .setName("Inbox Routing Model")
    .setDesc("Model for classifying inbox content. Gemini: gemini-flash-latest. OpenAI: gpt-4o-mini")
    .addText((text) =>
      text
        .setPlaceholder("gemini-flash-latest or gpt-4o-mini")
        .setValue(plugin.settings.models.inboxRoutingModel)
        .onChange(async (value) => {
          plugin.settings.models.inboxRoutingModel = value;
          await plugin.saveSettings();
        })
    );

  new Setting(containerEl)
    .setName("O3 Prep Model")
    .setDesc("Model for drafting O3 prep. Gemini: gemini-flash-latest. OpenAI: gpt-4o-mini")
    .addText((text) =>
      text
        .setPlaceholder("gemini-flash-latest or gpt-4o-mini")
        .setValue(plugin.settings.models.o3PrepModel)
        .onChange(async (value) => {
          plugin.settings.models.o3PrepModel = value;
          await plugin.saveSettings();
        })
    );

  new Setting(containerEl)
    .setName("Settings Helper Model")
    .setDesc("Model used by the settings helper and prompt assistant")
    .addText((text) =>
      text
        .setPlaceholder("gemini-flash-latest or gpt-4o-mini")
        .setValue(plugin.settings.models.settingsHelperModel)
        .onChange(async (value) => {
          plugin.settings.models.settingsHelperModel = value;
          await plugin.saveSettings();
        })
    );

  new Setting(containerEl)
    .setName("Reset Models")
    .setDesc("Reset all models to their default values")
    .addButton((button) =>
      button.setButtonText("Reset All Models").onClick(async () => {
        plugin.settings.models = { ...DEFAULT_SETTINGS.models };
        await plugin.saveSettings();
        onRefresh();
      })
    );
}

function renderGenerationConfigs(
  containerEl: HTMLElement,
  plugin: GetShitDonePlugin,
  onRefresh: () => void,
  options: { includeHeader?: boolean } = {}
): void {
  if (options.includeHeader !== false) {
    createSection(
      containerEl,
      "Generation Config",
      "Control temperature and (optional) reasoning effort per prompt."
    );
  }

  createGenerationConfigSetting(
    containerEl,
    plugin,
    "Meeting Filter",
    "YES/NO classifier (keep deterministic).",
    "meetingFilter"
  );

  createGenerationConfigSetting(
    containerEl,
    plugin,
    "Meeting Briefing",
    "Short, grounded briefing (avoid long outputs).",
    "meetingBriefing"
  );

  createGenerationConfigSetting(
    containerEl,
    plugin,
    "Person Research",
    "Deep research with web search and structured extraction.",
    "personResearch"
  );

  createGenerationConfigSetting(
    containerEl,
    plugin,
    "Organization Research",
    "Deep org research with web search.",
    "orgResearch"
  );

  createGenerationConfigSetting(
    containerEl,
    plugin,
    "Phone Validation",
    "Deterministic phone number selection / validation.",
    "phoneValidation"
  );

  createGenerationConfigSetting(
    containerEl,
    plugin,
    "Inbox Routing",
    "Fast content classification for inbox routing.",
    "inboxRouting"
  );

  createGenerationConfigSetting(
    containerEl,
    plugin,
    "Deep Research",
    "Long-form research that may use web search.",
    "research"
  );

  createGenerationConfigSetting(
    containerEl,
    plugin,
    "O3 Prep",
    "O3 synthesis output.",
    "o3Prep"
  );

  new Setting(containerEl)
    .setName("Reset Generation Config")
    .setDesc("Reset generation config values to their defaults")
    .addButton((button) =>
      button.setButtonText("Reset Generation Config").onClick(async () => {
        plugin.settings.generationConfigs = { ...DEFAULT_SETTINGS.generationConfigs };
        await plugin.saveSettings();
        onRefresh();
      })
    );
}

function renderPrompts(
  containerEl: HTMLElement,
  plugin: GetShitDonePlugin,
  options: { includeHeader?: boolean } = {}
): void {
  if (options.includeHeader !== false) {
    createSection(containerEl, "Prompts", "Customize the AI prompts used for each workflow.");
  }

  createPromptSetting(
    containerEl,
    plugin,
    "Meeting Filter Prompt",
    "Determines if a meeting needs a briefing",
    "meetingFilter"
  );

  createPromptSetting(
    containerEl,
    plugin,
    "Meeting Briefing Prompt",
    "Generates the meeting briefing content",
    "meetingBriefing"
  );

  createPromptSetting(
    containerEl,
    plugin,
    "Person Research Prompt",
    "Researches people and extracts info",
    "personResearch"
  );

  createPromptSetting(
    containerEl,
    plugin,
    "Organization Research Prompt",
    "Researches organizations",
    "orgResearch"
  );

  createPromptSetting(
    containerEl,
    plugin,
    "Inbox Routing Prompt",
    "Classifies incoming content for routing",
    "inboxRouting"
  );

  createPromptSetting(
    containerEl,
    plugin,
    "Deep Research Prompt",
    "Runs long-form research when triggered",
    "research"
  );

  new Setting(containerEl)
    .setName("Reset Prompts")
    .setDesc("Reset all prompts to their default values")
    .addButton((button) =>
      button.setButtonText("Reset All Prompts").onClick(async () => {
        plugin.settings.prompts = { ...DEFAULT_SETTINGS.prompts };
        await plugin.saveSettings();
      })
    );
}
