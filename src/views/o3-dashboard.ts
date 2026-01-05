import { ItemView, WorkspaceLeaf, Notice, Menu, TextAreaComponent, DropdownComponent } from "obsidian";
import type GetShitDonePlugin from "../main";
import { O3PrepAction, O3MeetingItem, O3Person, O3DashboardData } from "../actions/o3-prep";
import { O3CoachAction, O3CoachSuggestion, O3CoachSource } from "../actions/o3-coach";
import type { CalendarEvent } from "../types";

export const O3_DASHBOARD_VIEW = "gsd-o3-dashboard";

type CoachMessage = { role: "user" | "assistant"; content: string };

// Editable suggestion with section assignment
type EditableSuggestion = {
  id: string;
  text: string;
  section: string;
  sourceIds?: string[];
  accepted: boolean;
};

const O3_SECTIONS = [
  "Follow-ups to Discuss",
  "Updates You Need to Prepare",
  "Discussion Topics",
  "Feedback to Give",
];

export class O3DashboardView extends ItemView {
  private plugin: GetShitDonePlugin;
  private o3Prep: O3PrepAction;
  private o3Coach: O3CoachAction;
  private data: O3DashboardData | null = null;

  // Selection state
  private selectedPersonPath: string | null = null;

  // Suggestions (from Gather Context or Coach)
  private suggestions: EditableSuggestion[] = [];

  // Coach chat (separate from suggestions)
  private coachMessages: CoachMessage[] = [];

  // Source status
  private lastSources: O3CoachSource[] = [];
  private lastWarnings: string[] = [];

  // Loading states
  private isGathering: boolean = false;
  private isCoachThinking: boolean = false;

  // Source toggles
  private includeSources: Record<string, boolean> = {
    master: true,
    person: true,
    o3doc: true,
    meeting: true,
    daily: true,
    perf: true,
  };

  private suggestionIdCounter = 0;

  constructor(
    leaf: WorkspaceLeaf,
    plugin: GetShitDonePlugin,
    o3Prep: O3PrepAction,
    o3Coach: O3CoachAction
  ) {
    super(leaf);
    this.plugin = plugin;
    this.o3Prep = o3Prep;
    this.o3Coach = o3Coach;
  }

  getViewType(): string {
    return O3_DASHBOARD_VIEW;
  }

  getDisplayText(): string {
    return "O3 Dashboard";
  }

  async onOpen(): Promise<void> {
    await this.render();
  }

  async render(): Promise<void> {
    const contentEl = this.containerEl.children[1];
    contentEl.empty();
    contentEl.addClass("gsd-o3-dashboard");

    if (!this.plugin.settings.o3.enabled) {
      contentEl.createEl("p", { text: "O3 dashboard is disabled in settings." });
      return;
    }

    this.data = await this.o3Prep.getDashboardData();

    // Header
    const header = contentEl.createDiv({ cls: "gsd-o3-header" });
    header.createEl("h3", { text: `Week of ${this.data.weekStart} – ${this.data.weekEnd}` });

    const headerActions = header.createDiv({ cls: "gsd-o3-header-actions" });

    const refreshBtn = headerActions.createEl("button", { text: "Refresh" });
    refreshBtn.onclick = async () => {
      this.selectedPersonPath = null;
      this.resetState();
      await this.render();
    };

    const masterBtn = headerActions.createEl("button", { text: "Open Master Note" });
    masterBtn.onclick = () => {
      const path = this.stripMd(this.plugin.settings.o3.masterNotePath);
      this.plugin.app.workspace.openLinkText(path, "", false);
    };

    // This Week's O3s
    contentEl.createEl("h4", { text: "This Week's O3s" });
    if (this.data.meetings.length === 0) {
      contentEl.createEl("p", { text: "No O3s scheduled this week." });
    } else {
      for (const item of this.data.meetings) {
        this.renderMeetingCard(contentEl, item);
      }
    }

    // O3s without meetings this week
    if (this.data.o3WithoutMeeting.length > 0) {
      contentEl.createEl("h4", { text: "No Meeting This Week" });
      for (const person of this.data.o3WithoutMeeting) {
        this.renderPersonCard(contentEl, person, null);
      }
    }
  }

  private resetState(): void {
    this.suggestions = [];
    this.coachMessages = [];
    this.lastSources = [];
    this.lastWarnings = [];
    this.isGathering = false;
    this.isCoachThinking = false;
  }

  private renderMeetingCard(container: HTMLElement, item: O3MeetingItem): void {
    const isSelected = this.selectedPersonPath === item.person.filePath;
    const card = container.createDiv({
      cls: `gsd-o3-card ${isSelected ? "gsd-o3-card-selected" : "gsd-o3-card-collapsed"}`
    });

    // Header (clickable to expand/collapse)
    const header = card.createDiv({ cls: "gsd-o3-card-header" });
    header.onclick = () => this.toggleSelection(item.person, item.event);

    const titleRow = header.createDiv({ cls: "gsd-o3-title-row" });
    const indicator = titleRow.createSpan({ cls: "gsd-o3-expand-indicator" });
    indicator.textContent = isSelected ? "▼" : "▶";

    titleRow.createEl("strong", { text: item.person.name, cls: "gsd-o3-person-name" });
    titleRow.createSpan({ text: item.meetingTime, cls: "gsd-o3-meeting-time" });

    if (item.lastMeetingDate) {
      header.createSpan({ text: `Last: ${item.lastMeetingDate}`, cls: "gsd-o3-meeting-meta" });
    }

    if (isSelected) {
      this.renderExpandedContent(card, item.person, item.event);
    }
  }

  private renderPersonCard(container: HTMLElement, person: O3Person, event: CalendarEvent | null): void {
    const isSelected = this.selectedPersonPath === person.filePath;
    const card = container.createDiv({
      cls: `gsd-o3-card ${isSelected ? "gsd-o3-card-selected" : "gsd-o3-card-collapsed"}`
    });

    const header = card.createDiv({ cls: "gsd-o3-card-header" });
    header.onclick = () => this.toggleSelection(person, event);

    const titleRow = header.createDiv({ cls: "gsd-o3-title-row" });
    const indicator = titleRow.createSpan({ cls: "gsd-o3-expand-indicator" });
    indicator.textContent = isSelected ? "▼" : "▶";

    titleRow.createEl("strong", { text: person.name });
    titleRow.createSpan({ text: "No meeting", cls: "gsd-o3-meeting-meta" });

    if (isSelected) {
      this.renderExpandedContent(card, person, event);
    }
  }

  private async toggleSelection(person: O3Person, event: CalendarEvent | null): Promise<void> {
    if (this.selectedPersonPath === person.filePath) {
      this.selectedPersonPath = null;
      this.resetState();
    } else {
      this.selectedPersonPath = person.filePath;
      this.resetState();
    }
    await this.render();
  }

  private renderExpandedContent(card: HTMLElement, person: O3Person, event: CalendarEvent | null): void {
    const content = card.createDiv({ cls: "gsd-o3-expanded-content" });

    // === Step 1: Gather Context Button ===
    this.renderGatherSection(content, person, event);

    // === Step 2: Suggestions Panel ===
    if (this.suggestions.length > 0 || this.isGathering) {
      this.renderSuggestionsPanel(content, person, event);
    }

    // === Step 3: Coach Chat (separate) ===
    this.renderCoachSection(content, person, event);

    // === Bottom Actions ===
    this.renderBottomActions(content, person, event);
  }

  private renderGatherSection(container: HTMLElement, person: O3Person, event: CalendarEvent | null): void {
    const section = container.createDiv({ cls: "gsd-o3-gather-section" });

    const row = section.createDiv({ cls: "gsd-o3-gather-row" });

    const gatherBtn = row.createEl("button", { cls: "gsd-o3-gather-btn" });
    if (this.isGathering) {
      gatherBtn.textContent = "Gathering...";
      gatherBtn.disabled = true;
      gatherBtn.addClass("gsd-o3-loading");
    } else {
      gatherBtn.textContent = "Gather Context";
    }
    gatherBtn.onclick = async (evt) => {
      evt.stopPropagation();
      if (this.isGathering) return;
      await this.gatherContext(person, event);
    };

    // Source settings
    const settingsBtn = row.createEl("button", { cls: "gsd-o3-settings-btn" });
    settingsBtn.textContent = "⚙️";
    settingsBtn.title = "Configure sources";
    settingsBtn.onclick = (evt) => {
      evt.stopPropagation();
      this.showSourceSettings(evt as MouseEvent);
    };

    // Source status (after gathering)
    if (this.lastSources.length > 0) {
      this.renderSourceStatus(section);
    }
  }

  private renderSourceStatus(container: HTMLElement): void {
    const statusRow = container.createDiv({ cls: "gsd-o3-source-status" });
    statusRow.createSpan({ text: "Sources: ", cls: "gsd-o3-source-label" });

    const kindLabels: Record<string, string> = {
      master: "Master",
      person: "People",
      o3doc: "O3Doc",
      meeting: "Meetings",
      daily: "Daily",
      perf: "Perf",
    };

    const kindCounts: Record<string, number> = {};
    for (const src of this.lastSources) {
      kindCounts[src.kind] = (kindCounts[src.kind] || 0) + 1;
    }

    for (const [kind, label] of Object.entries(kindLabels)) {
      const count = kindCounts[kind] || 0;
      const enabled = this.includeSources[kind] ?? true;
      const warning = this.lastWarnings.find(w => w.toLowerCase().includes(kind.toLowerCase()));

      const badge = statusRow.createSpan({ cls: "gsd-o3-source-badge" });

      let icon = "✓";
      let cls = "gsd-o3-source-ok";

      if (!enabled) {
        icon = "○";
        cls = "gsd-o3-source-disabled";
      } else if (warning) {
        icon = "⚠";
        cls = "gsd-o3-source-warning";
        badge.title = warning;
      } else if (count === 0) {
        icon = "✗";
        cls = "gsd-o3-source-error";
      } else {
        badge.title = `${count} item(s) loaded`;
      }

      badge.addClass(cls);
      badge.textContent = `${icon}${label}`;
    }
  }

  private renderSuggestionsPanel(container: HTMLElement, person: O3Person, event: CalendarEvent | null): void {
    const panel = container.createDiv({ cls: "gsd-o3-suggestions-panel" });

    const header = panel.createDiv({ cls: "gsd-o3-panel-header" });
    const acceptedCount = this.suggestions.filter(s => s.accepted).length;
    header.createSpan({ text: `Suggestions (${acceptedCount}/${this.suggestions.length} selected)` });

    // Add manual suggestion button
    const addBtn = header.createEl("button", { cls: "gsd-o3-add-suggestion-btn" });
    addBtn.textContent = "+ Add";
    addBtn.onclick = (evt) => {
      evt.stopPropagation();
      this.addManualSuggestion();
    };

    // Suggestion cards
    const list = panel.createDiv({ cls: "gsd-o3-suggestions-list" });

    for (const suggestion of this.suggestions) {
      this.renderSuggestionCard(list, suggestion, person, event);
    }

    // Batch actions
    if (this.suggestions.length > 0) {
      const batchActions = panel.createDiv({ cls: "gsd-o3-batch-actions" });

      const selectAllBtn = batchActions.createEl("button");
      selectAllBtn.textContent = "Select All";
      selectAllBtn.onclick = (evt) => {
        evt.stopPropagation();
        this.suggestions.forEach(s => s.accepted = true);
        this.render();
      };

      const clearBtn = batchActions.createEl("button");
      clearBtn.textContent = "Clear All";
      clearBtn.onclick = (evt) => {
        evt.stopPropagation();
        this.suggestions.forEach(s => s.accepted = false);
        this.render();
      };
    }
  }

  private renderSuggestionCard(
    container: HTMLElement,
    suggestion: EditableSuggestion,
    person: O3Person,
    event: CalendarEvent | null
  ): void {
    const card = container.createDiv({
      cls: `gsd-o3-suggestion-card ${suggestion.accepted ? "gsd-o3-suggestion-accepted" : ""}`
    });

    // Header row with checkbox and section dropdown
    const headerRow = card.createDiv({ cls: "gsd-o3-suggestion-header" });

    // Accept checkbox
    const checkbox = headerRow.createEl("input", { type: "checkbox" }) as HTMLInputElement;
    checkbox.checked = suggestion.accepted;
    checkbox.onclick = (evt) => evt.stopPropagation();
    checkbox.onchange = () => {
      suggestion.accepted = checkbox.checked;
      this.render();
    };

    // Section dropdown
    const dropdown = new DropdownComponent(headerRow);
    for (const section of O3_SECTIONS) {
      dropdown.addOption(section, section);
    }
    dropdown.setValue(suggestion.section);
    dropdown.onChange((value) => {
      suggestion.section = value;
    });
    dropdown.selectEl.onclick = (evt) => evt.stopPropagation();

    // Delete button
    const deleteBtn = headerRow.createEl("button", { cls: "gsd-o3-delete-btn" });
    deleteBtn.textContent = "✕";
    deleteBtn.onclick = (evt) => {
      evt.stopPropagation();
      this.suggestions = this.suggestions.filter(s => s.id !== suggestion.id);
      this.render();
    };

    // Editable text area
    const textArea = new TextAreaComponent(card);
    textArea.setValue(suggestion.text);
    textArea.setPlaceholder("Edit suggestion...");
    textArea.onChange((value) => {
      suggestion.text = value;
    });
    textArea.inputEl.addClass("gsd-o3-suggestion-textarea");
    textArea.inputEl.onclick = (evt) => evt.stopPropagation();

    // Source refs (if any)
    if (suggestion.sourceIds && suggestion.sourceIds.length > 0) {
      const sources = card.createDiv({ cls: "gsd-o3-suggestion-sources" });
      sources.textContent = `Sources: ${suggestion.sourceIds.join(", ")}`;
    }
  }

  private addManualSuggestion(): void {
    this.suggestions.push({
      id: `manual-${++this.suggestionIdCounter}`,
      text: "",
      section: O3_SECTIONS[0],
      accepted: true,
    });
    this.render();
  }

  private renderCoachSection(container: HTMLElement, person: O3Person, event: CalendarEvent | null): void {
    const section = container.createDiv({ cls: "gsd-o3-coach-section" });

    const header = section.createDiv({ cls: "gsd-o3-panel-header" });
    header.createSpan({ text: "Ask Coach" });

    // Chat messages
    if (this.coachMessages.length > 0) {
      const messagesEl = section.createDiv({ cls: "gsd-o3-coach-messages" });
      for (const msg of this.coachMessages) {
        const msgEl = messagesEl.createDiv({
          cls: `gsd-o3-coach-msg gsd-o3-coach-${msg.role}`
        });
        const label = msg.role === "user" ? "You" : "Coach";
        msgEl.createDiv({ text: label, cls: "gsd-o3-coach-msg-label" });
        msgEl.createDiv({ text: msg.content, cls: "gsd-o3-coach-msg-content" });
      }
    }

    // Input row
    const inputRow = section.createDiv({ cls: "gsd-o3-coach-input-row" });

    const input = inputRow.createEl("input", {
      type: "text",
      placeholder: "Ask a follow-up question...",
      cls: "gsd-o3-coach-input",
    });

    // Quick prompts
    const quickBtn = inputRow.createEl("button", { cls: "gsd-o3-quick-btn" });
    quickBtn.textContent = "⚡";
    quickBtn.title = "Quick prompts";
    quickBtn.onclick = (evt) => {
      evt.stopPropagation();
      const menu = new Menu();
      const prompts = [
        "What am I missing?",
        "Find lost action items",
        "Push on accountability gaps",
        "Suggest info requests",
      ];
      for (const prompt of prompts) {
        menu.addItem((item) => {
          item.setTitle(prompt);
          item.onClick(() => this.sendCoachPrompt(prompt, person, event));
        });
      }
      menu.showAtMouseEvent(evt as MouseEvent);
    };

    // Handle enter key
    input.addEventListener("keydown", async (evt) => {
      if (evt.key === "Enter" && !evt.shiftKey) {
        evt.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        input.value = "";
        await this.sendCoachPrompt(text, person, event);
      }
    });

    if (this.isCoachThinking) {
      const loading = section.createDiv({ cls: "gsd-o3-coach-loading" });
      loading.textContent = "Thinking...";
    }
  }

  private renderBottomActions(container: HTMLElement, person: O3Person, event: CalendarEvent | null): void {
    const actions = container.createDiv({ cls: "gsd-o3-actions" });

    // Add to Prep (batch add accepted suggestions)
    const acceptedSuggestions = this.suggestions.filter(s => s.accepted && s.text.trim());
    const addToPrepBtn = actions.createEl("button", { cls: "gsd-o3-add-to-prep-btn" });
    addToPrepBtn.textContent = `Add ${acceptedSuggestions.length} to Prep`;
    addToPrepBtn.disabled = acceptedSuggestions.length === 0;
    addToPrepBtn.onclick = async (evt) => {
      evt.stopPropagation();
      await this.addAcceptedToPrep(person, event);
    };

    // Overflow menu
    const overflowBtn = actions.createEl("button", { cls: "gsd-o3-overflow-btn" });
    overflowBtn.textContent = "⋯";
    overflowBtn.onclick = (evt) => {
      evt.stopPropagation();
      const menu = new Menu();

      menu.addItem((item) => {
        item.setTitle("Copy All to Clipboard");
        item.onClick(async () => {
          const text = acceptedSuggestions.map(s => `- ${s.text}`).join("\n");
          if (!text) {
            new Notice("No suggestions selected");
            return;
          }
          await navigator.clipboard.writeText(text);
          new Notice("Copied to clipboard");
        });
      });

      menu.addSeparator();

      menu.addItem((item) => {
        item.setTitle("Open People Note");
        item.onClick(() => {
          const path = this.stripMd(person.filePath);
          this.plugin.app.workspace.openLinkText(path, "", false);
        });
      });

      menu.showAtMouseEvent(evt as MouseEvent);
    };
  }

  private async gatherContext(person: O3Person, event: CalendarEvent | null): Promise<void> {
    this.isGathering = true;
    await this.render();

    try {
      // Use the coach with a context-gathering prompt
      const result = await this.o3Coach.runCoach({
        mode: "person",
        question: "Analyze all context and generate specific, actionable suggestions for this O3. Include follow-ups to discuss, updates I need to prepare, discussion topics, and feedback to give. Be specific and cite sources.",
        person,
        event,
        history: [],
        includeSources: this.includeSources,
      });

      if (result) {
        // Store source info
        this.lastSources = result.sources || [];
        this.lastWarnings = result.warnings || [];

        // Convert suggestions to editable format
        if (result.suggestions && result.suggestions.length > 0) {
          for (const s of result.suggestions) {
            this.suggestions.push({
              id: `gathered-${++this.suggestionIdCounter}`,
              text: this.cleanText(s.text),
              section: this.mapTypeToSection(s.type),
              sourceIds: s.sourceIds,
              accepted: true, // Default to accepted
            });
          }
        }

        // Also add summary as context
        if (result.summary) {
          this.coachMessages.push({ role: "assistant", content: result.summary });
        }
      }
    } catch (err) {
      new Notice("Failed to gather context: " + String(err));
    } finally {
      this.isGathering = false;
      await this.render();
    }
  }

  private async sendCoachPrompt(text: string, person: O3Person, event: CalendarEvent | null): Promise<void> {
    this.coachMessages.push({ role: "user", content: text });
    this.isCoachThinking = true;
    await this.render();

    try {
      const result = await this.o3Coach.runCoach({
        mode: "person",
        question: text,
        person,
        event,
        history: this.coachMessages,
        includeSources: this.includeSources,
      });

      if (!result) {
        this.coachMessages.push({ role: "assistant", content: "No response (missing context?)" });
      } else {
        this.coachMessages.push({ role: "assistant", content: result.summary || "Done." });

        // Add new suggestions from coach
        if (result.suggestions && result.suggestions.length > 0) {
          for (const s of result.suggestions) {
            this.suggestions.push({
              id: `coach-${++this.suggestionIdCounter}`,
              text: this.cleanText(s.text),
              section: this.mapTypeToSection(s.type),
              sourceIds: s.sourceIds,
              accepted: true,
            });
          }
        }

        // Update source info
        if (result.sources) this.lastSources = result.sources;
        if (result.warnings) this.lastWarnings = result.warnings;
      }
    } catch (err) {
      this.coachMessages.push({ role: "assistant", content: "Error: " + String(err) });
    } finally {
      this.isCoachThinking = false;
      await this.render();
    }
  }

  private async addAcceptedToPrep(person: O3Person, event: CalendarEvent | null): Promise<void> {
    const accepted = this.suggestions.filter(s => s.accepted && s.text.trim());
    if (accepted.length === 0) {
      new Notice("No suggestions selected");
      return;
    }

    let addedCount = 0;
    for (const suggestion of accepted) {
      try {
        await this.o3Prep.addToMasterPrepSection(
          person,
          event,
          suggestion.section,
          suggestion.text.trim()
        );
        addedCount++;
      } catch (err) {
        console.error("[GSD] Failed to add suggestion:", err);
      }
    }

    // Remove added suggestions from list
    this.suggestions = this.suggestions.filter(s => !s.accepted || !s.text.trim());

    new Notice(`Added ${addedCount} item(s) to Master O3 Prep`);
    await this.render();
  }

  private mapTypeToSection(type: string): string {
    switch (type) {
      case "followup":
      case "info_request":
        return "Follow-ups to Discuss";
      case "update":
        return "Updates You Need to Prepare";
      case "blind_spot":
      case "question":
        return "Discussion Topics";
      default:
        return "Discussion Topics";
    }
  }

  private cleanText(text: string): string {
    // Fix literal \n sequences and clean up formatting
    return text
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .trim();
  }

  private showSourceSettings(evt: MouseEvent): void {
    const menu = new Menu();

    const sourceLabels: Record<string, string> = {
      master: "Master O3 Prep",
      person: "People Note",
      o3doc: "O3 Doc (Google)",
      meeting: "Meeting Notes",
      daily: "Daily Notes",
      perf: "Perf Reviews",
    };

    for (const [key, label] of Object.entries(sourceLabels)) {
      menu.addItem((item) => {
        const enabled = this.includeSources[key] ?? true;
        item.setTitle(`${enabled ? "✓" : "○"} ${label}`);
        item.onClick(() => {
          this.includeSources[key] = !enabled;
          this.showSourceSettings(evt);
        });
      });
    }

    menu.showAtMouseEvent(evt);
  }

  private stripMd(path: string): string {
    return path.endsWith(".md") ? path.slice(0, -3) : path;
  }
}
