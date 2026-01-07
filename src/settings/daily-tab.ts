// ============================================================================
// Daily Notes Tab - Daily note generation, meetings, and O3 prep
// ============================================================================

import { Setting } from "obsidian";
import type GetShitDonePlugin from "../main";
import {
  createSection,
  createSubsection,
  createListSetting,
  parseOptionalNumber,
} from "./helpers";

// ============================================================================
// Public API
// ============================================================================

export function renderDailyNotesTab(
  containerEl: HTMLElement,
  plugin: GetShitDonePlugin
): void {
  containerEl.createEl("p", {
    text: "Daily note generation, meeting lists, and prep.",
    cls: "setting-item-description",
  });

  renderIdentity(containerEl, plugin);
  renderMeetings(containerEl, plugin);
  renderO3(containerEl, plugin);
}

// ============================================================================
// Private Helpers
// ============================================================================

function renderIdentity(containerEl: HTMLElement, plugin: GetShitDonePlugin): void {
  createSection(
    containerEl,
    "Identity & Exclusions",
    "Used to filter attendees and avoid noisy matches."
  );

  new Setting(containerEl)
    .setName("Your Domain")
    .setDesc("Your company email domain (e.g., finn.com)")
    .addText((text) =>
      text
        .setPlaceholder("company.com")
        .setValue(plugin.settings.yourDomain)
        .onChange(async (value) => {
          plugin.settings.yourDomain = value;
          await plugin.saveSettings();
        })
    );

  createListSetting(containerEl, plugin, {
    name: "Excluded Emails",
    desc: "Emails to exclude from attendee lists (one per line)",
    value: plugin.settings.excludeEmails,
    placeholder: "you@company.com\nassistant@company.com",
    onChange: async (value) => {
      plugin.settings.excludeEmails = value;
      await plugin.saveSettings();
    },
  });

  createListSetting(containerEl, plugin, {
    name: "Excluded Names",
    desc: "Names to exclude from attendee lists (one per line)",
    value: plugin.settings.excludeNames,
    placeholder: "Your Name\nConference Room",
    onChange: async (value) => {
      plugin.settings.excludeNames = value;
      await plugin.saveSettings();
    },
  });
}

function renderMeetings(containerEl: HTMLElement, plugin: GetShitDonePlugin): void {
  createSection(
    containerEl,
    "Meetings & Daily Notes",
    "Controls meeting list generation and briefing behavior."
  );

  createListSetting(containerEl, plugin, {
    name: "Excluded Titles",
    desc: "Meeting titles to skip entirely (one per line)",
    value: plugin.settings.excludeTitles,
    placeholder: "Blocker\nLunch\nFocus Time",
    onChange: async (value) => {
      plugin.settings.excludeTitles = value;
      await plugin.saveSettings();
    },
  });

  new Setting(containerEl)
    .setName("Max Listed Participants")
    .setDesc("Maximum number of participants to list in daily note (0 = no limit)")
    .addSlider((slider) =>
      slider
        .setLimits(0, 20, 1)
        .setValue(plugin.settings.maxListedParticipants)
        .setDynamicTooltip()
        .onChange(async (value) => {
          plugin.settings.maxListedParticipants = value;
          await plugin.saveSettings();
        })
    );
}

function renderO3(containerEl: HTMLElement, plugin: GetShitDonePlugin): void {
  createSection(
    containerEl,
    "O3 Prep",
    "Configure the O3 dashboard and master prep note."
  );

  new Setting(containerEl)
    .setName("Enable O3 dashboard")
    .setDesc("Show the O3 sidebar view and enable O3 prep features")
    .addToggle((toggle) =>
      toggle
        .setValue(plugin.settings.o3.enabled)
        .onChange(async (value) => {
          plugin.settings.o3.enabled = value;
          await plugin.saveSettings();
        })
    );

  new Setting(containerEl)
    .setName("Master O3 prep note")
    .setDesc("Rolling weekly note where O3 prep is written")
    .addText((text) =>
      text
        .setPlaceholder("FINN/O3 prep.md")
        .setValue(plugin.settings.o3.masterNotePath)
        .onChange(async (value) => {
          plugin.settings.o3.masterNotePath = value || "FINN/O3 prep.md";
          await plugin.saveSettings();
        })
    );

  new Setting(containerEl)
    .setName("O3 meeting title regex")
    .setDesc("Regex used to identify O3/1:1 meetings from calendar events")
    .addText((text) =>
      text
        .setPlaceholder("\\bO3\\b|\\b1:1\\b|\\b1-1\\b|one-on-one")
        .setValue(plugin.settings.o3.meetingTitleRegex)
        .onChange(async (value) => {
          plugin.settings.o3.meetingTitleRegex = value || "\\bO3\\b|\\b1:1\\b|\\b1-1\\b|one-on-one";
          await plugin.saveSettings();
        })
    );

  new Setting(containerEl)
    .setName("Insert O3 prep link in daily notes")
    .setDesc("Adds a prep link under O3 meetings in daily notes")
    .addToggle((toggle) =>
      toggle
        .setValue(plugin.settings.o3.dailyNoteInsert)
        .onChange(async (value) => {
          plugin.settings.o3.dailyNoteInsert = value;
          await plugin.saveSettings();
        })
    );

  createSubsection(containerEl, "O3 Coach", "Configure chat coach context scope.");

  new Setting(containerEl)
    .setName("Coach lookback days")
    .setDesc("How many days of daily/meeting notes to include")
    .addText((text) =>
      text
        .setPlaceholder("21")
        .setValue(plugin.settings.o3Coach.lookbackDays.toString())
        .onChange(async (value) => {
          const parsed = parseOptionalNumber(value);
          plugin.settings.o3Coach.lookbackDays = parsed ?? 21;
          await plugin.saveSettings();
        })
    );

  new Setting(containerEl)
    .setName("Performance review folder")
    .setDesc("Folder path containing business performance reviews")
    .addText((text) =>
      text
        .setPlaceholder("Y_Resources/FINN Files")
        .setValue(plugin.settings.o3Coach.perfReviewFolder)
        .onChange(async (value) => {
          plugin.settings.o3Coach.perfReviewFolder = value || "Y_Resources/FINN Files";
          await plugin.saveSettings();
        })
    );

  new Setting(containerEl)
    .setName("Max performance review files")
    .setDesc("Maximum number of performance reviews to include")
    .addText((text) =>
      text
        .setPlaceholder("6")
        .setValue(plugin.settings.o3Coach.perfReviewMax.toString())
        .onChange(async (value) => {
          const parsed = parseOptionalNumber(value);
          plugin.settings.o3Coach.perfReviewMax = parsed ?? 6;
          await plugin.saveSettings();
        })
    );

  new Setting(containerEl)
    .setName("Max current notes")
    .setDesc("Maximum number of daily/meeting notes to include")
    .addText((text) =>
      text
        .setPlaceholder("50")
        .setValue(plugin.settings.o3Coach.currentNotesMax.toString())
        .onChange(async (value) => {
          const parsed = parseOptionalNumber(value);
          plugin.settings.o3Coach.currentNotesMax = parsed ?? 50;
          await plugin.saveSettings();
        })
    );
}
