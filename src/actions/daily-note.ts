import { App, TFile } from "obsidian";
import type {
  PluginSettings,
  CalendarEvent,
  Attendee,
  BriefingQueueItem,
  MeetingRule,
  TemplaterObject,
} from "../types";
import { CalendarService } from "../services/calendar";
import { VaultSearchService } from "../services/vault-search";
import { MeetingBriefingAction } from "./meeting-briefing";
import { handleError } from "../utils/error-handler";

const moment = (window as any).moment;

/**
 * Daily Note Action
 * Generates daily meeting lists and triggers briefing generation
 */
export class DailyNoteAction {
  private app: App;
  private settings: PluginSettings;
  private calendarService: CalendarService;
  private vaultSearch: VaultSearchService;
  private meetingBriefing: MeetingBriefingAction;

  constructor(
    app: App,
    settings: PluginSettings,
    calendarService: CalendarService,
    vaultSearch: VaultSearchService,
    meetingBriefing: MeetingBriefingAction
  ) {
    this.app = app;
    this.settings = settings;
    this.calendarService = calendarService;
    this.vaultSearch = vaultSearch;
    this.meetingBriefing = meetingBriefing;
  }

  /**
   * Update settings reference
   */
  updateSettings(settings: PluginSettings): void {
    this.settings = settings;
  }

  /**
   * Generate daily note meeting list
   * Called from Templater: api.generateDailyNote(tp)
   */
  async generateDailyNote(tp: TemplaterObject): Promise<string> {
    // Fetch today's events
    const start = moment().startOf("day");
    const end = moment().endOf("day");
    const events = await this.calendarService.getEvents(start, end);

    // Filter events
    const filtered = this.filterEvents(events);

    // Generate list
    let outputList = "";
    const eventsToProcess: BriefingQueueItem[] = [];

    for (const e of filtered) {
      const time = moment(e.start.dateTime).format("HH:mm");
      const rule = this.getRule(e);
      const folder = this.resolveFolder(e, rule);
      const noteTitle = this.resolveTitle(e, rule);
      const aliasTitle = this.sanitizeAlias(noteTitle);
      const seriesId = e.recurringEventId || e.id;
      const fileTitle = `${aliasTitle} ~${seriesId}`;
      const meetingLink = `[[${folder}/${fileTitle}|${aliasTitle}]]`;

      // Participants
      const cap = this.resolveParticipantCap(rule);
      const participantsFiltered = this.filterParticipants(e.attendees || []);

      let partTxt = "";
      if (cap > 0 && participantsFiltered.length > 0 && participantsFiltered.length <= cap) {
        // Ensure People notes exist for listed participants
        await this.ensurePeopleNotes(participantsFiltered, false);

        const pList = participantsFiltered
          .map((a) => {
            const name = a.displayName || this.humanizeEmail(a.email);
            return `[[${this.settings.peopleFolder}/${name}|${name}]]`;
          })
          .join(", ");
        partTxt = ` with ${pList}`;
      }

      // Queue for async processing (all meetings go through AI filter)
      if (participantsFiltered.length > 0) {
        eventsToProcess.push({
          event: e,
          anchor: meetingLink,
          participants: participantsFiltered,
          noteTitle: noteTitle,
        });
      }

      outputList += `- ${time} – ${meetingLink}${partTxt}\n`;

      if (this.settings.o3?.enabled && this.settings.o3.dailyNoteInsert && this.isO3Meeting(e)) {
        const weekStart = this.getO3WeekStart(e.start.dateTime);
        const masterPath = this.stripMdExtension(this.settings.o3.masterNotePath);
        outputList += `\t- O3 prep: [[${masterPath}#Week of ${weekStart}|Open prep]]\n`;
      }
    }

    // Trigger async processing after a short delay
    const filePath = tp.file.path(true);
    console.log(`[GSD] Daily note created with ${eventsToProcess.length} meetings to process for briefings`);
    eventsToProcess.forEach((item, i) => {
      console.log(`[GSD] Queue item ${i + 1}: "${item.event.summary}" with ${item.participants.length} participants`);
    });
    setTimeout(() => this.processQueue(eventsToProcess, filePath), 1000);

    return outputList || "_No events today._";
  }

  /**
   * Filter events based on settings
   */
  private filterEvents(events: CalendarEvent[]): CalendarEvent[] {
    return events.filter((e) => {
      const title = e.summary?.trim() || "";
      if (!e.start?.dateTime) return false;

      // Exclude by title
      if (
        this.settings.excludeTitles.some(
          (t) => t.toLowerCase() === title.toLowerCase()
        )
      ) {
        return false;
      }

      // Skip events the user has declined
      const myAttendee = (e.attendees || []).find((a) =>
        this.settings.excludeEmails.some((excl) =>
          (a.email || "").toLowerCase().includes(excl.toLowerCase())
        )
      );
      if (myAttendee && myAttendee.responseStatus === "declined") {
        return false;
      }

      return true;
    });
  }

  /**
   * Filter participants to remove excluded attendees
   */
  private filterParticipants(attendees: Attendee[]): Attendee[] {
    const cleaned = (attendees || []).filter((a) => {
      const rawName = a.displayName || this.humanizeEmail(a.email);
      const name = (rawName || "").toLowerCase();
      const email = (a.email || "").toLowerCase();

      // User-configured excludes
      const excludedByEmail = this.settings.excludeEmails.some((sub) => {
        const s = sub.toLowerCase();
        return name.includes(s) || email.includes(s);
      });
      const excludedByName = this.settings.excludeNames.some((sub) => {
        const s = sub.toLowerCase();
        return name.includes(s);
      });
      if (excludedByEmail || excludedByName) return false;

      // Google resource calendars (rooms/equipment)
      if (email.includes("resource.calendar.google.com")) return false;

      // Heuristic: office room names like "P9-2-2.05"
      if (this.isLikelyRoomName(rawName || "")) return false;

      return true;
    });

    // Dedupe by email (preferred) or name fallback
    const seen = new Set<string>();
    const deduped: Attendee[] = [];
    for (const a of cleaned) {
      const email = (a.email || "").toLowerCase().trim();
      const rawName = a.displayName || this.humanizeEmail(a.email);
      const nameKey = (rawName || "").toLowerCase().trim();
      const key = email ? `e:${email}` : `n:${nameKey}`;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      deduped.push(a);
    }

    return deduped;
  }

  /**
   * Ensure People notes exist for participants
   */
  async ensurePeopleNotes(
    participants: Attendee[],
    triggerResearch: boolean = false
  ): Promise<void> {
    for (const p of participants) {
      // Safety: never create People notes for rooms/resources
      if (this.isRoomOrResourceAttendee(p)) continue;

      const email = p.email;
      const name = p.displayName || this.humanizeEmail(email);
      const peoplePath = `${this.settings.peopleFolder}/${name}.md`;

      // Check if note already exists
      const existingFile = this.app.vault.getAbstractFileByPath(peoplePath);
      if (existingFile) {
        // Note exists - check if email is set
        if (existingFile instanceof TFile) {
          const content = await this.app.vault.read(existingFile);
          if (!content.includes(email) && email) {
            const updatedContent = this.addEmailToFrontmatter(content, email);
            if (updatedContent !== content) {
              await this.app.vault.modify(existingFile, updatedContent);
              console.log(`[GSD] Added email to ${name}`);
            }
          }
        }
        continue;
      }

      // Check if any People note already has this email
      if (email) {
        const existingByEmail = await this.vaultSearch.findPeopleNoteByEmail(email);
        if (existingByEmail) {
          console.log(`[GSD] Found existing note for ${email}: ${existingByEmail}`);
          continue;
        }
      }

      // Create new People note
      const noteContent = `---
Title:
Organization: "[[]]"
Location: "[[]]"
Phone:
Email: ${email || ""}
researched: false
tags:
  - "#person"
created: ${moment().format("YYYY-MM-DD HH:mm")}
---
`;

      try {
        await this.app.vault.create(peoplePath, noteContent);
        console.log(`[GSD] Created People note for ${name}`);
      } catch (error: unknown) {
        handleError(`Failed to create note for ${name}`, error, {
          additionalContext: { name },
        });
      }
    }
  }

  private isRoomOrResourceAttendee(a: Attendee): boolean {
    const rawName = a.displayName || this.humanizeEmail(a.email);
    const name = (rawName || "").toLowerCase();
    const email = (a.email || "").toLowerCase();

    if (email.includes("resource.calendar.google.com")) return true;
    if (this.isLikelyRoomName(rawName || "")) return true;

    // Also respect user excludes as a last line of defense
    if (this.settings.excludeNames.some((sub) => name.includes(sub.toLowerCase()))) return true;
    if (
      this.settings.excludeEmails.some((sub) => {
        const s = sub.toLowerCase();
        return name.includes(s) || email.includes(s);
      })
    ) {
      return true;
    }

    return false;
  }

  private isLikelyRoomName(name: string): boolean {
    const n = (name || "").trim().toLowerCase();
    if (!n) return false;
    // Matches patterns like "P9-2", "P9-2-2.05", etc.
    return /^p\d+-\d+/.test(n);
  }

  /**
   * Process the briefing queue with parallel execution and rate limiting
   * Uses settings.parallelBriefings and settings.apiDelayMs for configuration
   */
  private async processQueue(queue: BriefingQueueItem[], filePath: string): Promise<void> {
    const concurrency = this.settings.parallelBriefings || 3;
    const minDelay = this.settings.apiDelayMs || 500;

    console.log(`[GSD] Processing ${queue.length} meetings with concurrency=${concurrency}`);
    const startTime = Date.now();

    // Process in batches
    for (let i = 0; i < queue.length; i += concurrency) {
      const batch = queue.slice(i, i + concurrency);
      const batchStart = Date.now();

      // Process batch in parallel
      await Promise.all(
        batch.map((item) => 
          this.meetingBriefing.processMeetingBriefing(item, filePath)
            .catch((err) => {
              console.error(`[GSD] Failed to process meeting: ${item.event.summary}`, err);
            })
        )
      );

      // Rate limit: ensure minimum delay between batches
      const batchDuration = Date.now() - batchStart;
      if (i + concurrency < queue.length && batchDuration < minDelay) {
        await this.delay(minDelay - batchDuration);
      }
    }

    const totalTime = Date.now() - startTime;
    console.log(`[GSD] Processed ${queue.length} meetings in ${totalTime}ms`);
  }

  /**
   * Simple delay utility
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ============================================================================
  // Routing Helpers
  // ============================================================================

  private getRule(e: CalendarEvent): MeetingRule | null {
    const titleRouting: MeetingRule[] = [
      {
        match: /business performance review/i,
        to: this.settings.meetingsFolder,
        listParticipants: 0,
        title: "Business Performance Review",
      },
      {
        match: /interview/i,
        to: `${this.settings.meetingsFolder}/Interviews`,
        listParticipants: 5,
        title: (ev: CalendarEvent) => {
          const base = (ev.summary || "Interview").trim();
          const date = moment(ev.start.dateTime).format("YYYY-MM-DD");
          return `${date} – ${base}`;
        },
      },
      {
        match: /standup|stand-up/i,
        to: this.settings.meetingsFolder,
        listParticipants: 0,
      },
      {
        match: /1-1|o3|one-on-one/i,
        to: `${this.settings.meetingsFolder}/O3s`,
        listParticipants: 3,
      },
    ];

    const title = (e.summary || "").trim();
    for (const r of titleRouting) {
      if (r.match instanceof RegExp ? r.match.test(title) : false) {
        return r;
      }
    }
    return null;
  }

  private resolveFolder(e: CalendarEvent, rule: MeetingRule | null): string {
    if (rule && (rule.to || rule.folder)) {
      const dest = rule.to ?? rule.folder;
      return typeof dest === "function" ? dest(e) : (dest as string);
    }
    // Recurring meetings go to root folder (consistent path across instances)
    // One-off meetings go to monthly subfolders
    if (e.recurringEventId) {
      return this.settings.meetingsFolder;
    }
    return `${this.settings.meetingsFolder}/${moment(e.start.dateTime).format("YYYY-MM")}`;
  }

  private resolveTitle(e: CalendarEvent, rule: MeetingRule | null): string {
    const base = (e.summary || "(No title)").trim();
    if (rule && rule.title !== undefined) {
      return typeof rule.title === "function" ? rule.title(e) : rule.title;
    }
    return base;
  }

  private resolveParticipantCap(rule: MeetingRule | null): number {
    if (!rule) return this.settings.maxListedParticipants;
    if (rule.listParticipants === false) return 0;
    if (typeof rule.listParticipants === "number") {
      return Math.max(0, rule.listParticipants);
    }
    return this.settings.maxListedParticipants;
  }

  // ============================================================================
  // Utility Helpers
  // ============================================================================

  private humanizeEmail(email: string): string {
    return email
      .split("@")[0]
      .split(/[._]/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }

  private sanitizeAlias(s: string): string {
    return (s || "(No title)")
      .replace(/\|/g, "-")
      .replace(/[\/\\|<>:"?*]/g, "-");
  }

  private addEmailToFrontmatter(content: string, email: string): string {
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) return content;

    let fm = fmMatch[1];

    if (/^Email:\s*$/m.test(fm)) {
      fm = fm.replace(/^Email:\s*$/m, `Email: ${email}`);
    } else if (!/^Email:/m.test(fm)) {
      fm += `\nEmail: ${email}`;
    }

    return content.replace(/^---\n[\s\S]*?\n---/, `---\n${fm}\n---`);
  }

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

  private getO3WeekStart(dateTime?: string): string {
    const base = dateTime ? moment(dateTime) : moment();
    return base.startOf("isoWeek").format("YYYY-MM-DD");
  }

  private stripMdExtension(path: string): string {
    return path.endsWith(".md") ? path.slice(0, -3) : path;
  }
}
