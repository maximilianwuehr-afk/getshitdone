// ============================================================================
// Feedback Action - User feedback collection for research quality
// ============================================================================

import { App, TFile, Notice, Modal, Setting } from "obsidian";
import type { PluginSettings, FeedbackEntry, FeedbackStore } from "../types";

const moment = (window as any).moment;

// ============================================================================
// FeedbackAction Class
// ============================================================================

/**
 * Feedback Action
 * Collects user feedback on research quality to improve future prompts
 */
export class FeedbackAction {
  private app: App;
  private settings: PluginSettings;
  private feedbackStore: FeedbackStore;
  private feedbackPath: string;

  constructor(app: App, settings: PluginSettings) {
    this.app = app;
    this.settings = settings;
    this.feedbackPath = "Z_Settings & Tools/gsd-feedback.json";
    this.feedbackStore = { entries: [], lastUpdated: "" };
  }

  /**
   * Update settings reference
   */
  updateSettings(settings: PluginSettings): void {
    this.settings = settings;
  }

  /**
   * Load feedback from vault
   */
  async loadFeedback(): Promise<void> {
    try {
      const file = this.app.vault.getAbstractFileByPath(this.feedbackPath);
      if (file && file instanceof TFile) {
        const content = await this.app.vault.read(file);
        this.feedbackStore = JSON.parse(content);
      }
    } catch (e) {
      // File doesn't exist or invalid JSON, start fresh
      this.feedbackStore = { entries: [], lastUpdated: "" };
    }
  }

  /**
   * Save feedback to vault
   */
  async saveFeedback(): Promise<void> {
    this.feedbackStore.lastUpdated = moment().format("YYYY-MM-DD HH:mm:ss");
    const content = JSON.stringify(this.feedbackStore, null, 2);

    const file = this.app.vault.getAbstractFileByPath(this.feedbackPath);
    if (file && file instanceof TFile) {
      await this.app.vault.modify(file, content);
    } else {
      await this.app.vault.create(this.feedbackPath, content);
    }
  }

  /**
   * Add feedback for the current note
   */
  async addFeedbackForCurrentNote(): Promise<void> {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      new Notice("No active file");
      return;
    }

    // Determine feedback type based on folder
    let type: "briefing" | "person" | "org" = "briefing";
    if (activeFile.path.startsWith(this.settings.peopleFolder + "/")) {
      type = "person";
    } else if (activeFile.path.startsWith(this.settings.organizationsFolder + "/")) {
      type = "org";
    }

    // Load existing feedback
    await this.loadFeedback();

    // Show feedback modal
    new FeedbackModal(this.app, type, activeFile.path, async (issue: string) => {
      const content = await this.app.vault.read(activeFile);

      const entry: FeedbackEntry = {
        id: `fb-${Date.now()}`,
        timestamp: moment().format("YYYY-MM-DD HH:mm:ss"),
        type: type,
        notePath: activeFile.path,
        issue: issue,
        originalContent: this.extractResearchContent(content, type),
      };

      this.feedbackStore.entries.push(entry);
      await this.saveFeedback();

      new Notice(`Feedback recorded for ${activeFile.basename}`);
    }).open();
  }

  /**
   * Extract the research content from a note
   */
  private extractResearchContent(content: string, type: "briefing" | "person" | "org"): string {
    if (type === "person") {
      const match = content.match(/## Research Summary\n([\s\S]*?)(?=\n##|$)/);
      return match ? match[1].trim() : "";
    } else if (type === "org") {
      const match = content.match(/## About\n([\s\S]*?)(?=\n##|$)/);
      return match ? match[1].trim() : "";
    }
    // For briefings, extract the sub-bullet
    const match = content.match(/\t- (?!\[!working\])(.+)/);
    return match ? match[1].trim() : "";
  }

  /**
   * Get feedback summary for prompt improvement
   */
  async getFeedbackSummary(type: "briefing" | "person" | "org"): Promise<string> {
    await this.loadFeedback();

    const relevantFeedback = this.feedbackStore.entries
      .filter((e) => e.type === type)
      .slice(-10); // Last 10 entries

    if (relevantFeedback.length === 0) {
      return "";
    }

    const issues = relevantFeedback.map((e) => `- ${e.issue}`).join("\n");
    return `\n**LEARN FROM PAST FEEDBACK:**\nUsers have reported these issues with previous outputs:\n${issues}\nAvoid these mistakes.\n`;
  }

  /**
   * Get feedback entries
   */
  getEntries(): FeedbackEntry[] {
    return this.feedbackStore.entries;
  }

  /**
   * Clear old feedback (keep last 50)
   */
  async pruneOldFeedback(): Promise<void> {
    await this.loadFeedback();
    if (this.feedbackStore.entries.length > 50) {
      this.feedbackStore.entries = this.feedbackStore.entries.slice(-50);
      await this.saveFeedback();
    }
  }
}

/**
 * Modal for collecting feedback
 */
class FeedbackModal extends Modal {
  private type: "briefing" | "person" | "org";
  private notePath: string;
  private onSubmit: (issue: string) => void;
  private selectedIssue: string = "";

  constructor(
    app: App,
    type: "briefing" | "person" | "org",
    notePath: string,
    onSubmit: (issue: string) => void
  ) {
    super(app);
    this.type = type;
    this.notePath = notePath;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "Report Research Issue" });
    contentEl.createEl("p", {
      text: `What was wrong with the ${this.type} research?`,
      cls: "setting-item-description",
    });

    // Common issues as quick buttons
    const commonIssues = this.getCommonIssues();
    const buttonContainer = contentEl.createDiv({ cls: "gsd-feedback-buttons" });
    buttonContainer.style.display = "flex";
    buttonContainer.style.flexWrap = "wrap";
    buttonContainer.style.gap = "8px";
    buttonContainer.style.marginBottom = "16px";

    for (const issue of commonIssues) {
      const btn = buttonContainer.createEl("button", { text: issue });
      btn.style.padding = "8px 12px";
      btn.style.cursor = "pointer";
      btn.addEventListener("click", () => {
        this.selectedIssue = issue;
        this.submit();
      });
    }

    // Custom feedback input
    contentEl.createEl("p", {
      text: "Or describe the issue:",
      cls: "setting-item-description",
    });

    const textArea = contentEl.createEl("textarea");
    textArea.style.width = "100%";
    textArea.style.height = "80px";
    textArea.style.marginBottom = "16px";
    textArea.placeholder = "e.g., The job title was outdated, should be...";

    // Submit button
    const submitBtn = contentEl.createEl("button", { text: "Submit Feedback" });
    submitBtn.style.marginRight = "8px";
    submitBtn.addEventListener("click", () => {
      this.selectedIssue = textArea.value.trim() || this.selectedIssue;
      if (this.selectedIssue) {
        this.submit();
      } else {
        new Notice("Please select or enter an issue");
      }
    });

    // Cancel button
    const cancelBtn = contentEl.createEl("button", { text: "Cancel" });
    cancelBtn.addEventListener("click", () => this.close());
  }

  private getCommonIssues(): string[] {
    if (this.type === "person") {
      return [
        "Job title incorrect/outdated",
        "Wrong company",
        "Missing key facts",
        "Too generic/vague",
        "Contains fluff words",
        "Wrong person entirely",
      ];
    } else if (this.type === "org") {
      return [
        "Numbers are wrong",
        "Missing key people",
        "Outdated information",
        "Too generic/vague",
        "Contains fluff words",
        "Wrong company type",
      ];
    } else {
      return [
        "Missing context from previous meetings",
        "Too generic",
        "Irrelevant information",
        "Contains fluff words",
        "Missing key facts about attendees",
        "Numbers/dates wrong",
      ];
    }
  }

  private submit() {
    this.onSubmit(this.selectedIssue);
    this.close();
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

