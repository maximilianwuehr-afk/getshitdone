import { App, Modal, Notice } from "obsidian";
import type { CalendarEvent } from "../types";
import type { O3Person } from "../actions/o3-prep";
import { O3PrepAction } from "../actions/o3-prep";
import { O3CoachAction, O3CoachMode, O3CoachSuggestion } from "../actions/o3-coach";

type CoachMessage = { role: "user" | "assistant"; content: string };

export class O3CoachModal extends Modal {
  private mode: O3CoachMode;
  private person?: O3Person | null;
  private event?: CalendarEvent | null;
  private o3Coach: O3CoachAction;
  private o3Prep: O3PrepAction;
  private messages: CoachMessage[] = [];
  private includeSources: {
    master: boolean;
    person: boolean;
    meeting: boolean;
    daily: boolean;
    perf: boolean;
    o3doc: boolean;
  } = {
    master: true,
    person: true,
    meeting: true,
    daily: true,
    perf: true,
    o3doc: true,
  };

  constructor(
    app: App,
    o3Coach: O3CoachAction,
    o3Prep: O3PrepAction,
    mode: O3CoachMode,
    person?: O3Person | null,
    event?: CalendarEvent | null
  ) {
    super(app);
    this.o3Coach = o3Coach;
    this.o3Prep = o3Prep;
    this.mode = mode;
    this.person = person || null;
    this.event = event || null;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("gsd-o3-coach");

    const title =
      this.mode === "person" && this.person
        ? `O3 Coach — ${this.person.name}`
        : "O3 Coach — Week";
    contentEl.createEl("h2", { text: title });

    const scopeRow = contentEl.createDiv({ cls: "gsd-o3-coach-scope" });
    scopeRow.style.display = "flex";
    scopeRow.style.flexWrap = "wrap";
    scopeRow.style.gap = "10px";
    scopeRow.style.marginBottom = "10px";

    this.renderScopeToggle(scopeRow, "Master O3", "master");
    if (this.mode === "person") this.renderScopeToggle(scopeRow, "People Note", "person");
    if (this.mode === "person") this.renderScopeToggle(scopeRow, "O3 Doc", "o3doc");
    this.renderScopeToggle(scopeRow, "Meetings", "meeting");
    this.renderScopeToggle(scopeRow, "Daily Notes", "daily");
    this.renderScopeToggle(scopeRow, "Perf Reviews", "perf");

    const quickRow = contentEl.createDiv({ cls: "gsd-o3-coach-quick" });
    quickRow.style.display = "flex";
    quickRow.style.flexWrap = "wrap";
    quickRow.style.gap = "8px";
    quickRow.style.marginBottom = "12px";

    const quickPrompts = [
      "What am I missing?",
      "Find lost action items",
      "Push on accountability gaps",
      "Suggest info requests",
    ];
    for (const prompt of quickPrompts) {
      const btn = quickRow.createEl("button", { text: prompt });
      btn.addEventListener("click", () => this.sendPrompt(prompt));
    }

    const messagesEl = contentEl.createDiv({ cls: "gsd-o3-coach-messages" });
    messagesEl.style.display = "flex";
    messagesEl.style.flexDirection = "column";
    messagesEl.style.gap = "12px";
    messagesEl.style.maxHeight = "55vh";
    messagesEl.style.overflowY = "auto";
    messagesEl.style.padding = "8px 0";

    const inputRow = contentEl.createDiv({ cls: "gsd-o3-coach-input" });
    inputRow.style.display = "flex";
    inputRow.style.gap = "8px";
    inputRow.style.marginTop = "12px";

    const input = inputRow.createEl("textarea");
    input.placeholder = "Ask the coach…";
    input.style.flex = "1";
    input.style.height = "60px";

    const sendBtn = inputRow.createEl("button", { text: "Send" });
    sendBtn.style.minWidth = "80px";
    sendBtn.addEventListener("click", () => {
      const text = input.value.trim();
      if (!text) return;
      input.value = "";
      this.sendPrompt(text, messagesEl);
    });

    input.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter" && (evt.metaKey || evt.ctrlKey)) {
        evt.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        input.value = "";
        this.sendPrompt(text, messagesEl);
      }
    });

  }

  private appendMessage(container: HTMLElement, role: "user" | "assistant", text: string): HTMLElement {
    const msg = container.createDiv({ cls: `gsd-o3-coach-msg gsd-o3-coach-${role}` });
    msg.style.border = "1px solid var(--background-modifier-border)";
    msg.style.borderRadius = "8px";
    msg.style.padding = "8px 10px";

    const label = role === "user" ? "You" : "Coach";
    msg.createEl("div", { text: label, cls: "gsd-o3-coach-label" }).style.fontWeight = "600";
    msg.createEl("div", { text });
    return msg;
  }

  private async sendPrompt(text: string, messagesEl?: HTMLElement): Promise<void> {
    const container = messagesEl || this.contentEl.querySelector(".gsd-o3-coach-messages");
    if (!(container instanceof HTMLElement)) return;

    this.messages.push({ role: "user", content: text });
    this.appendMessage(container, "user", text);

    const loading = this.appendMessage(container, "assistant", "Thinking…");
    const result = await this.o3Coach.runCoach({
      mode: this.mode,
      question: text,
      person: this.person || undefined,
      event: this.event || undefined,
      history: this.messages,
      includeSources: this.includeSources,
    });

    if (!result) {
      loading.remove();
      this.appendMessage(container, "assistant", "No response (missing context?).");
      return;
    }

    loading.remove();
    const summary = result.summary || "Coach response generated.";
    const msgEl = this.appendMessage(container, "assistant", summary);
    this.messages.push({ role: "assistant", content: summary });

    if (result.warnings.length > 0) {
      const warnEl = msgEl.createDiv({ cls: "gsd-o3-coach-warnings" });
      warnEl.createEl("div", { text: "Warnings:", cls: "setting-item-description" });
      for (const warn of result.warnings) {
        warnEl.createEl("div", { text: `- ${warn}` });
      }
    }

    if (result.questions.length > 0) {
      const qEl = msgEl.createDiv({ cls: "gsd-o3-coach-questions" });
      qEl.createEl("div", { text: "Questions:", cls: "setting-item-description" });
      for (const q of result.questions) {
        qEl.createEl("div", { text: `• ${q}` });
      }
    }

    if (result.suggestions.length > 0) {
      const sEl = msgEl.createDiv({ cls: "gsd-o3-coach-suggestions" });
      sEl.createEl("div", { text: "Suggestions:", cls: "setting-item-description" });
      for (const suggestion of result.suggestions) {
        this.renderSuggestion(sEl, suggestion);
      }
    }

    if (result.sources.length > 0) {
      const srcEl = msgEl.createDiv({ cls: "gsd-o3-coach-sources" });
      srcEl.createEl("div", { text: "Context used:", cls: "setting-item-description" });
      for (const src of result.sources) {
        const label = src.truncated ? `${src.id} · ${src.title} (truncated)` : `${src.id} · ${src.title}`;
        srcEl.createEl("div", { text: label });
      }
    }

    if (result.sources.length > 0) {
      const previewWrap = msgEl.createDiv({ cls: "gsd-o3-coach-context-preview" });
      previewWrap.style.marginTop = "8px";
      const previewBtn = previewWrap.createEl("button", { text: "Context Preview" });
      const previewPanel = previewWrap.createDiv();
      previewPanel.style.display = "none";
      previewPanel.style.marginTop = "8px";

      previewBtn.addEventListener("click", () => {
        const visible = previewPanel.style.display !== "none";
        previewPanel.style.display = visible ? "none" : "block";
      });

      this.renderContextPreview(previewPanel, result.sources);
    }
  }

  private renderSuggestion(container: HTMLElement, suggestion: O3CoachSuggestion): void {
    const row = container.createDiv({ cls: "gsd-o3-coach-suggestion" });
    row.style.display = "flex";
    row.style.flexDirection = "column";
    row.style.gap = "6px";
    row.style.border = "1px solid var(--background-modifier-border)";
    row.style.borderRadius = "6px";
    row.style.padding = "6px 8px";

    const header = row.createDiv();
    const label = suggestion.person ? `${suggestion.type} · ${suggestion.person}` : suggestion.type;
    header.createEl("strong", { text: label });
    row.createEl("div", { text: suggestion.text });

    if (suggestion.sourceIds && suggestion.sourceIds.length > 0) {
      row.createEl("div", {
        text: `Sources: ${suggestion.sourceIds.join(", ")}`,
        cls: "setting-item-description",
      });
    }

    const actions = row.createDiv();
    actions.style.display = "flex";
    actions.style.gap = "6px";
    actions.style.flexWrap = "wrap";

    const followBtn = actions.createEl("button", { text: "Add to Follow-ups" });
    followBtn.addEventListener("click", async () => {
      const target = await this.resolveTargetPerson(suggestion);
      if (!target) {
        new Notice("No person resolved for this suggestion.");
        return;
      }
      await this.o3Prep.addFollowUp(target.filePath, suggestion.text);
      new Notice("Added to Follow-ups");
    });

    const updateBtn = actions.createEl("button", { text: "Add to Updates" });
    updateBtn.addEventListener("click", async () => {
      const target = await this.resolveTargetPerson(suggestion);
      if (!target) {
        new Notice("No person resolved for this suggestion.");
        return;
      }
      await this.o3Prep.addUpdate(target.filePath, suggestion.text);
      new Notice("Added to Updates");
    });

    const masterBtn = actions.createEl("button", { text: "Add to Master O3" });
    masterBtn.addEventListener("click", async () => {
      const target = await this.resolveTargetPerson(suggestion);
      if (target) {
        const section = this.mapSuggestionToSection(suggestion.type);
        await this.o3Prep.addToMasterPrepSection(target, this.event || null, section, suggestion.text);
      } else {
        await this.o3Prep.addToMasterWeekSection(suggestion.text);
      }
      new Notice("Added to Master O3");
    });

    const docBtn = actions.createEl("button", { text: "Add to O3 Doc" });
    docBtn.addEventListener("click", async () => {
      const target = await this.resolveTargetPerson(suggestion);
      if (!target) {
        new Notice("No person resolved for this suggestion.");
        return;
      }
      const ok = await this.o3Prep.appendToO3Doc(target, suggestion.text, this.event || null);
      if (ok) new Notice("Added to O3 Doc");
    });

    const dismissBtn = actions.createEl("button", { text: "Dismiss" });
    dismissBtn.addEventListener("click", () => row.remove());
  }

  private renderScopeToggle(
    container: HTMLElement,
    label: string,
    key: keyof O3CoachModal["includeSources"]
  ): void {
    const wrap = container.createEl("label");
    wrap.style.display = "flex";
    wrap.style.alignItems = "center";
    wrap.style.gap = "6px";
    const input = wrap.createEl("input", { type: "checkbox" }) as HTMLInputElement;
    input.checked = this.includeSources[key];
    input.addEventListener("change", () => {
      this.includeSources[key] = input.checked;
    });
    wrap.createSpan({ text: label });
  }

  private renderContextPreview(
    container: HTMLElement,
    sources: Array<{ id: string; title: string; content?: string }>
  ): void {
    container.empty();
    container.createEl("h3", { text: "Context Preview" });
    if (sources.length === 0) {
      container.createEl("div", { text: "No context available." });
      return;
    }

    for (const src of sources) {
      const block = container.createDiv();
      block.style.marginBottom = "12px";
      block.createEl("div", { text: `${src.id} · ${src.title}` }).style.fontWeight = "600";
      const pre = block.createEl("pre");
      pre.style.whiteSpace = "pre-wrap";
      pre.style.maxHeight = "240px";
      pre.style.overflowY = "auto";
      pre.textContent = src.content || "";
    }
  }

  private async resolveTargetPerson(suggestion: O3CoachSuggestion): Promise<O3Person | null> {
    if (this.person) return this.person;
    if (suggestion.person) {
      return await this.o3Coach.resolvePersonByName(suggestion.person);
    }
    return null;
  }

  private mapSuggestionToSection(type: O3CoachSuggestion["type"]): string {
    if (type === "update") return "Updates You Need to Prepare";
    if (type === "info_request") return "Follow-ups to Discuss";
    if (type === "blind_spot") return "Discussion Topics";
    if (type === "question") return "Discussion Topics";
    return "Follow-ups to Discuss";
  }
}
