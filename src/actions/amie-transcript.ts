// ============================================================================
// Amie Transcript Action - Meeting transcript processing from webhooks
// ============================================================================

import { App, TFile, TFolder, Notice } from "obsidian";
import type { PluginSettings, AmieWebhookPayload, CalendarEvent } from "../types";
import type { CalendarService } from "../services/calendar";
import { handleErrorWithDefault } from "../utils/error-handler";

const moment = (window as any).moment;

// ============================================================================
// Types
// ============================================================================

export interface TranscriptResult {
  notePath: string;
  action: "created" | "updated";
}

// ============================================================================
// AmieTranscriptAction Class
// ============================================================================

/**
 * Amie Transcript Action - Processes meeting transcripts from Amie webhooks
 * Creates or updates meeting notes with transcript content.
 */
export class AmieTranscriptAction {
  private app: App;
  private settings: PluginSettings;
  private calendarService: CalendarService;

  constructor(app: App, settings: PluginSettings, calendarService: CalendarService) {
    this.app = app;
    this.settings = settings;
    this.calendarService = calendarService;
  }

  /**
   * Update settings reference
   */
  updateSettings(settings: PluginSettings): void {
    this.settings = settings;
  }

  /**
   * Process a transcript from Amie webhook
   */
  async processTranscript(payload: AmieWebhookPayload): Promise<TranscriptResult> {
    const eventId = payload.metadata.providerCalendarEventId;
    const calendarId = payload.metadata.providerCalendarId;

    console.log(`[AmieTranscript] Processing transcript for event: ${eventId}`);

    // Try to get recurringEventId by looking up the event
    const recurringEventId = await this.getRecurringEventId(eventId, payload.metadata.startAt);
    const effectiveEventId = recurringEventId || eventId;

    console.log(`[AmieTranscript] Effective event ID: ${effectiveEventId} (recurring: ${!!recurringEventId})`);

    // Search for existing meeting note
    const existingNote = await this.findMeetingNote(effectiveEventId);

    if (existingNote) {
      // Append transcript to existing note
      console.log(`[AmieTranscript] Found existing note: ${existingNote.path}`);
      await this.appendTranscript(existingNote, payload);
      return { notePath: existingNote.path, action: "updated" };
    } else {
      // Create new meeting note
      const notePath = await this.createMeetingNote(payload, effectiveEventId, !!recurringEventId);
      return { notePath, action: "created" };
    }
  }

  /**
   * Try to get recurringEventId by looking up the event in Google Calendar
   */
  private async getRecurringEventId(eventId: string, startAt: string): Promise<string | null> {
    try {
      // Get events around the meeting time to find the event
      const meetingStart = moment(startAt);
      const searchStart = meetingStart.clone().subtract(1, "day");
      const searchEnd = meetingStart.clone().add(1, "day");

      const events = await this.calendarService.getEvents(searchStart, searchEnd);

      // Find the event that matches our eventId
      for (const event of events) {
        if (event.id === eventId) {
          return event.recurringEventId || null;
        }
      }

      console.log(`[AmieTranscript] Event ${eventId} not found in calendar search`);
      return null;
    } catch (error) {
      console.error("[AmieTranscript] Error looking up event:", error);
      return null;
    }
  }

  /**
   * Search for an existing meeting note by event ID in filename
   */
  private async findMeetingNote(eventId: string): Promise<TFile | null> {
    const files = this.app.vault.getMarkdownFiles();

    // Search for files with ~eventId in the filename
    const pattern = `~${eventId}`;
    for (const file of files) {
      if (file.name.includes(pattern)) {
        return file;
      }
    }

    return null;
  }

  /**
   * Append transcript to an existing meeting note and update frontmatter
   */
  private async appendTranscript(file: TFile, payload: AmieWebhookPayload): Promise<void> {
    const content = await this.app.vault.read(file);

    // Update frontmatter with webhook metadata
    const updatedContent = this.updateFrontmatter(content, payload);

    const transcriptSection = this.formatTranscriptSection(payload);

    // Append to the end of the file
    const newContent = updatedContent.trimEnd() + "\n\n" + transcriptSection;

    await this.app.vault.modify(file, newContent);

    console.log(`[AmieTranscript] Appended transcript to: ${file.path}`);
    new Notice(`Meeting transcript added to ${file.basename}`);
  }

  /**
   * Update frontmatter with webhook metadata
   */
  private updateFrontmatter(content: string, payload: AmieWebhookPayload): string {
    // Check if content has frontmatter
    if (!content.startsWith("---")) {
      // No frontmatter, add one
      const frontmatter = this.buildFrontmatterFromPayload(payload);
      return frontmatter + "\n" + content;
    }

    // Parse existing frontmatter
    const endIndex = content.indexOf("---", 3);
    if (endIndex === -1) {
      return content; // Malformed frontmatter, leave as-is
    }

    const frontmatterContent = content.slice(4, endIndex).trim();
    const bodyContent = content.slice(endIndex + 3);

    // Parse frontmatter lines into key-value pairs
    const lines = frontmatterContent.split("\n");
    const frontmatterData: Map<string, string> = new Map();
    const arrayFields: Map<string, string[]> = new Map();
    let currentArrayKey: string | null = null;

    for (const line of lines) {
      if (line.startsWith("  - ")) {
        // Array item
        if (currentArrayKey) {
          const arr = arrayFields.get(currentArrayKey) || [];
          arr.push(line);
          arrayFields.set(currentArrayKey, arr);
        }
      } else if (line.includes(":")) {
        const colonIndex = line.indexOf(":");
        const key = line.slice(0, colonIndex).trim();
        const value = line.slice(colonIndex + 1).trim();
        frontmatterData.set(key, value);
        if (value === "") {
          currentArrayKey = key;
        } else {
          currentArrayKey = null;
        }
      }
    }

    // Update with webhook data
    if (payload.recordingId) {
      frontmatterData.set("recording_id", payload.recordingId);
    }
    if (payload.recordingLink) {
      frontmatterData.set("recording_link", payload.recordingLink);
    }
    if (payload.metadata.startAt && !frontmatterData.get("start")) {
      frontmatterData.set("start", payload.metadata.startAt);
    }
    if (payload.metadata.endAt && !frontmatterData.get("end")) {
      frontmatterData.set("end", payload.metadata.endAt);
    }
    if (payload.shortSummary) {
      frontmatterData.set("short_summary", `"${this.escapeYamlString(payload.shortSummary)}"`);
    }

    // Update attendees if not set and guests available
    if (payload.metadata.guests?.length > 0) {
      const existingAttendees = arrayFields.get("attendees") || [];
      if (existingAttendees.length === 0) {
        const attendeeLines = payload.metadata.guests.map((g) => {
          const name = g.displayName || g.email.split("@")[0];
          return `  - "[[People/${name}|${name}]]"`;
        });
        arrayFields.set("attendees", attendeeLines);
      }
    }

    // Rebuild frontmatter
    const newFrontmatterLines: string[] = ["---"];

    // Preserve order: put known keys first, then new ones
    const orderedKeys = ["date", "event_id", "recurring_event_id", "title", "start", "end",
                        "meet_url", "recording_id", "recording_link", "short_summary", "attendees"];
    const addedKeys = new Set<string>();

    for (const key of orderedKeys) {
      if (frontmatterData.has(key)) {
        newFrontmatterLines.push(`${key}: ${frontmatterData.get(key)}`);
        addedKeys.add(key);
        // Add array items if this is an array field
        const arrayItems = arrayFields.get(key);
        if (arrayItems) {
          newFrontmatterLines.push(...arrayItems);
        }
      }
    }

    // Add any remaining keys not in ordered list
    for (const [key, value] of frontmatterData) {
      if (!addedKeys.has(key)) {
        newFrontmatterLines.push(`${key}: ${value}`);
        const arrayItems = arrayFields.get(key);
        if (arrayItems) {
          newFrontmatterLines.push(...arrayItems);
        }
      }
    }

    newFrontmatterLines.push("---");

    return newFrontmatterLines.join("\n") + bodyContent;
  }

  /**
   * Build a new frontmatter block from payload (for notes without frontmatter)
   */
  private buildFrontmatterFromPayload(payload: AmieWebhookPayload): string {
    const meetingDate = moment(payload.metadata.startAt);

    const attendees = payload.metadata.guests
      .map((g) => {
        const name = g.displayName || g.email.split("@")[0];
        return `  - "[[People/${name}|${name}]]"`;
      })
      .join("\n");

    const lines = [
      "---",
      `date: ${meetingDate.format("YYYY-MM-DD")}`,
      `title: "${this.escapeYamlString(payload.metadata.title || "")}"`,
      `start: ${payload.metadata.startAt}`,
      `end: ${payload.metadata.endAt}`,
      payload.recordingId ? `recording_id: ${payload.recordingId}` : null,
      payload.recordingLink ? `recording_link: ${payload.recordingLink}` : null,
      payload.shortSummary ? `short_summary: "${this.escapeYamlString(payload.shortSummary)}"` : null,
      "attendees:",
      attendees,
      "---",
    ].filter((line) => line !== null);

    return lines.join("\n");
  }

  /**
   * Create a new meeting note with the transcript
   */
  private async createMeetingNote(
    payload: AmieWebhookPayload,
    effectiveEventId: string,
    isRecurring: boolean
  ): Promise<string> {
    const title = this.sanitizeFilename(payload.metadata.title || "Untitled Meeting");
    const filename = `${title} ~${effectiveEventId}.md`;

    // Determine folder based on routing rules
    const folder = this.resolveFolder(payload, isRecurring);
    const folderPath = folder;

    // Ensure folder exists
    await this.ensureFolderExists(folderPath);

    const filePath = `${folderPath}/${filename}`;

    // Generate note content
    const content = this.formatMeetingNote(payload, effectiveEventId, isRecurring);

    // Create the file
    await this.app.vault.create(filePath, content);

    console.log(`[AmieTranscript] Created meeting note: ${filePath}`);
    new Notice(`Meeting note created: ${title}`);

    return filePath;
  }

  /**
   * Resolve the folder path for a meeting note based on routing rules
   */
  private resolveFolder(payload: AmieWebhookPayload, isRecurring: boolean): string {
    const title = (payload.metadata.title || "").toLowerCase();
    const meetingsFolder = this.settings.meetingsFolder;
    const meetingDate = moment(payload.metadata.startAt);

    // Special routing rules (matching daily-note.ts patterns)
    if (/interview/i.test(title)) {
      return `${meetingsFolder}/Interviews`;
    }
    if (/1-1|o3|one-on-one/i.test(title)) {
      return `${meetingsFolder}/O3s`;
    }
    if (/business performance review/i.test(title)) {
      return meetingsFolder;
    }
    if (/standup|stand-up/i.test(title)) {
      return meetingsFolder;
    }

    // Default routing: recurring → root, one-off → YYYY-MM
    if (isRecurring) {
      return meetingsFolder;
    }
    return `${meetingsFolder}/${meetingDate.format("YYYY-MM")}`;
  }

  /**
   * Ensure a folder exists, creating it if necessary
   */
  private async ensureFolderExists(folderPath: string): Promise<void> {
    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    if (folder instanceof TFolder) {
      return; // Folder exists
    }

    // Create folder hierarchy
    const parts = folderPath.split("/");
    let currentPath = "";
    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const existing = this.app.vault.getAbstractFileByPath(currentPath);
      if (!existing) {
        await this.app.vault.createFolder(currentPath);
      }
    }
  }

  /**
   * Format the full meeting note content
   */
  private formatMeetingNote(
    payload: AmieWebhookPayload,
    effectiveEventId: string,
    isRecurring: boolean
  ): string {
    const meetingDate = moment(payload.metadata.startAt);

    // Format attendees as wikilinks
    const attendees = payload.metadata.guests
      .map((g) => {
        const name = g.displayName || g.email.split("@")[0];
        return `  - "[[People/${name}|${name}]]"`;
      })
      .join("\n");

    // Build frontmatter
    const frontmatter = [
      "---",
      `date: ${meetingDate.format("YYYY-MM-DD")}`,
      `event_id: ${effectiveEventId}`,
      isRecurring ? `recurring_event_id: ${effectiveEventId}` : null,
      `title: "${this.escapeYamlString(payload.metadata.title || "")}"`,
      `start: ${payload.metadata.startAt}`,
      `end: ${payload.metadata.endAt}`,
      "meet_url:",
      payload.recordingId ? `recording_id: ${payload.recordingId}` : null,
      payload.recordingLink ? `recording_link: ${payload.recordingLink}` : null,
      payload.shortSummary ? `short_summary: "${this.escapeYamlString(payload.shortSummary)}"` : null,
      "attendees:",
      attendees,
      "---",
    ]
      .filter((line) => line !== null)
      .join("\n");

    // Build body
    const body = [
      "",
      `# ${payload.metadata.title || "Untitled Meeting"}`,
      "",
      "**Description:**",
      payload.metadata.description || "",
      "",
      this.formatTranscriptSection(payload),
    ].join("\n");

    return frontmatter + body;
  }

  /**
   * Format the transcript section to append
   */
  private formatTranscriptSection(payload: AmieWebhookPayload): string {
    if (payload.transcript) {
      return "## Transcript\n\n" + payload.transcript;
    }
    return "";
  }

  /**
   * Sanitize a string for use in a filename
   */
  private sanitizeFilename(name: string): string {
    // Remove or replace characters that are invalid in filenames
    return name
      .replace(/[<>:"/\\|?*]/g, "-")
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * Escape a string for YAML
   */
  private escapeYamlString(str: string): string {
    return str.replace(/"/g, '\\"');
  }
}
