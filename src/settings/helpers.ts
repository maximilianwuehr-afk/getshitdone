// ============================================================================
// Settings Helpers - Shared UI utilities, modals, and helper functions
// ============================================================================

import {
  App,
  Modal,
  Setting,
  Notice,
  TextAreaComponent,
} from "obsidian";
import type { AIService } from "../services/ai-service";
import type {
  PluginSettings,
  InboxContentType,
  InboxRoutingRule,
} from "../types";
import { DEFAULT_SETTINGS } from "../types";

// ============================================================================
// Types
// ============================================================================

export type SettingsHelperOptions = {
  title: string;
  context: string;
  currentValue: string;
  defaultQuestion?: string;
  model: string;
  aiService: AIService;
  onReplace?: (value: string) => Promise<void>;
  onAppend?: (value: string) => Promise<void>;
};

export interface SettingsHelperPlugin {
  settings: PluginSettings;
  getAIService(): AIService;
  saveSettings(): Promise<void>;
}

// ============================================================================
// Section Helpers
// ============================================================================

export function createSection(
  containerEl: HTMLElement,
  title: string,
  desc?: string
): void {
  containerEl.createEl("h2", { text: title });
  if (desc) {
    containerEl.createEl("p", { text: desc, cls: "setting-item-description" });
  }
}

export function createSubsection(
  containerEl: HTMLElement,
  title: string,
  desc?: string
): void {
  containerEl.createEl("h3", { text: title });
  if (desc) {
    containerEl.createEl("p", { text: desc, cls: "setting-item-description" });
  }
}

export function createDetailsSection(
  containerEl: HTMLElement,
  title: string,
  desc?: string,
  open = false
): HTMLElement {
  const details = containerEl.createEl("details", { cls: "gsd-settings-details" });
  details.open = open;
  details.createEl("summary", { text: title });
  const body = details.createDiv({ cls: "gsd-settings-details-body" });
  if (desc) {
    body.createEl("p", { text: desc, cls: "setting-item-description" });
  }
  return body;
}

// ============================================================================
// List Parsing
// ============================================================================

export function parseList(value: string): string[] {
  return value
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function formatList(value: string[]): string {
  return value.join("\n");
}

// ============================================================================
// Setting Components
// ============================================================================

export function createListSetting(
  containerEl: HTMLElement,
  plugin: SettingsHelperPlugin,
  options: {
    name: string;
    desc?: string;
    value: string[];
    placeholder?: string;
    rows?: number;
    helper?: {
      title: string;
      context: string;
      defaultQuestion?: string;
    };
    onChange: (value: string[]) => Promise<void>;
  }
): void {
  const setting = new Setting(containerEl).setName(options.name).setDesc(options.desc || "");
  let textArea: TextAreaComponent | null = null;

  setting.addTextArea((text) => {
    textArea = text;
    text
      .setValue(formatList(options.value))
      .onChange(async (value) => {
        await options.onChange(parseList(value));
      });
    text.inputEl.rows = options.rows ?? 4;
    text.inputEl.style.width = "100%";
    text.inputEl.style.fontFamily = "monospace";
    text.inputEl.style.fontSize = "12px";
    if (options.placeholder) {
      text.setPlaceholder(options.placeholder);
    }
  });

  if (options.helper) {
    setting.addButton((button) =>
      button.setButtonText("Ask AI").onClick(() => {
        if (!textArea) return;
        openSettingsHelperModal(plugin, {
          title: options.helper!.title,
          context: options.helper!.context,
          currentValue: textArea.getValue(),
          defaultQuestion: options.helper!.defaultQuestion,
          onReplace: async (value) => {
            const parsed = parseList(value);
            textArea?.setValue(formatList(parsed));
            await options.onChange(parsed);
          },
          onAppend: async (value) => {
            const parsed = parseList(value);
            const merged = [...parseList(textArea?.getValue() || ""), ...parsed];
            textArea?.setValue(formatList(merged));
            await options.onChange(merged);
          },
        });
      })
    );
  }
}

export function addSecretSetting(
  containerEl: HTMLElement,
  options: {
    name: string;
    desc?: string;
    placeholder?: string;
    value: string;
    onChange: (value: string) => Promise<void>;
  }
): void {
  const setting = new Setting(containerEl)
    .setName(options.name)
    .setDesc(options.desc || "");

  let textComponent: { inputEl: HTMLInputElement } | null = null;
  let hidden = true;

  setting.addText((text) => {
    textComponent = text;
    text
      .setPlaceholder(options.placeholder || "")
      .setValue(options.value || "")
      .onChange(async (value) => {
        await options.onChange(value);
      });
    text.inputEl.type = "password";
  });

  setting.addExtraButton((button) =>
    button.setIcon("eye").setTooltip("Show/Hide").onClick(() => {
      hidden = !hidden;
      if (textComponent) {
        textComponent.inputEl.type = hidden ? "password" : "text";
      }
    })
  );
}

export function addTriStateDropdown(
  containerEl: HTMLElement,
  options: {
    name: string;
    desc?: string;
    value?: boolean;
    onChange: (value: boolean | undefined) => Promise<void>;
  }
): void {
  new Setting(containerEl)
    .setName(options.name)
    .setDesc(options.desc || "")
    .addDropdown((dropdown) =>
      dropdown
        .addOption("any", "Any")
        .addOption("true", "Yes")
        .addOption("false", "No")
        .setValue(options.value === undefined ? "any" : options.value ? "true" : "false")
        .onChange(async (value) => {
          if (value === "any") {
            await options.onChange(undefined);
          } else {
            await options.onChange(value === "true");
          }
        })
    );
}

// ============================================================================
// Rule Helpers
// ============================================================================

export function formatRuleSummary(rule: InboxRoutingRule): string {
  const status = rule.enabled ? "●" : "○";
  return `${status} ${rule.name || "Untitled rule"}`;
}

export function filterContentTypes(value: string[]): InboxContentType[] {
  const allowed: InboxContentType[] = [
    "task",
    "thought",
    "link",
    "transcript",
    "screenshot",
    "unknown",
  ];
  return value
    .map((item) => item.toLowerCase() as InboxContentType)
    .filter((item) => allowed.includes(item));
}

export function parseOptionalNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = parseInt(trimmed, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export function createDefaultRoutingRule(): InboxRoutingRule {
  return {
    id: createRuleId(),
    name: "New rule",
    enabled: true,
    match: {},
    action: {
      destination: "daily_thoughts",
      format: "auto",
      addDueDate: true,
    },
  };
}

export function cloneRoutingRule(rule: InboxRoutingRule): InboxRoutingRule {
  return {
    ...rule,
    id: createRuleId(),
    name: `${rule.name || "Rule"} (copy)`,
    match: { ...rule.match },
    action: { ...rule.action },
  };
}

export function createRuleId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `rule-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

// ============================================================================
// Model Helpers
// ============================================================================

export function getSettingsHelperModel(settings: PluginSettings): string {
  return (
    settings.models.settingsHelperModel ||
    settings.models.inboxRoutingModel ||
    settings.models.briefingModel
  );
}

export function canUseModel(settings: PluginSettings, model: string): boolean {
  const lower = model.toLowerCase();
  if (isOpenRouterModel(settings, lower)) {
    return Boolean(settings.openrouterApiKey);
  }
  if (lower.startsWith("claude-")) {
    return Boolean(settings.anthropicApiKey);
  }
  if (lower.startsWith("gpt-") || lower.startsWith("o1-") || lower.startsWith("o3-")) {
    return Boolean(settings.openaiApiKey);
  }
  return Boolean(settings.geminiApiKey);
}

export function isOpenRouterModel(settings: PluginSettings, modelLower: string): boolean {
  if (modelLower.startsWith("openrouter:")) {
    return true;
  }
  if (modelLower.includes("/")) {
    return true;
  }
  if (settings.openrouter?.selectedModels?.length) {
    return settings.openrouter.selectedModels.some(
      (id) => id.toLowerCase() === modelLower
    );
  }
  return false;
}

// ============================================================================
// Settings Helper Modal
// ============================================================================

export function openSettingsHelperModal(
  plugin: SettingsHelperPlugin,
  options: Omit<SettingsHelperOptions, "model" | "aiService"> & {
    model?: string;
    aiService?: AIService;
  }
): void {
  const model = options.model || getSettingsHelperModel(plugin.settings);
  const aiService = options.aiService || plugin.getAIService();

  if (!model) {
    new Notice("No model configured for the settings helper.");
    return;
  }

  if (!canUseModel(plugin.settings, model)) {
    new Notice("Missing API key for the selected settings helper model.");
    return;
  }

  // @ts-expect-error - accessing app from plugin context
  const app = plugin.app || (globalThis as { app?: App }).app;
  if (!app) {
    new Notice("Could not access app instance.");
    return;
  }

  new SettingsHelperModal(app, {
    title: options.title,
    context: options.context,
    currentValue: options.currentValue,
    defaultQuestion: options.defaultQuestion,
    model,
    aiService,
    onReplace: options.onReplace,
    onAppend: options.onAppend,
  }).open();
}

export function cloneInboxSettings(): PluginSettings["inbox"] {
  if (typeof structuredClone !== "undefined") {
    return structuredClone(DEFAULT_SETTINGS.inbox);
  }
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS.inbox)) as PluginSettings["inbox"];
}

// ============================================================================
// Generation Config Settings
// ============================================================================

export function createGenerationConfigSetting(
  containerEl: HTMLElement,
  plugin: SettingsHelperPlugin,
  name: string,
  desc: string,
  key: keyof PluginSettings["generationConfigs"]
): void {
  const cfg = plugin.settings.generationConfigs[key];

  const setting = new Setting(containerEl).setName(name).setDesc(desc);

  setting.addSlider((slider) =>
    slider
      .setLimits(0, 1, 0.05)
      .setValue(cfg.temperature ?? 0.2)
      .setDynamicTooltip()
      .onChange(async (value) => {
        plugin.settings.generationConfigs[key].temperature = value;
        await plugin.saveSettings();
      })
  );

  setting.addDropdown((dropdown) =>
    dropdown
      .addOption("", "Off")
      .addOption("low", "Low")
      .addOption("medium", "Medium")
      .addOption("high", "High")
      .setValue(cfg.thinkingBudget == null ? "" : cfg.thinkingBudget)
      .onChange(async (value) => {
        if (!value) {
          plugin.settings.generationConfigs[key].thinkingBudget = null;
        } else {
          plugin.settings.generationConfigs[key].thinkingBudget = value as
            | "low"
            | "medium"
            | "high";
        }
        await plugin.saveSettings();
      })
  );
}

export function createCouncilGenerationConfigSetting(
  containerEl: HTMLElement,
  plugin: SettingsHelperPlugin,
  name: string,
  desc: string,
  key: keyof PluginSettings["llmCouncil"]["generationConfig"]
): void {
  const cfg = plugin.settings.llmCouncil.generationConfig[key];

  const setting = new Setting(containerEl).setName(name).setDesc(desc);

  setting.addSlider((slider) =>
    slider
      .setLimits(0, 1, 0.05)
      .setValue(cfg.temperature ?? 0.2)
      .setDynamicTooltip()
      .onChange(async (value) => {
        plugin.settings.llmCouncil.generationConfig[key].temperature = value;
        await plugin.saveSettings();
      })
  );

  setting.addDropdown((dropdown) =>
    dropdown
      .addOption("", "Off")
      .addOption("low", "Low")
      .addOption("medium", "Medium")
      .addOption("high", "High")
      .setValue(cfg.thinkingBudget == null ? "" : cfg.thinkingBudget)
      .onChange(async (value) => {
        if (!value) {
          plugin.settings.llmCouncil.generationConfig[key].thinkingBudget = null;
        } else {
          plugin.settings.llmCouncil.generationConfig[key].thinkingBudget = value as
            | "low"
            | "medium"
            | "high";
        }
        await plugin.saveSettings();
      })
  );
}

export function createPromptSetting(
  containerEl: HTMLElement,
  plugin: SettingsHelperPlugin,
  name: string,
  desc: string,
  key: keyof PluginSettings["prompts"]
): void {
  const setting = new Setting(containerEl)
    .setName(name)
    .setDesc(desc)
    .setClass("gsd-prompt-setting");

  let textArea: TextAreaComponent | null = null;

  setting.addTextArea((text) => {
    textArea = text;
    text
      .setValue(plugin.settings.prompts[key])
      .onChange(async (value) => {
        plugin.settings.prompts[key] = value;
        await plugin.saveSettings();
      });
    text.inputEl.rows = 10;
    text.inputEl.cols = 60;
    text.inputEl.style.width = "100%";
    text.inputEl.style.fontFamily = "monospace";
    text.inputEl.style.fontSize = "12px";
  });

  new Setting(containerEl)
    .setName(`${name} helper`)
    .setDesc("Ask AI to refine or rewrite this prompt")
    .addButton((button) =>
      button.setButtonText("Prompt helper").onClick(() => {
        if (!textArea) return;
        openSettingsHelperModal(plugin, {
          title: `${name} helper`,
          context: `Prompt: ${name}\n${desc}`,
          currentValue: textArea.getValue(),
          defaultQuestion:
            "Improve this prompt for clarity and reliability. Return only the revised prompt.",
          onReplace: async (value) => {
            textArea?.setValue(value);
            plugin.settings.prompts[key] = value;
            await plugin.saveSettings();
          },
        });
      })
    );
}

// ============================================================================
// Settings Helper Modal Class
// ============================================================================

class SettingsHelperModal extends Modal {
  private options: SettingsHelperOptions;
  private responseText = "";

  constructor(app: App, options: SettingsHelperOptions) {
    super(app);
    this.options = options;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: this.options.title });

    if (this.options.context) {
      contentEl.createEl("p", {
        text: this.options.context,
        cls: "setting-item-description",
      });
    }

    const question = contentEl.createEl("textarea", { cls: "gsd-helper-question" });
    question.rows = 4;
    question.style.width = "100%";
    question.style.fontFamily = "monospace";
    question.style.fontSize = "12px";
    question.value = this.options.defaultQuestion || "";

    const response = contentEl.createEl("textarea", { cls: "gsd-helper-response" });
    response.rows = 8;
    response.style.width = "100%";
    response.style.fontFamily = "monospace";
    response.style.fontSize = "12px";
    response.readOnly = true;

    const actions = new Setting(contentEl);
    actions.addButton((button) =>
      button.setButtonText("Ask AI").setCta().onClick(async () => {
        const questionText = question.value.trim();
        if (!questionText) {
          new Notice("Ask a question first.");
          return;
        }

        response.value = "Thinking...";
        const system =
          "You are a configuration assistant for the GetShitDone plugin. Be concise, practical, and structured.";
        const user = `Setting context:\n${this.options.context}\n\nCurrent value:\n${
          this.options.currentValue || "(empty)"
        }\n\nQuestion:\n${questionText}\n\nReturn plain text only.`;

        const result = await this.options.aiService.callModel(system, user, this.options.model, {
          useSearch: false,
          temperature: 0.2,
          thinkingBudget: "low",
        });

        if (!result) {
          response.value = "(No response from model)";
          return;
        }

        this.responseText = result.trim();
        response.value = this.responseText;
      })
    );

    const apply = new Setting(contentEl);
    if (this.options.onReplace) {
      apply.addButton((button) =>
        button.setButtonText("Replace with response").onClick(async () => {
          if (!this.responseText) {
            new Notice("Ask AI first so there is a response to apply.");
            return;
          }
          await this.options.onReplace?.(this.responseText);
          this.close();
        })
      );
    }

    if (this.options.onAppend) {
      apply.addButton((button) =>
        button.setButtonText("Append response").onClick(async () => {
          if (!this.responseText) {
            new Notice("Ask AI first so there is a response to apply.");
            return;
          }
          await this.options.onAppend?.(this.responseText);
          this.close();
        })
      );
    }
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}
