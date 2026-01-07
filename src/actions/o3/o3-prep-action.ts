// ============================================================================
// O3 Prep Action - Main entry point for O3 preparation
// ============================================================================

import { App, Notice, TFile } from "obsidian";
import type { PluginSettings, CalendarEvent } from "../../types";
import { CalendarService } from "../../services/calendar";
import { VaultSearchService } from "../../services/vault-search";
import { IndexService } from "../../services/index-service";
import { GoogleServices } from "../../services/google-services";
import { AIService } from "../../services/ai-service";

import type { O3Person, O3MeetingItem, O3DashboardData } from "./types";
import { WEEK_MARKER_PREFIX } from "./types";
import {
  buildO3Context,
  ensureSection,
  injectTasks,
  getWeekKey,
  buildPersonHeading,
  getPersonKey,
} from "./context-builder";
import {
  ensureMasterNote,
  upsertPersonSection,
  extractPersonSection,
  extractWeekSection,
  replaceWeekSection,
  addTaskToO3Section,
  removeTaskFromO3Section,
  appendToSection,
} from "./master-note";
import {
  getO3People,
  loadPerson,
  resolvePersonFromAttendee,
  getLastMeetingDate,
  ensureO3MeetingId,
  filterAttendees,
} from "./person-loader";

const moment = (window as any).moment;

// ============================================================================
// O3 Prep Action Class
// ============================================================================

export class O3PrepAction {
  private app: App;
  private settings: PluginSettings;
  private calendarService: CalendarService;
  private vaultSearch: VaultSearchService;
  private indexService: IndexService;
  private googleServices: GoogleServices;
  private aiService: AIService;

  constructor(
    app: App,
    settings: PluginSettings,
    calendarService: CalendarService,
    vaultSearch: VaultSearchService,
    indexService: IndexService,
    googleServices: GoogleServices,
    aiService: AIService
  ) {
    this.app = app;
    this.settings = settings;
    this.calendarService = calendarService;
    this.vaultSearch = vaultSearch;
    this.indexService = indexService;
    this.googleServices = googleServices;
    this.aiService = aiService;
  }

  updateSettings(settings: PluginSettings): void {
    this.settings = settings;
  }

  // ============================================================================
  // Dashboard Data
  // ============================================================================

  async getDashboardData(): Promise<O3DashboardData> {
    const weekStart = moment().startOf("isoWeek");
    const weekEnd = moment().endOf("isoWeek");

    const events = await this.calendarService.getEvents(weekStart, weekEnd);
    const o3Events = events.filter((e) => this.isO3Meeting(e));

    const o3People = await getO3People(this.app, this.settings, this.indexService, this.vaultSearch);
    const meetingIdMap = new Map<string, O3Person>();
    for (const person of o3People) {
      if (person.o3MeetingId) {
        meetingIdMap.set(person.o3MeetingId, person);
      }
    }

    const meetings: O3MeetingItem[] = [];
    const matchedPeople = new Set<string>();

    for (const event of o3Events) {
      const eventId = event.recurringEventId || event.id;
      let person: O3Person | null = meetingIdMap.get(eventId) || null;

      if (!person) {
        const attendees = filterAttendees(event.attendees || [], this.settings);
        for (const attendee of attendees) {
          person = await resolvePersonFromAttendee(
            this.app,
            this.settings,
            this.vaultSearch,
            this.indexService,
            attendee,
            o3People
          );
          if (person) break;
        }
      }

      if (!person) continue;

      // Skip if this person already has a meeting (show only first O3 per person)
      if (matchedPeople.has(person.filePath)) continue;

      const meetingTime = event.start?.dateTime
        ? moment(event.start.dateTime).format("ddd, HH:mm")
        : "Time TBD";

      const lastMeetingDate = await getLastMeetingDate(this.app, this.indexService, person);

      meetings.push({
        person,
        event,
        meetingTime,
        lastMeetingDate,
      });

      matchedPeople.add(person.filePath);

      if (!person.o3MeetingId && eventId) {
        await ensureO3MeetingId(this.app, this.vaultSearch, person.filePath, eventId);
        person.o3MeetingId = eventId;
      }
    }

    const o3WithoutMeeting = await Promise.all(
      o3People
        .filter((p) => !matchedPeople.has(p.filePath))
        .map(async (p) => ({
          ...p,
          lastMeetingDate: await getLastMeetingDate(this.app, this.indexService, p),
        }))
    );

    meetings.sort((a, b) => {
      const aTime = a.event.start?.dateTime ? new Date(a.event.start.dateTime).getTime() : 0;
      const bTime = b.event.start?.dateTime ? new Date(b.event.start.dateTime).getTime() : 0;
      return aTime - bTime;
    });

    return {
      weekStart: weekStart.format("YYYY-MM-DD"),
      weekEnd: weekEnd.format("YYYY-MM-DD"),
      meetings,
      o3WithoutMeeting,
    };
  }

  // ============================================================================
  // O3 Prep Generation
  // ============================================================================

  async prepareO3ForPerson(person: O3Person, event?: CalendarEvent | null): Promise<string | null> {
    const context = await buildO3Context(
      this.app,
      this.settings,
      this.indexService,
      this.googleServices,
      person,
      event || null
    );
    if (!context) return null;

    const cfg = this.settings.generationConfigs?.o3Prep;
    const response = await this.aiService.callModel(
      "You are a Chief of Staff preparing a CEO for 1:1 O3 meetings. Be specific and evidence-based. Never invent. Use bullet points and explicit questions. Omit empty sections.",
      context,
      this.settings.models.o3PrepModel,
      {
        useSearch: false,
        temperature: cfg?.temperature,
        thinkingBudget: cfg?.thinkingBudget ?? undefined,
      }
    );

    if (!response) return null;

    let output = response.trim();
    output = ensureSection("Follow-ups to Discuss", output);
    output = ensureSection("Updates You Need to Prepare", output);
    output = ensureSection("Discussion Topics", output);
    output = ensureSection("Feedback to Give", output);

    output = injectTasks("Follow-ups to Discuss", person.sections.followUps, output);
    output = injectTasks("Updates You Need to Prepare", person.sections.updates, output);

    return output.trim();
  }

  async upsertMasterPrep(person: O3Person, event: CalendarEvent | null, content: string): Promise<void> {
    const weekKey = getWeekKey(event?.start?.dateTime);
    const file = await ensureMasterNote(this.app, this.settings);
    if (!file) return;

    const personKey = getPersonKey(person);
    const heading = buildPersonHeading(person, event);
    const updated = upsertPersonSection(
      await this.app.vault.read(file),
      weekKey,
      personKey,
      heading,
      content
    );

    await this.app.vault.modify(file, updated);
  }

  async getPreparedContent(person: O3Person, event?: CalendarEvent | null): Promise<string | null> {
    const weekKey = getWeekKey(event?.start?.dateTime);
    const file = await ensureMasterNote(this.app, this.settings);
    if (!file) return null;

    const content = await this.app.vault.read(file);
    const personKey = getPersonKey(person);
    const extracted = extractPersonSection(content, weekKey, personKey);
    if (extracted) return extracted;

    const generated = await this.prepareO3ForPerson(person, event || null);
    if (!generated) return null;
    await this.upsertMasterPrep(person, event || null, generated);
    return generated;
  }

  // ============================================================================
  // Task Management
  // ============================================================================

  async addFollowUp(personPath: string, text: string): Promise<void> {
    await addTaskToO3Section(this.app, personPath, "Follow-ups", text);
  }

  async removeFollowUp(personPath: string, text: string): Promise<void> {
    await removeTaskFromO3Section(this.app, personPath, "Follow-ups", text);
  }

  async addUpdate(personPath: string, text: string): Promise<void> {
    await addTaskToO3Section(this.app, personPath, "Updates I Owe", text);
  }

  async removeUpdate(personPath: string, text: string): Promise<void> {
    await removeTaskFromO3Section(this.app, personPath, "Updates I Owe", text);
  }

  // ============================================================================
  // Google Doc Integration
  // ============================================================================

  async addToO3Doc(person: O3Person, event?: CalendarEvent | null): Promise<boolean> {
    const docInput = person.o3Doc;
    if (!docInput) {
      new Notice(`No o3_doc set for ${person.name}`);
      return false;
    }

    const fileId = this.googleServices.extractDriveFileId(docInput);
    if (!fileId) {
      new Notice(`Invalid o3_doc for ${person.name}`);
      return false;
    }

    const content = await this.getPreparedContent(person, event || null);
    if (!content) {
      new Notice(`No prep content for ${person.name}`);
      return false;
    }

    const weekKey = getWeekKey(event?.start?.dateTime);
    const heading = `# O3 Prep - Week of ${weekKey}\n\n## ${person.name}\n`;
    const payload = `${heading}${content}\n\n---\n`;
    const ok = await this.googleServices.modifyDocText(fileId, payload, "prepend");

    if (!ok) {
      new Notice("Failed to update Google Doc (check Apps Script)");
    }
    return ok;
  }

  async appendToO3Doc(person: O3Person, text: string, event?: CalendarEvent | null): Promise<boolean> {
    const docInput = person.o3Doc;
    if (!docInput) {
      new Notice(`No o3_doc set for ${person.name}`);
      return false;
    }

    const fileId = this.googleServices.extractDriveFileId(docInput);
    if (!fileId) {
      new Notice(`Invalid o3_doc for ${person.name}`);
      return false;
    }

    const weekKey = getWeekKey(event?.start?.dateTime);
    const payload = `\n## ${person.name} (Week of ${weekKey})\n- ${text.trim()}\n`;
    const ok = await this.googleServices.modifyDocText(fileId, payload, "append");

    if (!ok) {
      new Notice("Failed to update Google Doc (check Apps Script)");
    }
    return ok;
  }

  // ============================================================================
  // Master Note Section Management
  // ============================================================================

  async addToMasterPrepSection(
    person: O3Person,
    event: CalendarEvent | null,
    sectionTitle: string,
    text: string
  ): Promise<void> {
    const weekKey = getWeekKey(event?.start?.dateTime);
    const file = await ensureMasterNote(this.app, this.settings);
    if (!file) return;

    const content = await this.app.vault.read(file);
    const personKey = getPersonKey(person);
    const heading = buildPersonHeading(person, event);
    let personSection = extractPersonSection(content, weekKey, personKey) || "";
    personSection = appendToSection(personSection, sectionTitle, text);

    const updated = upsertPersonSection(
      content,
      weekKey,
      personKey,
      heading,
      personSection
    );

    await this.app.vault.modify(file, updated);
  }

  async addToMasterWeekSection(text: string, weekKey?: string): Promise<void> {
    const targetWeek = weekKey || getWeekKey();
    const file = await ensureMasterNote(this.app, this.settings);
    if (!file) return;

    const content = await this.app.vault.read(file);
    const weekMarker = `${WEEK_MARKER_PREFIX}${targetWeek} -->`;
    let updated = content;
    if (!updated.includes(weekMarker)) {
      const lines = updated.split("\n");
      const insertIdx = lines[0]?.startsWith("# ") ? 1 : 0;
      lines.splice(insertIdx + 1, 0, "", `## Week of ${targetWeek}\n${weekMarker}`, "");
      updated = lines.join("\n");
    }

    const weekSection = extractWeekSection(updated, targetWeek);
    if (!weekSection) return;

    const lines = weekSection.lines;
    const sectionTitle = "### Week Coach";
    let sectionIdx = lines.findIndex((l) => l.trim() === sectionTitle);
    if (sectionIdx === -1) {
      lines.push("", sectionTitle, `- ${text.trim()}`);
    } else {
      lines.splice(sectionIdx + 1, 0, `- ${text.trim()}`);
    }

    const merged = replaceWeekSection(
      updated,
      weekSection.startIdx,
      weekSection.endIdx,
      lines.join("\n")
    );
    await this.app.vault.modify(file, merged);
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  private isO3Meeting(event: CalendarEvent): boolean {
    const title = (event.summary || "").trim();
    if (!title) return false;
    const pattern = this.settings.o3?.meetingTitleRegex || "\\bO3\\b|\\b1:1\\b|\\b1-1\\b|one-on-one";
    try {
      return new RegExp(pattern, "i").test(title);
    } catch {
      return /\b(o3|1:1|1-1|one-on-one)\b/i.test(title);
    }
  }
}
