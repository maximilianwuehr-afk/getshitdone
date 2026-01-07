// ============================================================================
// Inbox Tab - Capture, routing, and formatting settings
// ============================================================================

import { Setting, Notice } from "obsidian";
import type GetShitDonePlugin from "../main";
import type { InboxRouteDestination, InboxFormatStyle } from "../types";
import {
  createSection,
  createSubsection,
  createDetailsSection,
  createListSetting,
  addTriStateDropdown,
  parseOptionalNumber,
  formatRuleSummary,
  filterContentTypes,
  createDefaultRoutingRule,
  cloneRoutingRule,
  cloneInboxSettings,
  openSettingsHelperModal,
  getSettingsHelperModel,
} from "./helpers";

// ============================================================================
// Public API
// ============================================================================

export function renderInboxTab(
  containerEl: HTMLElement,
  plugin: GetShitDonePlugin,
  onRefresh: () => void
): void {
  renderInbox(containerEl, plugin, onRefresh);
}

// ============================================================================
// Private Helpers
// ============================================================================

function renderInbox(
  containerEl: HTMLElement,
  plugin: GetShitDonePlugin,
  onRefresh: () => void
): void {
  createSection(
    containerEl,
    "Inbox",
    "Capture, route, and format content from shortcuts or share sheets."
  );

  new Setting(containerEl)
    .setName("Enable Inbox")
    .setDesc("Enable the inbox feature for capturing content via URI")
    .addToggle((toggle) =>
      toggle
        .setValue(plugin.settings.inbox.enabled)
        .onChange(async (value) => {
          plugin.settings.inbox.enabled = value;
          await plugin.saveSettings();
        })
    );

  new Setting(containerEl)
    .setName("Thoughts Section")
    .setDesc("Section heading in daily note where captured thoughts are appended")
    .addText((text) =>
      text
        .setPlaceholder("## Thoughts")
        .setValue(plugin.settings.inbox.thoughtsSection)
        .onChange(async (value) => {
          plugin.settings.inbox.thoughtsSection = value || "## Thoughts";
          await plugin.saveSettings();
        })
    );

  new Setting(containerEl)
    .setName("Meeting Detection Window")
    .setDesc("Minutes before/after meeting times to consider as 'in a meeting'")
    .addSlider((slider) =>
      slider
        .setLimits(5, 30, 5)
        .setValue(plugin.settings.inbox.meetingWindowMinutes)
        .setDynamicTooltip()
        .onChange(async (value) => {
          plugin.settings.inbox.meetingWindowMinutes = value;
          await plugin.saveSettings();
        })
    );

  new Setting(containerEl)
    .setName("Smart Suggestions")
    .setDesc("Suggest adding information to existing People/Organization notes when mentioned")
    .addToggle((toggle) =>
      toggle
        .setValue(plugin.settings.inbox.smartSuggestionsEnabled)
        .onChange(async (value) => {
          plugin.settings.inbox.smartSuggestionsEnabled = value;
          await plugin.saveSettings();
        })
    );

  new Setting(containerEl)
    .setName("AI Routing Fallback")
    .setDesc("Use AI routing when no deterministic rule matches")
    .addToggle((toggle) =>
      toggle
        .setValue(plugin.settings.inbox.routing.aiFallbackEnabled)
        .onChange(async (value) => {
          plugin.settings.inbox.routing.aiFallbackEnabled = value;
          await plugin.saveSettings();
        })
    );

  // Trigger phrases section
  const triggerSection = createDetailsSection(
    containerEl,
    "Trigger phrases",
    "Custom commands recognized at the start of a capture."
  );

  new Setting(triggerSection)
    .setName("Enable Trigger Phrases")
    .setDesc("Enable special phrases like 'Research' or 'Follow up'")
    .addToggle((toggle) =>
      toggle
        .setValue(plugin.settings.inbox.triggers.enabled)
        .onChange(async (value) => {
          plugin.settings.inbox.triggers.enabled = value;
          await plugin.saveSettings();
        })
    );

  createListSetting(triggerSection, plugin, {
    name: "Follow-up phrases",
    desc: "Starts a follow-up task when a capture begins with one of these",
    value: plugin.settings.inbox.triggers.followupPhrases,
    placeholder: "follow up\nfollow-up\nfollowup",
    helper: {
      title: "Follow-up phrase helper",
      context: "Inbox follow-up trigger phrases",
      defaultQuestion: "Suggest more follow-up phrases. Return one per line.",
    },
    onChange: async (value) => {
      plugin.settings.inbox.triggers.followupPhrases = value;
      await plugin.saveSettings();
    },
  });

  createListSetting(triggerSection, plugin, {
    name: "Research phrases",
    desc: "Starts a research run when a capture begins with one of these",
    value: plugin.settings.inbox.triggers.researchPhrases,
    placeholder: "research",
    helper: {
      title: "Research phrase helper",
      context: "Inbox research trigger phrases",
      defaultQuestion: "Suggest research trigger phrases. Return one per line.",
    },
    onChange: async (value) => {
      plugin.settings.inbox.triggers.researchPhrases = value;
      await plugin.saveSettings();
    },
  });

  // Routing section
  const routingSection = createDetailsSection(
    containerEl,
    "Routing",
    "Deterministic rules with a fallback default."
  );

  new Setting(routingSection)
    .setName("Default destination")
    .setDesc("Where to send items when no rule matches")
    .addDropdown((dropdown) =>
      dropdown
        .addOption("daily_thoughts", "Daily thoughts")
        .addOption("meeting_followup", "Meeting follow-up")
        .addOption("daily_end", "Daily end")
        .setValue(plugin.settings.inbox.routing.defaultDestination)
        .onChange(async (value) => {
          plugin.settings.inbox.routing.defaultDestination =
            value as InboxRouteDestination;
          await plugin.saveSettings();
        })
    );

  new Setting(routingSection)
    .setName("Default format")
    .setDesc("How to format items when no rule matches")
    .addDropdown((dropdown) =>
      dropdown
        .addOption("auto", "Auto")
        .addOption("task", "Task")
        .addOption("thought", "Thought")
        .setValue(plugin.settings.inbox.routing.defaultFormat)
        .onChange(async (value) => {
          plugin.settings.inbox.routing.defaultFormat = value as InboxFormatStyle;
          await plugin.saveSettings();
        })
    );

  new Setting(routingSection)
    .setName("Default add due date")
    .setDesc("Add a due date when default formatting yields a task")
    .addToggle((toggle) =>
      toggle
        .setValue(plugin.settings.inbox.routing.defaultAddDueDate)
        .onChange(async (value) => {
          plugin.settings.inbox.routing.defaultAddDueDate = value;
          await plugin.saveSettings();
        })
    );

  new Setting(routingSection)
    .setName("Routing rule helper")
    .setDesc("Ask for ideas, edge cases, or regex examples")
    .addButton((button) =>
      button.setButtonText("Ask AI").onClick(() => {
        openSettingsHelperModal(plugin, {
          title: "Inbox routing rules",
          context: "Inbox routing rules and deterministic matching",
          currentValue: plugin.settings.inbox.routing.rules
            .map((rule) => `- ${rule.name}`)
            .join("\n"),
          defaultQuestion:
            "How would you structure inbox routing rules for tasks, references, and meeting follow-ups?",
          model: getSettingsHelperModel(plugin.settings),
          aiService: plugin.getAIService(),
        });
      })
    );

  renderInboxRoutingRules(routingSection, plugin, onRefresh);

  // Action detection section
  const actionSection = createDetailsSection(
    containerEl,
    "Action detection",
    "Controls when content becomes a task."
  );

  new Setting(actionSection)
    .setName("Enable action detection")
    .setDesc("Detects action verbs and short tasks")
    .addToggle((toggle) =>
      toggle
        .setValue(plugin.settings.inbox.actionDetection.enabled)
        .onChange(async (value) => {
          plugin.settings.inbox.actionDetection.enabled = value;
          await plugin.saveSettings();
        })
    );

  new Setting(actionSection)
    .setName("Match mode")
    .setDesc("Whether verbs must start the line or just appear anywhere")
    .addDropdown((dropdown) =>
      dropdown
        .addOption("starts_with", "Starts with")
        .addOption("contains", "Contains")
        .addOption("both", "Starts with or contains")
        .setValue(plugin.settings.inbox.actionDetection.matchMode)
        .onChange(async (value) => {
          plugin.settings.inbox.actionDetection.matchMode = value as
            | "starts_with"
            | "contains"
            | "both";
          await plugin.saveSettings();
        })
    );

  createListSetting(actionSection, plugin, {
    name: "Action verbs",
    desc: "Verbs or phrases that should imply a task (one per line)",
    value: plugin.settings.inbox.actionDetection.verbs,
    placeholder: "call\nemail\nfollow up\nreview\nprepare",
    helper: {
      title: "Action verb helper",
      context: "Inbox action verb list",
      defaultQuestion: "Suggest action verbs for tasks. Return one per line.",
    },
    onChange: async (value) => {
      plugin.settings.inbox.actionDetection.verbs = value;
      await plugin.saveSettings();
    },
  });

  new Setting(actionSection)
    .setName("Imperative detection")
    .setDesc("Treat imperative phrasing (e.g., 'Review the draft') as tasks")
    .addToggle((toggle) =>
      toggle
        .setValue(plugin.settings.inbox.actionDetection.includeImperativePattern)
        .onChange(async (value) => {
          plugin.settings.inbox.actionDetection.includeImperativePattern = value;
          await plugin.saveSettings();
        })
    );

  new Setting(actionSection)
    .setName("Short content heuristics")
    .setDesc("Treat short lines as tasks when no other rule matches")
    .addToggle((toggle) =>
      toggle
        .setValue(plugin.settings.inbox.actionDetection.includeShortContent)
        .onChange(async (value) => {
          plugin.settings.inbox.actionDetection.includeShortContent = value;
          await plugin.saveSettings();
        })
    );

  new Setting(actionSection)
    .setName("Short content max length")
    .setDesc("Maximum characters to treat a short line as a task")
    .addSlider((slider) =>
      slider
        .setLimits(20, 200, 5)
        .setValue(plugin.settings.inbox.actionDetection.shortContentMaxChars)
        .setDynamicTooltip()
        .onChange(async (value) => {
          plugin.settings.inbox.actionDetection.shortContentMaxChars = value;
          await plugin.saveSettings();
        })
    );

  // Formatting section
  const formattingSection = createDetailsSection(
    containerEl,
    "Formatting",
    "Controls task and thought formatting."
  );

  new Setting(formattingSection)
    .setName("Default Due Date Offset")
    .setDesc("Days from today for task due dates (0 = today, 1 = tomorrow)")
    .addSlider((slider) =>
      slider
        .setLimits(0, 14, 1)
        .setValue(plugin.settings.inbox.formatting.defaultDueDateOffset)
        .setDynamicTooltip()
        .onChange(async (value) => {
          plugin.settings.inbox.formatting.defaultDueDateOffset = value;
          await plugin.saveSettings();
        })
    );

  new Setting(formattingSection)
    .setName("Task prefix")
    .setDesc("Prefix used for tasks")
    .addText((text) =>
      text
        .setPlaceholder("- [ ]")
        .setValue(plugin.settings.inbox.formatting.taskPrefix)
        .onChange(async (value) => {
          plugin.settings.inbox.formatting.taskPrefix = value || "- [ ]";
          await plugin.saveSettings();
        })
    );

  new Setting(formattingSection)
    .setName("Due date marker")
    .setDesc("Marker inserted before due dates")
    .addText((text) =>
      text
        .setPlaceholder("📅")
        .setValue(plugin.settings.inbox.formatting.dueDateEmoji)
        .onChange(async (value) => {
          plugin.settings.inbox.formatting.dueDateEmoji = value || "📅";
          await plugin.saveSettings();
        })
    );

  new Setting(formattingSection)
    .setName("Thought timestamp format")
    .setDesc("Moment.js format used for thought timestamps")
    .addText((text) =>
      text
        .setPlaceholder("HH:mm")
        .setValue(plugin.settings.inbox.formatting.timeFormat)
        .onChange(async (value) => {
          plugin.settings.inbox.formatting.timeFormat = value || "HH:mm";
          await plugin.saveSettings();
        })
    );

  // Link summaries section
  const summarySection = createDetailsSection(
    containerEl,
    "Link summaries",
    "Use the Summarize plugin to add an indented summary under captured links."
  );

  new Setting(summarySection)
    .setName("Enable link summaries")
    .setDesc("When a capture includes a URL, insert a summary using the Summarize plugin")
    .addToggle((toggle) =>
      toggle
        .setValue(plugin.settings.inbox.contentSummary.enabled)
        .onChange(async (value) => {
          plugin.settings.inbox.contentSummary.enabled = value;
          await plugin.saveSettings();
        })
    );

  // URI section
  const uriSection = createDetailsSection(
    containerEl,
    "Capture URI",
    "Use this format in iPhone Shortcuts."
  );

  const uriValue = "obsidian://gsd-inbox?content={content}&type={type}";

  new Setting(uriSection)
    .setName("Inbox URI Format")
    .setDesc("Use this URI format in your shortcuts")
    .addText((text) => {
      text.setValue(uriValue).setDisabled(true);
      text.inputEl.style.width = "100%";
      text.inputEl.style.fontFamily = "monospace";
      text.inputEl.style.fontSize = "12px";
    })
    .addButton((button) =>
      button.setButtonText("Copy").onClick(async () => {
        try {
          await navigator.clipboard.writeText(uriValue);
          new Notice("Inbox URI copied to clipboard.");
        } catch (error) {
          console.error("[GSD] Clipboard copy failed", error);
          new Notice("Could not copy. Please copy manually.");
        }
      })
    );

  // Reset section
  const resetSection = createDetailsSection(
    containerEl,
    "Reset",
    "Restore inbox settings to defaults."
  );

  new Setting(resetSection)
    .setName("Reset Inbox Settings")
    .setDesc("Reset inbox settings to defaults")
    .addButton((button) =>
      button.setButtonText("Reset Inbox").onClick(async () => {
        plugin.settings.inbox = cloneInboxSettings();
        await plugin.saveSettings();
        onRefresh();
      })
    );
}

function renderInboxRoutingRules(
  containerEl: HTMLElement,
  plugin: GetShitDonePlugin,
  onRefresh: () => void
): void {
  const rules = plugin.settings.inbox.routing.rules;

  if (!rules.length) {
    containerEl.createEl("p", {
      text: "No routing rules configured. Add one below.",
      cls: "setting-item-description",
    });
  }

  rules.forEach((rule, index) => {
    rule.match = rule.match || {};
    rule.action = rule.action || {
      destination: "daily_thoughts",
      format: "auto",
      addDueDate: true,
    };

    const details = containerEl.createEl("details", {
      cls: "gsd-routing-rule",
    });
    details.open = false;

    const summary = details.createEl("summary");
    const summaryLabel = summary.createSpan({
      text: formatRuleSummary(rule),
    });

    const body = details.createDiv({ cls: "gsd-routing-rule-body" });

    const updateSummary = () => {
      summaryLabel.setText(formatRuleSummary(rule));
    };

    new Setting(body)
      .setName("Name")
      .setDesc("Short description for this rule")
      .addText((text) =>
        text
          .setPlaceholder("Task from clipboard")
          .setValue(rule.name)
          .onChange(async (value) => {
            rule.name = value;
            updateSummary();
            await plugin.saveSettings();
          })
      );

    new Setting(body)
      .setName("Enabled")
      .setDesc("Turn this rule on or off")
      .addToggle((toggle) =>
        toggle.setValue(rule.enabled).onChange(async (value) => {
          rule.enabled = value;
          updateSummary();
          await plugin.saveSettings();
        })
      );

    new Setting(body)
      .setName("Rule actions")
      .setDesc("Order and lifecycle controls")
      .addButton((button) =>
        button.setButtonText("Move up").onClick(async () => {
          if (index === 0) return;
          const updated = [...rules];
          [updated[index - 1], updated[index]] = [updated[index], updated[index - 1]];
          plugin.settings.inbox.routing.rules = updated;
          await plugin.saveSettings();
          onRefresh();
        })
      )
      .addButton((button) =>
        button.setButtonText("Move down").onClick(async () => {
          if (index >= rules.length - 1) return;
          const updated = [...rules];
          [updated[index + 1], updated[index]] = [updated[index], updated[index + 1]];
          plugin.settings.inbox.routing.rules = updated;
          await plugin.saveSettings();
          onRefresh();
        })
      )
      .addButton((button) =>
        button.setButtonText("Duplicate").onClick(async () => {
          const clone = cloneRoutingRule(rule);
          plugin.settings.inbox.routing.rules = [
            ...rules.slice(0, index + 1),
            clone,
            ...rules.slice(index + 1),
          ];
          await plugin.saveSettings();
          onRefresh();
        })
      )
      .addButton((button) =>
        button.setButtonText("Delete").onClick(async () => {
          plugin.settings.inbox.routing.rules = rules.filter((_, i) => i !== index);
          await plugin.saveSettings();
          onRefresh();
        })
      );

    createSubsection(body, "Match", "All specified conditions must match.");

    createListSetting(body, plugin, {
      name: "Content types",
      desc: "Match if the incoming content type is in this list",
      value: rule.match.contentTypes || [],
      placeholder: "task\nlink\ntranscript",
      rows: 4,
      onChange: async (value) => {
        rule.match.contentTypes = filterContentTypes(value);
        await plugin.saveSettings();
      },
    });

    createListSetting(body, plugin, {
      name: "Content starts with",
      desc: "Case-insensitive prefixes to match",
      value: rule.match.contentStartsWith || [],
      placeholder: "- [ ]\nTODO",
      rows: 4,
      onChange: async (value) => {
        rule.match.contentStartsWith = value;
        await plugin.saveSettings();
      },
    });

    createListSetting(body, plugin, {
      name: "Content includes",
      desc: "Case-insensitive substrings to match",
      value: rule.match.contentIncludes || [],
      placeholder: "agenda\nminutes",
      rows: 4,
      onChange: async (value) => {
        rule.match.contentIncludes = value;
        await plugin.saveSettings();
      },
    });

    new Setting(body)
      .setName("Content regex")
      .setDesc("JavaScript regex used to match the content (use flags below for case-insensitive)")
      .addText((text) =>
        text
          .setPlaceholder("invoice|receipt")
          .setValue(rule.match.contentRegex || "")
          .onChange(async (value) => {
            rule.match.contentRegex = value.trim() || undefined;
            await plugin.saveSettings();
          })
      );

    new Setting(body)
      .setName("Regex flags")
      .setDesc("Regex flags (e.g., i, m, s). Leave empty for default.")
      .addText((text) =>
        text
          .setPlaceholder("i")
          .setValue(rule.match.regexFlags || "")
          .onChange(async (value) => {
            rule.match.regexFlags = value.trim() || undefined;
            await plugin.saveSettings();
          })
      );

    addTriStateDropdown(body, {
      name: "Is URL",
      desc: "Match based on whether content is a URL",
      value: rule.match.isUrl,
      onChange: async (value) => {
        rule.match.isUrl = value;
        await plugin.saveSettings();
      },
    });

    addTriStateDropdown(body, {
      name: "Has task checkbox",
      desc: "Match content that already contains the task prefix",
      value: rule.match.hasTaskCheckbox,
      onChange: async (value) => {
        rule.match.hasTaskCheckbox = value;
        await plugin.saveSettings();
      },
    });

    addTriStateDropdown(body, {
      name: "Action item",
      desc: "Match if action detection classifies it as a task",
      value: rule.match.actionItem,
      onChange: async (value) => {
        rule.match.actionItem = value;
        await plugin.saveSettings();
      },
    });

    addTriStateDropdown(body, {
      name: "In meeting",
      desc: "Match based on meeting context",
      value: rule.match.inMeeting,
      onChange: async (value) => {
        rule.match.inMeeting = value;
        await plugin.saveSettings();
      },
    });

    new Setting(body)
      .setName("Min length")
      .setDesc("Minimum characters required")
      .addText((text) =>
        text
          .setPlaceholder("0")
          .setValue(rule.match.minLength?.toString() || "")
          .onChange(async (value) => {
            rule.match.minLength = parseOptionalNumber(value);
            await plugin.saveSettings();
          })
      );

    new Setting(body)
      .setName("Max length")
      .setDesc("Maximum characters allowed")
      .addText((text) =>
        text
          .setPlaceholder("500")
          .setValue(rule.match.maxLength?.toString() || "")
          .onChange(async (value) => {
            rule.match.maxLength = parseOptionalNumber(value);
            await plugin.saveSettings();
          })
      );

    createSubsection(body, "Action", "What happens when the rule matches.");

    new Setting(body)
      .setName("Destination")
      .setDesc("Where the content is routed")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("daily_thoughts", "Daily thoughts")
          .addOption("meeting_followup", "Meeting follow-up")
          .addOption("daily_end", "Daily end")
          .setValue(rule.action.destination)
          .onChange(async (value) => {
            rule.action.destination = value as InboxRouteDestination;
            await plugin.saveSettings();
          })
      );

    new Setting(body)
      .setName("Format")
      .setDesc("How the content is formatted")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("auto", "Auto")
          .addOption("task", "Task")
          .addOption("thought", "Thought")
          .setValue(rule.action.format)
          .onChange(async (value) => {
            rule.action.format = value as InboxFormatStyle;
            await plugin.saveSettings();
          })
      );

    new Setting(body)
      .setName("Add due date")
      .setDesc("Add a due date when formatting as task")
      .addToggle((toggle) =>
        toggle.setValue(rule.action.addDueDate).onChange(async (value) => {
          rule.action.addDueDate = value;
          await plugin.saveSettings();
        })
      );

    new Setting(body)
      .setName("Due date offset")
      .setDesc("Override default due date offset for this rule")
      .addText((text) =>
        text
          .setPlaceholder("1")
          .setValue(rule.action.dueDateOffset?.toString() || "")
          .onChange(async (value) => {
            rule.action.dueDateOffset = parseOptionalNumber(value);
            await plugin.saveSettings();
          })
      );
  });

  new Setting(containerEl)
    .setName("Add routing rule")
    .setDesc("Add a new rule at the bottom of the list")
    .addButton((button) =>
      button.setButtonText("Add rule").onClick(async () => {
        plugin.settings.inbox.routing.rules = [
          ...plugin.settings.inbox.routing.rules,
          createDefaultRoutingRule(),
        ];
        await plugin.saveSettings();
        onRefresh();
      })
    );

  new Setting(containerEl)
    .setName("Reset routing rules")
    .setDesc("Replace routing rules with defaults")
    .addButton((button) =>
      button.setButtonText("Reset rules").onClick(async () => {
        plugin.settings.inbox.routing.rules = cloneInboxSettings().routing.rules;
        await plugin.saveSettings();
        onRefresh();
      })
    );
}
