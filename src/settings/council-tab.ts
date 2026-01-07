// ============================================================================
// Council Tab - LLM Council configuration
// ============================================================================

import { Setting, Notice } from "obsidian";
import type GetShitDonePlugin from "../main";
import {
  createSection,
  createDetailsSection,
  createCouncilGenerationConfigSetting,
} from "./helpers";

// ============================================================================
// Public API
// ============================================================================

export function renderCouncilTab(
  containerEl: HTMLElement,
  plugin: GetShitDonePlugin,
  onRefresh: () => void
): void {
  renderLlmCouncil(containerEl, plugin, onRefresh);
}

// ============================================================================
// Private Helpers
// ============================================================================

function renderLlmCouncil(
  containerEl: HTMLElement,
  plugin: GetShitDonePlugin,
  onRefresh: () => void
): void {
  createSection(
    containerEl,
    "LLM Council",
    "Configure the LLM Council feature for multi-perspective problem solving."
  );

  new Setting(containerEl)
    .setName("Enable LLM Council")
    .setDesc("Enable the LLM Council feature")
    .addToggle((toggle) =>
      toggle
        .setValue(plugin.settings.llmCouncil.enabled)
        .onChange(async (value) => {
          plugin.settings.llmCouncil.enabled = value;
          await plugin.saveSettings();
        })
    );

  new Setting(containerEl)
    .setName("Runs Directory")
    .setDesc("Directory where council run outputs are stored")
    .addText((text) =>
      text
        .setPlaceholder("Z_Settings & Tools/llm_council/runs")
        .setValue(plugin.settings.llmCouncil.runsPath)
        .onChange(async (value) => {
          plugin.settings.llmCouncil.runsPath = value;
          await plugin.saveSettings();
        })
    );

  createSection(
    containerEl,
    "Models",
    "Use shared models for ideators and executors, then override if needed."
  );

  let ideatorModel = plugin.settings.llmCouncil.ideatorModels.feynman || "";
  const ideatorSetting = new Setting(containerEl)
    .setName("Ideator model (all)")
    .setDesc("Apply this model to all ideators");
  ideatorSetting.addText((text) =>
    text
      .setPlaceholder("gemini-pro-latest or gpt-4o")
      .setValue(ideatorModel)
      .onChange((value) => {
        ideatorModel = value.trim();
      })
  );
  ideatorSetting.addButton((button) =>
    button.setButtonText("Apply").onClick(async () => {
      if (!ideatorModel) {
        new Notice("Enter a model name first.");
        return;
      }
      plugin.settings.llmCouncil.ideatorModels = {
        feynman: ideatorModel,
        taleb: ideatorModel,
        daVinci: ideatorModel,
        fuller: ideatorModel,
      };
      await plugin.saveSettings();
      onRefresh();
    })
  );

  let executorModel = plugin.settings.llmCouncil.executorModels.executor1 || "";
  const executorSetting = new Setting(containerEl)
    .setName("Executor model (all)")
    .setDesc("Apply this model to all executors");
  executorSetting.addText((text) =>
    text
      .setPlaceholder("gpt-4o, claude-3, gemini-pro-latest")
      .setValue(executorModel)
      .onChange((value) => {
        executorModel = value.trim();
      })
  );
  executorSetting.addButton((button) =>
    button.setButtonText("Apply").onClick(async () => {
      if (!executorModel) {
        new Notice("Enter a model name first.");
        return;
      }
      plugin.settings.llmCouncil.executorModels = {
        executor1: executorModel,
        executor2: executorModel,
        executor3: executorModel,
      };
      await plugin.saveSettings();
      onRefresh();
    })
  );

  new Setting(containerEl)
    .setName("Judge Model")
    .setDesc("Model for the judge (default: Claude Opus 4.5)")
    .addText((text) =>
      text
        .setValue(plugin.settings.llmCouncil.judgeModel)
        .onChange(async (value) => {
          plugin.settings.llmCouncil.judgeModel = value;
          await plugin.saveSettings();
        })
    );

  // Prompt files section
  const promptSection = createDetailsSection(
    containerEl,
    "Prompt files (advanced)",
    "Prompt file paths used by the council."
  );

  new Setting(promptSection)
    .setName("Feynman Ideator Prompt")
    .setDesc("Path to Richard Feynman ideator prompt file")
    .addText((text) =>
      text
        .setValue(plugin.settings.llmCouncil.prompts.ideators.feynman)
        .onChange(async (value) => {
          plugin.settings.llmCouncil.prompts.ideators.feynman = value;
          await plugin.saveSettings();
        })
    );

  new Setting(promptSection)
    .setName("Taleb Ideator Prompt")
    .setDesc("Path to Nassim Taleb ideator prompt file")
    .addText((text) =>
      text
        .setValue(plugin.settings.llmCouncil.prompts.ideators.taleb)
        .onChange(async (value) => {
          plugin.settings.llmCouncil.prompts.ideators.taleb = value;
          await plugin.saveSettings();
        })
    );

  new Setting(promptSection)
    .setName("da Vinci Ideator Prompt")
    .setDesc("Path to Leonardo da Vinci ideator prompt file")
    .addText((text) =>
      text
        .setValue(plugin.settings.llmCouncil.prompts.ideators.daVinci)
        .onChange(async (value) => {
          plugin.settings.llmCouncil.prompts.ideators.daVinci = value;
          await plugin.saveSettings();
        })
    );

  new Setting(promptSection)
    .setName("Fuller Ideator Prompt")
    .setDesc("Path to Buckminster Fuller ideator prompt file")
    .addText((text) =>
      text
        .setValue(plugin.settings.llmCouncil.prompts.ideators.fuller)
        .onChange(async (value) => {
          plugin.settings.llmCouncil.prompts.ideators.fuller = value;
          await plugin.saveSettings();
        })
    );

  new Setting(promptSection)
    .setName("Executor Prompt")
    .setDesc("Path to executor prompt file")
    .addText((text) =>
      text
        .setValue(plugin.settings.llmCouncil.prompts.executor)
        .onChange(async (value) => {
          plugin.settings.llmCouncil.prompts.executor = value;
          await plugin.saveSettings();
        })
    );

  new Setting(promptSection)
    .setName("Judge Prompt")
    .setDesc("Path to judge prompt file")
    .addText((text) =>
      text
        .setValue(plugin.settings.llmCouncil.prompts.judge)
        .onChange(async (value) => {
          plugin.settings.llmCouncil.prompts.judge = value;
          await plugin.saveSettings();
        })
    );

  // Per-person models section
  const modelDetails = createDetailsSection(
    containerEl,
    "Per-person models (advanced)",
    "Override specific ideators or executors."
  );

  new Setting(modelDetails)
    .setName("Feynman Model")
    .setDesc("Model for Richard Feynman ideator")
    .addText((text) =>
      text
        .setValue(plugin.settings.llmCouncil.ideatorModels.feynman)
        .onChange(async (value) => {
          plugin.settings.llmCouncil.ideatorModels.feynman = value;
          await plugin.saveSettings();
        })
    );

  new Setting(modelDetails)
    .setName("Taleb Model")
    .setDesc("Model for Nassim Taleb ideator")
    .addText((text) =>
      text
        .setValue(plugin.settings.llmCouncil.ideatorModels.taleb)
        .onChange(async (value) => {
          plugin.settings.llmCouncil.ideatorModels.taleb = value;
          await plugin.saveSettings();
        })
    );

  new Setting(modelDetails)
    .setName("da Vinci Model")
    .setDesc("Model for Leonardo da Vinci ideator")
    .addText((text) =>
      text
        .setValue(plugin.settings.llmCouncil.ideatorModels.daVinci)
        .onChange(async (value) => {
          plugin.settings.llmCouncil.ideatorModels.daVinci = value;
          await plugin.saveSettings();
        })
    );

  new Setting(modelDetails)
    .setName("Fuller Model")
    .setDesc("Model for Buckminster Fuller ideator")
    .addText((text) =>
      text
        .setValue(plugin.settings.llmCouncil.ideatorModels.fuller)
        .onChange(async (value) => {
          plugin.settings.llmCouncil.ideatorModels.fuller = value;
          await plugin.saveSettings();
        })
    );

  new Setting(modelDetails)
    .setName("Executor 1 Model")
    .setDesc("Model for first executor (default: Gemini)")
    .addText((text) =>
      text
        .setValue(plugin.settings.llmCouncil.executorModels.executor1)
        .onChange(async (value) => {
          plugin.settings.llmCouncil.executorModels.executor1 = value;
          await plugin.saveSettings();
        })
    );

  new Setting(modelDetails)
    .setName("Executor 2 Model")
    .setDesc("Model for second executor (default: Claude Opus 4.5)")
    .addText((text) =>
      text
        .setValue(plugin.settings.llmCouncil.executorModels.executor2)
        .onChange(async (value) => {
          plugin.settings.llmCouncil.executorModels.executor2 = value;
          await plugin.saveSettings();
        })
    );

  new Setting(modelDetails)
    .setName("Executor 3 Model")
    .setDesc("Model for third executor (default: GPT-5.2)")
    .addText((text) =>
      text
        .setValue(plugin.settings.llmCouncil.executorModels.executor3)
        .onChange(async (value) => {
          plugin.settings.llmCouncil.executorModels.executor3 = value;
          await plugin.saveSettings();
        })
    );

  // Generation config section
  const configSection = createDetailsSection(
    containerEl,
    "Generation config (advanced)",
    "Temperature and thinking budget per phase."
  );

  createCouncilGenerationConfigSetting(
    configSection,
    plugin,
    "Ideation",
    "Temperature and thinking budget for ideators",
    "ideation"
  );

  createCouncilGenerationConfigSetting(
    configSection,
    plugin,
    "Execution",
    "Temperature and thinking budget for executors",
    "execution"
  );

  createCouncilGenerationConfigSetting(
    configSection,
    plugin,
    "Judgment",
    "Temperature and thinking budget for judge",
    "judgment"
  );
}
