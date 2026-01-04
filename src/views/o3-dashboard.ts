import { ItemView, WorkspaceLeaf, Notice } from "obsidian";
import type GetShitDonePlugin from "../main";
import { O3PrepAction, O3MeetingItem, O3Person, O3DashboardData } from "../actions/o3-prep";
import { O3CoachAction } from "../actions/o3-coach";
import { O3CoachModal } from "./o3-coach-modal";
import type { CalendarEvent } from "../types";

export const O3_DASHBOARD_VIEW = "gsd-o3-dashboard";

export class O3DashboardView extends ItemView {
  private plugin: GetShitDonePlugin;
  private o3Prep: O3PrepAction;
  private o3Coach: O3CoachAction;
  private data: O3DashboardData | null = null;

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
    const header = contentEl.createDiv({ cls: "gsd-o3-header" });
    header.createEl("h3", { text: `Week of ${this.data.weekStart} – ${this.data.weekEnd}` });

    const headerActions = header.createDiv({ cls: "gsd-o3-header-actions" });
    const refreshBtn = headerActions.createEl("button", { text: "Refresh" });
    refreshBtn.onclick = async () => {
      await this.render();
    };

    const coachBtn = headerActions.createEl("button", { text: "Week Coach" });
    coachBtn.onclick = () => {
      new O3CoachModal(this.app, this.o3Coach, this.o3Prep, "week").open();
    };

    const masterBtn = headerActions.createEl("button", { text: "Open Master Note" });
    masterBtn.onclick = () => {
      const path = this.stripMd(this.plugin.settings.o3.masterNotePath);
      this.plugin.app.workspace.openLinkText(path, "", false);
    };

    contentEl.createEl("h4", { text: "This Week's O3s" });
    if (this.data.meetings.length === 0) {
      contentEl.createEl("p", { text: "No O3s scheduled this week." });
    } else {
      for (const item of this.data.meetings) {
        this.renderMeetingCard(contentEl, item);
      }
    }

    contentEl.createEl("h4", { text: "O3 List (No meeting this week)" });
    if (this.data.o3WithoutMeeting.length === 0) {
      contentEl.createEl("p", { text: "Everyone has a meeting this week." });
    } else {
      for (const person of this.data.o3WithoutMeeting) {
        this.renderPersonCard(contentEl, person, null);
      }
    }
  }

  private renderMeetingCard(container: HTMLElement, item: O3MeetingItem): void {
    const card = container.createDiv({ cls: "gsd-o3-card" });
    const header = card.createDiv({ cls: "gsd-o3-card-header" });
    const title = header.createEl("strong", { text: item.person.name });
    title.addClass("gsd-o3-person-name");

    header.createSpan({ text: item.meetingTime, cls: "gsd-o3-meeting-time" });

    if (item.lastMeetingDate) {
      header.createSpan({ text: `Last: ${item.lastMeetingDate}`, cls: "gsd-o3-meeting-meta" });
    }

    this.renderActions(card, item.person, item.event);
    this.renderSections(card, item.person);
  }

  private renderPersonCard(container: HTMLElement, person: O3Person, event: CalendarEvent | null): void {
    const card = container.createDiv({ cls: "gsd-o3-card" });
    const header = card.createDiv({ cls: "gsd-o3-card-header" });
    header.createEl("strong", { text: person.name });
    header.createSpan({ text: "No meeting this week", cls: "gsd-o3-meeting-meta" });
    if (person.lastMeetingDate) {
      header.createSpan({ text: `Last: ${person.lastMeetingDate}`, cls: "gsd-o3-meeting-meta" });
    }
    this.renderActions(card, person, event);
    this.renderSections(card, person);
  }

  private renderActions(container: HTMLElement, person: O3Person, event: CalendarEvent | null): void {
    const actions = container.createDiv({ cls: "gsd-o3-actions" });

    const prepareBtn = actions.createEl("button", { text: "Prepare" });
    prepareBtn.onclick = async () => {
      const content = await this.o3Prep.prepareO3ForPerson(person, event);
      if (!content) {
        new Notice("Failed to generate O3 prep");
        return;
      }
      await this.o3Prep.upsertMasterPrep(person, event, content);
      new Notice("O3 prep updated");
    };

    const copyBtn = actions.createEl("button", { text: "Copy O3" });
    copyBtn.onclick = async () => {
      const content = await this.o3Prep.getPreparedContent(person, event);
      if (!content) {
        new Notice("No prep content available");
        return;
      }
      await navigator.clipboard.writeText(content);
      new Notice("O3 prep copied");
    };

    const docBtn = actions.createEl("button", { text: "Add to O3 Doc" });
    docBtn.onclick = async () => {
      const ok = await this.o3Prep.addToO3Doc(person, event);
      if (ok) new Notice("Added to O3 doc");
    };

    const coachBtn = actions.createEl("button", { text: "Coach" });
    coachBtn.onclick = () => {
      new O3CoachModal(this.app, this.o3Coach, this.o3Prep, "person", person, event).open();
    };

    const slackBtn = actions.createEl("button", { text: "Draft Slack (Soon)" });
    slackBtn.disabled = true;
  }

  private renderSections(container: HTMLElement, person: O3Person): void {
    this.renderTaskSection(container, person, "Follow-ups", person.sections.followUps, async (text) => {
      await this.o3Prep.addFollowUp(person.filePath, text);
      await this.render();
    }, async (text) => {
      await this.o3Prep.removeFollowUp(person.filePath, text);
      await this.render();
    });

    this.renderTaskSection(container, person, "Updates I Owe", person.sections.updates, async (text) => {
      await this.o3Prep.addUpdate(person.filePath, text);
      await this.render();
    }, async (text) => {
      await this.o3Prep.removeUpdate(person.filePath, text);
      await this.render();
    });
  }

  private renderTaskSection(
    container: HTMLElement,
    person: O3Person,
    title: string,
    items: string[],
    onAdd: (text: string) => Promise<void>,
    onRemove: (text: string) => Promise<void>
  ): void {
    const section = container.createDiv({ cls: "gsd-o3-section" });
    section.createEl("div", { text: title, cls: "gsd-o3-section-title" });

    if (items.length === 0) {
      section.createEl("div", { text: "No items yet", cls: "gsd-o3-empty" });
    } else {
      for (const item of items) {
        const row = section.createDiv({ cls: "gsd-o3-item" });
        row.createSpan({ text: item });
        const remove = row.createEl("button", { text: "×" });
        remove.onclick = async () => {
          await onRemove(item);
        };
      }
    }

    const inputRow = section.createDiv({ cls: "gsd-o3-input" });
    const input = inputRow.createEl("input", {
      type: "text",
      placeholder: `Add ${title.toLowerCase()}`,
    });
    const addBtn = inputRow.createEl("button", { text: "Add" });
    addBtn.onclick = async () => {
      const value = input.value.trim();
      if (!value) return;
      input.value = "";
      await onAdd(value);
    };

    const openPerson = section.createEl("button", { text: "Open People note" });
    openPerson.onclick = () => {
      const path = this.stripMd(person.filePath);
      this.plugin.app.workspace.openLinkText(path, "", false);
    };
  }

  private stripMd(path: string): string {
    return path.endsWith(".md") ? path.slice(0, -3) : path;
  }
}
