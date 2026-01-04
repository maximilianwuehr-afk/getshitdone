import { App, Notice, TFile, TFolder } from "obsidian";
import type { PluginSettings, CalendarEvent, Attendee } from "../types";
import { CalendarService } from "../services/calendar";
import { VaultSearchService } from "../services/vault-search";
import { IndexService } from "../services/index-service";
import { GoogleServices } from "../services/google-services";
import { AIService } from "../services/ai-service";
import { handleError } from "../utils/error-handler";

const moment = (window as any).moment;

export type O3SectionData = {
  followUps: string[];
  updates: string[];
  standingTopics: string[];
};

export type O3Person = {
  name: string;
  filePath: string;
  email?: string | null;
  o3Doc?: string | null;
  o3MeetingId?: string | null;
  sections: O3SectionData;
  lastMeetingDate?: string | null;
};

export type O3MeetingItem = {
  person: O3Person;
  event: CalendarEvent;
  meetingTime: string;
  lastMeetingDate?: string | null;
};

export type O3DashboardData = {
  weekStart: string;
  weekEnd: string;
  meetings: O3MeetingItem[];
  o3WithoutMeeting: O3Person[];
};

const WEEK_MARKER_PREFIX = "<!-- GSD:O3-WEEK:";
const PERSON_MARKER_PREFIX = "<!-- GSD:O3-PERSON:";

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

  async getDashboardData(): Promise<O3DashboardData> {
    const weekStart = moment().startOf("isoWeek");
    const weekEnd = moment().endOf("isoWeek");

    const events = await this.calendarService.getEvents(weekStart, weekEnd);
    const o3Events = events.filter((e) => this.isO3Meeting(e));

    const o3People = await this.getO3People();
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
        const attendees = this.filterAttendees(event.attendees || []);
        for (const attendee of attendees) {
          person = await this.resolvePersonFromAttendee(attendee, o3People);
          if (person) break;
        }
      }

      if (!person) continue;

      const meetingTime = event.start?.dateTime
        ? moment(event.start.dateTime).format("ddd, HH:mm")
        : "Time TBD";

      const lastMeetingDate = await this.getLastMeetingDate(person);

      meetings.push({
        person,
        event,
        meetingTime,
        lastMeetingDate,
      });

      matchedPeople.add(person.filePath);

      if (!person.o3MeetingId && eventId) {
        await this.ensureO3MeetingId(person.filePath, eventId);
        person.o3MeetingId = eventId;
      }
    }

    const o3WithoutMeeting = await Promise.all(
      o3People
        .filter((p) => !matchedPeople.has(p.filePath))
        .map(async (p) => ({
          ...p,
          lastMeetingDate: await this.getLastMeetingDate(p),
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

  async prepareO3ForPerson(person: O3Person, event?: CalendarEvent | null): Promise<string | null> {
    const context = await this.buildO3Context(person, event || null);
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
    output = this.ensureSection("Follow-ups to Discuss", output);
    output = this.ensureSection("Updates You Need to Prepare", output);
    output = this.ensureSection("Discussion Topics", output);
    output = this.ensureSection("Feedback to Give", output);

    output = this.injectTasks("Follow-ups to Discuss", person.sections.followUps, output);
    output = this.injectTasks("Updates You Need to Prepare", person.sections.updates, output);

    return output.trim();
  }

  async upsertMasterPrep(person: O3Person, event: CalendarEvent | null, content: string): Promise<void> {
    const weekKey = this.getWeekKey(event?.start?.dateTime);
    const file = await this.ensureMasterNote();
    if (!file) return;

    const personKey = this.getPersonKey(person);
    const heading = this.buildPersonHeading(person, event);
    const updated = this.upsertPersonSection(
      await this.app.vault.read(file),
      weekKey,
      personKey,
      heading,
      content
    );

    await this.app.vault.modify(file, updated);
  }

  async getPreparedContent(person: O3Person, event?: CalendarEvent | null): Promise<string | null> {
    const weekKey = this.getWeekKey(event?.start?.dateTime);
    const file = await this.ensureMasterNote();
    if (!file) return null;

    const content = await this.app.vault.read(file);
    const personKey = this.getPersonKey(person);
    const extracted = this.extractPersonSection(content, weekKey, personKey);
    if (extracted) return extracted;

    const generated = await this.prepareO3ForPerson(person, event || null);
    if (!generated) return null;
    await this.upsertMasterPrep(person, event || null, generated);
    return generated;
  }

  async addFollowUp(personPath: string, text: string): Promise<void> {
    await this.addTaskToO3Section(personPath, "Follow-ups", text);
  }

  async removeFollowUp(personPath: string, text: string): Promise<void> {
    await this.removeTaskFromO3Section(personPath, "Follow-ups", text);
  }

  async addUpdate(personPath: string, text: string): Promise<void> {
    await this.addTaskToO3Section(personPath, "Updates I Owe", text);
  }

  async removeUpdate(personPath: string, text: string): Promise<void> {
    await this.removeTaskFromO3Section(personPath, "Updates I Owe", text);
  }

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

    const weekKey = this.getWeekKey(event?.start?.dateTime);
    const heading = `# O3 Prep - Week of ${weekKey}\\n\\n## ${person.name}\\n`;
    const payload = `${heading}${content}\\n\\n---\\n`;
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

    const weekKey = this.getWeekKey(event?.start?.dateTime);
    const payload = `\\n## ${person.name} (Week of ${weekKey})\\n- ${text.trim()}\\n`;
    const ok = await this.googleServices.modifyDocText(fileId, payload, "append");

    if (!ok) {
      new Notice("Failed to update Google Doc (check Apps Script)");
    }
    return ok;
  }

  async addToMasterPrepSection(
    person: O3Person,
    event: CalendarEvent | null,
    sectionTitle: string,
    text: string
  ): Promise<void> {
    const weekKey = this.getWeekKey(event?.start?.dateTime);
    const file = await this.ensureMasterNote();
    if (!file) return;

    const content = await this.app.vault.read(file);
    const personKey = this.getPersonKey(person);
    const heading = this.buildPersonHeading(person, event);
    let personSection = this.extractPersonSection(content, weekKey, personKey) || "";
    personSection = this.appendToSection(personSection, sectionTitle, text);

    const updated = this.upsertPersonSection(
      content,
      weekKey,
      personKey,
      heading,
      personSection
    );

    await this.app.vault.modify(file, updated);
  }

  async addToMasterWeekSection(text: string, weekKey?: string): Promise<void> {
    const targetWeek = weekKey || this.getWeekKey();
    const file = await this.ensureMasterNote();
    if (!file) return;

    const content = await this.app.vault.read(file);
    const weekMarker = `${WEEK_MARKER_PREFIX}${targetWeek} -->`;
    let updated = content;
    if (!updated.includes(weekMarker)) {
      const lines = updated.split("\\n");
      const insertIdx = lines[0]?.startsWith("# ") ? 1 : 0;
      lines.splice(insertIdx + 1, 0, "", `## Week of ${targetWeek}\\n${weekMarker}`, "");
      updated = lines.join("\\n");
    }

    const weekSection = this.extractWeekSection(updated, targetWeek);
    if (!weekSection) return;

    const lines = weekSection.lines;
    const sectionTitle = "### Week Coach";
    let sectionIdx = lines.findIndex((l) => l.trim() === sectionTitle);
    if (sectionIdx === -1) {
      lines.push("", sectionTitle, `- ${text.trim()}`);
    } else {
      lines.splice(sectionIdx + 1, 0, `- ${text.trim()}`);
    }

    const merged = this.replaceWeekSection(
      updated,
      weekSection.startIdx,
      weekSection.endIdx,
      lines.join("\\n")
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
      return /\\b(o3|1:1|1-1|one-on-one)\\b/i.test(title);
    }
  }

  private appendToSection(content: string, sectionTitle: string, text: string): string {
    const normalized = content.trim();
    const heading = `### ${sectionTitle}`;
    if (!normalized) {
      return `${heading}\\n- ${text.trim()}`.trim();
    }

    const regex = new RegExp(`### ${this.escapeRegex(sectionTitle)}\\\\n([\\\\s\\\\S]*?)(?=\\\\n### |\\\\n## |$)`, "m");
    const match = normalized.match(regex);
    if (!match) {
      return `${normalized}\\n\\n${heading}\\n- ${text.trim()}`.trim();
    }

    const existingBlock = match[0];
    const updatedBlock = `${heading}\\n- ${text.trim()}\\n${match[1].trim()}`.trim();
    return normalized.replace(existingBlock, updatedBlock);
  }

  private escapeRegex(input: string): string {
    return input.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&");
  }

  private filterAttendees(attendees: Attendee[]): Attendee[] {
    return (attendees || []).filter((a) => {
      if (a.self) return false;
      const rawName = a.displayName || this.humanizeEmail(a.email);
      const name = (rawName || "").toLowerCase();
      const email = (a.email || "").toLowerCase();

      if (this.settings.excludeEmails.some((sub) => email.includes(sub.toLowerCase()))) return false;
      if (this.settings.excludeNames.some((sub) => name.includes(sub.toLowerCase()))) return false;
      if (email.includes("resource.calendar.google.com")) return false;
      if (this.isLikelyRoomName(rawName || "")) return false;
      return true;
    });
  }

  private async resolvePersonFromAttendee(attendee: Attendee, o3People: O3Person[]): Promise<O3Person | null> {
    const email = (attendee.email || "").toLowerCase();
    if (email) {
      const path = this.indexService.findPersonByEmail(email);
      if (path) {
        try {
          return await this.loadPerson(path);
        } catch (error: unknown) {
          handleError("Failed to load People note by email", error, { silent: true });
        }
      }
      const existing = o3People.find((p) => (p.email || "").toLowerCase() === email);
      if (existing) return existing;
    }

    const name = attendee.displayName || this.humanizeEmail(attendee.email);
    const byName = await this.vaultSearch.findPeopleNoteByName(name);
    if (byName) {
      try {
        return await this.loadPerson(`${this.settings.peopleFolder}/${byName}.md`);
      } catch (error: unknown) {
        handleError("Failed to load People note by name", error, { silent: true });
      }
    }
    return null;
  }

  private async getO3People(): Promise<O3Person[]> {
    const paths = this.indexService.getO3PeoplePaths();
    const people: O3Person[] = [];
    for (const path of paths) {
      try {
        const person = await this.loadPerson(path);
        if (person) people.push(person);
      } catch (error: unknown) {
        handleError("Failed to load O3 person", error, { silent: true });
      }
    }
    return people;
  }

  private async loadPerson(path: string): Promise<O3Person> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      throw new Error(`People note not found: ${path}`);
    }
    const content = await this.app.vault.read(file);
    const fm = this.vaultSearch.parseFrontmatter<Record<string, any>>(content);
    const sections = this.parseO3Sections(content);

    const email = this.extractPrimaryEmail(fm);
    const o3Doc = (fm.o3_doc || fm.o3Doc || fm.o3doc || "").toString().trim() || null;
    const o3MeetingId = (fm.o3_meeting_id || fm.o3MeetingId || "").toString().trim() || null;

    return {
      name: file.basename,
      filePath: file.path,
      email,
      o3Doc,
      o3MeetingId,
      sections,
    };
  }

  private extractPrimaryEmail(frontmatter: Record<string, any>): string | null {
    const raw = frontmatter.Email || frontmatter.email;
    if (!raw) return null;
    if (Array.isArray(raw)) {
      const first = raw.find((e) => typeof e === "string" && e.trim());
      return first ? first.trim() : null;
    }
    if (typeof raw === "string" && raw.trim()) return raw.trim();
    return null;
  }

  private parseO3Sections(content: string): O3SectionData {
    const lines = content.split("\\n");
    const data: O3SectionData = { followUps: [], updates: [], standingTopics: [] };
    let inO3 = false;
    let section: "follow" | "update" | "standing" | null = null;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("## ")) {
        inO3 = trimmed.toLowerCase() === "## o3";
        section = null;
        continue;
      }
      if (!inO3) continue;
      if (trimmed.startsWith("### ")) {
        const heading = trimmed.toLowerCase();
        if (heading.includes("follow")) section = "follow";
        else if (heading.includes("update")) section = "update";
        else if (heading.includes("standing")) section = "standing";
        else section = null;
        continue;
      }
      if (!section) continue;
      const taskMatch = trimmed.match(/^-\\s*(?:\\[[ xX]\\]\\s*)?(.*)$/);
      if (taskMatch && taskMatch[1]) {
        const item = taskMatch[1].trim();
        if (!item) continue;
        if (section === "follow") data.followUps.push(item);
        if (section === "update") data.updates.push(item);
        if (section === "standing") data.standingTopics.push(item);
      }
    }

    return data;
  }

  private async buildO3Context(person: O3Person, event: CalendarEvent | null): Promise<string | null> {
    const parts: string[] = [];
    const weekKey = this.getWeekKey(event?.start?.dateTime);
    const meetingTime = event?.start?.dateTime ? moment(event.start.dateTime).format("ddd, HH:mm") : "Not scheduled";

    parts.push(`# O3 Prep Context`);
    parts.push(`Person: ${person.name}`);
    parts.push(`Week of: ${weekKey}`);
    parts.push(`Meeting time: ${meetingTime}`);
    if (person.sections.standingTopics.length > 0) {
      parts.push(`Standing topics: ${person.sections.standingTopics.join("; ")}`);
    }

    const personFile = this.app.vault.getAbstractFileByPath(person.filePath);
    if (personFile instanceof TFile) {
      const content = await this.app.vault.read(personFile);
      parts.push(`\\n## People Note\\n${content.substring(0, 2000)}`);
    }

    const meetings = this.indexService.findMeetingsForPerson(person.name);
    const meetingSnippets: string[] = [];
    for (const meetingPath of meetings.slice(0, 5)) {
      const file = this.app.vault.getAbstractFileByPath(meetingPath);
      if (file instanceof TFile) {
        const content = await this.app.vault.read(file);
        meetingSnippets.push(`-- ${file.basename} --\\n${content.substring(0, 1200)}`);
      }
    }
    if (meetingSnippets.length > 0) {
      parts.push(`\\n## Past Meetings\\n${meetingSnippets.join("\\n\\n")}`);
    }

    if (person.o3Doc) {
      const fileId = this.googleServices.extractDriveFileId(person.o3Doc);
      if (fileId) {
        const docContent = await this.googleServices.getDocContent(fileId);
        if (docContent) {
          parts.push(`\\n## O3 Doc (latest)\\n${docContent.substring(0, 3000)}`);
        }
      }
    }

    parts.push(`\\n## Output Requirements
Return markdown with these sections (omit empty ones):
### Follow-ups to Discuss
- [ ] question
### Updates You Need to Prepare
- [ ] item
### Discussion Topics
1. \"Question\"
### Feedback to Give
**What I liked:** bullets
**What I wish would change:** bullets

Rules:
- Specific names, dates, commitments. No generic questions.
- Highlight overdue action items and accountability gaps.
- If something is stale, call it out.
`);

    return parts.join("\\n");
  }

  private async ensureO3MeetingId(personPath: string, meetingId: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(personPath);
    if (!(file instanceof TFile)) return;
    const content = await this.app.vault.read(file);
    if (content.includes("o3_meeting_id:")) return;
    const updated = this.vaultSearch.updateFrontmatterInContent(content, "o3_meeting_id", meetingId);
    if (updated !== content) {
      await this.app.vault.modify(file, updated);
    }
  }

  private async addTaskToO3Section(personPath: string, sectionTitle: string, text: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(personPath);
    if (!(file instanceof TFile)) return;
    const content = await this.app.vault.read(file);
    const updated = this.upsertTask(content, sectionTitle, text);
    if (updated !== content) {
      await this.app.vault.modify(file, updated);
    }
  }

  private async removeTaskFromO3Section(personPath: string, sectionTitle: string, text: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(personPath);
    if (!(file instanceof TFile)) return;
    const content = await this.app.vault.read(file);
    const updated = this.removeTask(content, sectionTitle, text);
    if (updated !== content) {
      await this.app.vault.modify(file, updated);
    }
  }

  private upsertTask(content: string, sectionTitle: string, text: string): string {
    const lines = content.split("\\n");
    let o3Idx = lines.findIndex((l) => l.trim().toLowerCase() === "## o3");
    if (o3Idx === -1) {
      lines.push("");
      lines.push("## O3");
      lines.push("");
      lines.push(`### ${sectionTitle}`);
      lines.push(`- [ ] ${text}`);
      return lines.join("\\n");
    }

    const sectionIdx = this.findSectionIndex(lines, o3Idx + 1, sectionTitle);
    if (sectionIdx === -1) {
      lines.splice(o3Idx + 1, 0, "", `### ${sectionTitle}`, `- [ ] ${text}`);
      return lines.join("\\n");
    }

    // Insert after section heading, avoid duplicates
    const insertAt = sectionIdx + 1;
    const exists = lines.slice(insertAt).some((l) => l.includes(text));
    if (!exists) {
      lines.splice(insertAt, 0, `- [ ] ${text}`);
    }
    return lines.join("\\n");
  }

  private removeTask(content: string, sectionTitle: string, text: string): string {
    const lines = content.split("\\n");
    const o3Idx = lines.findIndex((l) => l.trim().toLowerCase() === "## o3");
    if (o3Idx === -1) return content;
    const sectionIdx = this.findSectionIndex(lines, o3Idx + 1, sectionTitle);
    if (sectionIdx === -1) return content;

    for (let i = sectionIdx + 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith("### ") || line.startsWith("## ")) break;
      if (line.includes(text)) {
        lines.splice(i, 1);
        break;
      }
    }
    return lines.join("\\n");
  }

  private findSectionIndex(lines: string[], startIdx: number, sectionTitle: string): number {
    const lowerTitle = sectionTitle.toLowerCase();
    for (let i = startIdx; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith("## ")) break;
      if (line.startsWith("### ") && line.toLowerCase().includes(lowerTitle)) {
        return i;
      }
    }
    return -1;
  }

  private async ensureMasterNote(): Promise<TFile | null> {
    const path = this.settings.o3.masterNotePath;
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) return existing;

    await this.ensureFolderExists(path);
    const content = "# O3 Prep\\n";
    try {
      return await this.app.vault.create(path, content);
    } catch (error: unknown) {
      handleError("Failed to create master O3 prep note", error, { showNotice: true });
      return null;
    }
  }

  private async ensureFolderExists(filePath: string): Promise<void> {
    const folderPath = filePath.split("/").slice(0, -1).join("/");
    if (!folderPath) return;
    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    if (folder instanceof TFolder) return;

    const parts = folderPath.split("/");
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      const existing = this.app.vault.getAbstractFileByPath(current);
      if (!existing) {
        await this.app.vault.createFolder(current);
      }
    }
  }

  private upsertPersonSection(
    content: string,
    weekKey: string,
    personKey: string,
    heading: string,
    body: string
  ): string {
    let updated = content;
    const weekMarker = `${WEEK_MARKER_PREFIX}${weekKey} -->`;
    const weekHeader = `## Week of ${weekKey}\\n${weekMarker}`;

    if (!updated.includes(weekMarker)) {
      const lines = updated.split("\\n");
      const insertIdx = lines[0]?.startsWith("# ") ? 1 : 0;
      lines.splice(insertIdx + 1, 0, "", weekHeader, "");
      updated = lines.join("\\n");
    }

    const section = this.extractWeekSection(updated, weekKey);
    if (!section) return updated;

    const personMarker = `${PERSON_MARKER_PREFIX}${personKey} -->`;
    const lines = section.lines;

    let markerIdx = lines.findIndex((l) => l.includes(personMarker));
    if (markerIdx === -1) {
      lines.push("", heading, personMarker, body.trim());
    } else {
      // Ensure heading line exists right above marker
      if (markerIdx === 0 || !lines[markerIdx - 1].startsWith("### ")) {
        lines.splice(markerIdx, 0, heading);
        markerIdx += 1;
      } else {
        lines[markerIdx - 1] = heading;
      }

      let endIdx = lines.length;
      for (let i = markerIdx + 1; i < lines.length; i++) {
        if (lines[i].startsWith("### ") || lines[i].startsWith("## ")) {
          endIdx = i;
          break;
        }
      }
      const bodyLines = body.trim().split("\\n");
      lines.splice(markerIdx + 1, endIdx - markerIdx - 1, ...bodyLines);
    }

    return this.replaceWeekSection(updated, section.startIdx, section.endIdx, lines.join("\\n"));
  }

  private extractPersonSection(content: string, weekKey: string, personKey: string): string | null {
    const weekSection = this.extractWeekSection(content, weekKey);
    if (!weekSection) return null;
    const lines = weekSection.lines;
    const marker = `${PERSON_MARKER_PREFIX}${personKey} -->`;
    const markerIdx = lines.findIndex((l) => l.includes(marker));
    if (markerIdx === -1) return null;
    let endIdx = lines.length;
    for (let i = markerIdx + 1; i < lines.length; i++) {
      if (lines[i].startsWith("### ") || lines[i].startsWith("## ")) {
        endIdx = i;
        break;
      }
    }
    return lines.slice(markerIdx + 1, endIdx).join("\\n").trim();
  }

  private extractWeekSection(
    content: string,
    weekKey: string
  ): { lines: string[]; startIdx: number; endIdx: number } | null {
    const weekMarker = `${WEEK_MARKER_PREFIX}${weekKey} -->`;
    const lines = content.split("\\n");
    const markerIdx = lines.findIndex((l) => l.includes(weekMarker));
    if (markerIdx === -1) return null;

    let startIdx = markerIdx - 1;
    while (startIdx > 0 && !lines[startIdx].startsWith("## ")) {
      startIdx -= 1;
    }

    let endIdx = lines.length;
    for (let i = markerIdx + 1; i < lines.length; i++) {
      if (lines[i].startsWith("## ") && !lines[i].includes("Week of")) {
        continue;
      }
      if (lines[i].startsWith("## ") && i > startIdx) {
        endIdx = i;
        break;
      }
    }

    return { lines: lines.slice(startIdx, endIdx), startIdx, endIdx };
  }

  private replaceWeekSection(content: string, startIdx: number, endIdx: number, newSection: string): string {
    const lines = content.split("\\n");
    lines.splice(startIdx, endIdx - startIdx, ...newSection.split("\\n"));
    return lines.join("\\n");
  }

  private getWeekKey(dateTime?: string): string {
    const base = dateTime ? moment(dateTime) : moment();
    return base.startOf("isoWeek").format("YYYY-MM-DD");
  }

  private buildPersonHeading(person: O3Person, event: CalendarEvent | null): string {
    if (!event?.start?.dateTime) return `### ${person.name}`;
    const time = moment(event.start.dateTime).format("ddd, HH:mm");
    return `### ${person.name} — ${time}`;
  }

  private getPersonKey(person: O3Person): string {
    if (person.email) return person.email.toLowerCase();
    return person.filePath.toLowerCase();
  }

  private ensureSection(title: string, content: string): string {
    if (content.includes(`### ${title}`)) return content;
    return `${content.trim()}\\n\\n### ${title}\\n`;
  }

  private injectTasks(title: string, tasks: string[], content: string): string {
    if (!tasks || tasks.length === 0) return content;
    const unique = Array.from(new Set(tasks));
    const taskLines = unique.map((t) => `- [ ] ${t}`);
    const re = new RegExp(`### ${title}\\\\n([\\\\s\\\\S]*?)(?=\\\\n### |\\\\n## |$)`, "m");
    const match = content.match(re);
    if (!match) {
      return `${content.trim()}\\n\\n### ${title}\\n${taskLines.join("\\n")}`;
    }
    const existing = match[0];
    const merged = `### ${title}\\n${taskLines.join("\\n")}\\n${match[1].trim()}`;
    return content.replace(existing, merged.trimEnd());
  }

  private async getLastMeetingDate(person: O3Person): Promise<string | null> {
    const meetingPaths = this.indexService.findMeetingsForPerson(person.name);
    if (!meetingPaths || meetingPaths.length === 0) return null;

    let latest: string | null = null;
    for (const path of meetingPaths) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) continue;
      const fileCache = this.app.metadataCache.getFileCache(file);
      const date = this.extractMeetingDate(file, fileCache?.frontmatter);
      if (date && (!latest || date > latest)) {
        latest = date;
      }
    }

    return latest;
  }

  private extractMeetingDate(file: TFile, frontmatter?: Record<string, any>): string | null {
    const fmDate = frontmatter?.date || frontmatter?.start;
    if (typeof fmDate === "string") {
      const match = fmDate.match(/\\d{4}-\\d{2}-\\d{2}/);
      if (match) return match[0];
    }
    const nameMatch = file.basename.match(/\\d{4}-\\d{2}-\\d{2}/);
    if (nameMatch) return nameMatch[0];
    return null;
  }

  private humanizeEmail(email: string): string {
    return email
      .split("@")[0]
      .split(/[._]/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }

  private isLikelyRoomName(name: string): boolean {
    const n = (name || "").trim().toLowerCase();
    if (!n) return false;
    return /^p\\d+-\\d+/.test(n);
  }
}
