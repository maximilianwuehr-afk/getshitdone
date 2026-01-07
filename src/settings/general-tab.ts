// ============================================================================
// General Tab - Core behavior and folder locations
// ============================================================================

import { Setting } from "obsidian";
import type GetShitDonePlugin from "../main";
import { createSection } from "./helpers";

// ============================================================================
// Public API
// ============================================================================

export function renderGeneralTab(
  containerEl: HTMLElement,
  plugin: GetShitDonePlugin
): void {
  containerEl.createEl("p", {
    text: "Core behavior and folder locations.",
    cls: "setting-item-description",
  });

  new Setting(containerEl)
    .setName("Auto-research People on open")
    .setDesc("Research People notes automatically when opened")
    .addToggle((toggle) =>
      toggle
        .setValue(plugin.settings.autoResearchPeopleOnOpen)
        .onChange(async (value) => {
          plugin.settings.autoResearchPeopleOnOpen = value;
          await plugin.saveSettings();
        })
    );

  new Setting(containerEl)
    .setName("Auto-research Organizations on open")
    .setDesc("Research Organization notes automatically when opened")
    .addToggle((toggle) =>
      toggle
        .setValue(plugin.settings.autoResearchOrgsOnOpen)
        .onChange(async (value) => {
          plugin.settings.autoResearchOrgsOnOpen = value;
          await plugin.saveSettings();
        })
    );

  renderFolders(containerEl, plugin);
  renderPerformance(containerEl, plugin);
}

// ============================================================================
// Private Helpers
// ============================================================================

function renderFolders(containerEl: HTMLElement, plugin: GetShitDonePlugin): void {
  createSection(containerEl, "Folder Paths", "Where notes are stored in your vault.");

  new Setting(containerEl)
    .setName("People Folder")
    .setDesc("Folder path for People notes")
    .addText((text) =>
      text
        .setPlaceholder("People")
        .setValue(plugin.settings.peopleFolder)
        .onChange(async (value) => {
          plugin.settings.peopleFolder = value;
          await plugin.saveSettings();
        })
    );

  new Setting(containerEl)
    .setName("Organizations Folder")
    .setDesc("Folder path for Organization notes")
    .addText((text) =>
      text
        .setPlaceholder("Organizations")
        .setValue(plugin.settings.organizationsFolder)
        .onChange(async (value) => {
          plugin.settings.organizationsFolder = value;
          await plugin.saveSettings();
        })
    );

  new Setting(containerEl)
    .setName("Meetings Folder")
    .setDesc("Folder path for Meeting notes")
    .addText((text) =>
      text
        .setPlaceholder("Meetings")
        .setValue(plugin.settings.meetingsFolder)
        .onChange(async (value) => {
          plugin.settings.meetingsFolder = value;
          await plugin.saveSettings();
        })
    );
}

function renderPerformance(containerEl: HTMLElement, plugin: GetShitDonePlugin): void {
  createSection(
    containerEl,
    "Performance",
    "Control parallel processing and rate limiting for API calls."
  );

  new Setting(containerEl)
    .setName("Parallel Briefings")
    .setDesc(
      "Number of meeting briefings to process in parallel (1-5). Higher = faster but may hit rate limits."
    )
    .addSlider((slider) =>
      slider
        .setLimits(1, 5, 1)
        .setValue(plugin.settings.parallelBriefings)
        .setDynamicTooltip()
        .onChange(async (value) => {
          plugin.settings.parallelBriefings = value;
          await plugin.saveSettings();
        })
    );

  new Setting(containerEl)
    .setName("API Delay (ms)")
    .setDesc("Minimum delay between API call batches in milliseconds.")
    .addSlider((slider) =>
      slider
        .setLimits(100, 2000, 100)
        .setValue(plugin.settings.apiDelayMs)
        .setDynamicTooltip()
        .onChange(async (value) => {
          plugin.settings.apiDelayMs = value;
          await plugin.saveSettings();
        })
    );
}
