// ============================================================================
// Settings Tab - Main entry point for plugin settings UI
// ============================================================================

import { App, PluginSettingTab } from "obsidian";
import type GetShitDonePlugin from "../main";
import { renderGeneralTab } from "./general-tab";
import { renderDailyNotesTab } from "./daily-tab";
import { renderApiTab } from "./api-tab";
import {
  renderOpenRouterTab,
  createOpenRouterTabState,
  type OpenRouterTabState,
} from "./openrouter-tab";
import { renderInboxTab } from "./inbox-tab";
import { renderAiTab } from "./ai-tab";
import { renderCouncilTab } from "./council-tab";

// ============================================================================
// Types
// ============================================================================

export type SettingsTabId = "general" | "daily" | "api" | "inbox" | "ai" | "council" | "openrouter";

// ============================================================================
// Settings Tab Class
// ============================================================================

export class GetShitDoneSettingTab extends PluginSettingTab {
  plugin: GetShitDonePlugin;
  private activeTab: SettingsTabId = "general";
  private openRouterState: OpenRouterTabState;

  constructor(app: App, plugin: GetShitDonePlugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.openRouterState = createOpenRouterTabState();
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("gsd-settings-container");

    this.renderTabs(containerEl);

    const contentEl = containerEl.createDiv({ cls: "gsd-settings-tab-content" });
    const onRefresh = () => this.display();

    switch (this.activeTab) {
      case "general":
        renderGeneralTab(contentEl, this.plugin);
        break;
      case "daily":
        renderDailyNotesTab(contentEl, this.plugin);
        break;
      case "api":
        renderApiTab(contentEl, this.plugin);
        break;
      case "openrouter":
        renderOpenRouterTab(contentEl, this.plugin, this.openRouterState, onRefresh);
        break;
      case "inbox":
        renderInboxTab(contentEl, this.plugin, onRefresh);
        break;
      case "ai":
        renderAiTab(contentEl, this.plugin, onRefresh);
        break;
      case "council":
        renderCouncilTab(contentEl, this.plugin, onRefresh);
        break;
    }
  }

  private renderTabs(containerEl: HTMLElement): void {
    const tabs: { id: SettingsTabId; label: string }[] = [
      { id: "general", label: "General" },
      { id: "daily", label: "Daily notes" },
      { id: "api", label: "API & Integration" },
      { id: "openrouter", label: "OpenRouter" },
      { id: "inbox", label: "Inbox" },
      { id: "ai", label: "AI models & prompts" },
      { id: "council", label: "LLM council" },
    ];

    const tabBar = containerEl.createDiv({ cls: "gsd-settings-tabs" });

    tabs.forEach((tab) => {
      const button = tabBar.createEl("button", {
        text: tab.label,
        cls: "gsd-settings-tab",
      });
      button.setAttr("type", "button");
      if (this.activeTab === tab.id) {
        button.addClass("is-active");
      }
      button.addEventListener("click", () => {
        this.activeTab = tab.id;
        this.display();
      });
    });
  }
}
