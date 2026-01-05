import { App, TFile, MarkdownView } from "obsidian";
import type {
  PluginSettings,
  CalendarEvent,
  Attendee,
  BriefingQueueItem,
} from "../types";
import { GoogleServices } from "../services/google-services";
import { AIService } from "../services/ai-service";
import { VaultSearchService } from "../services/vault-search";
import { PersonResearchAction } from "./person-research";
import type { FeedbackAction } from "./feedback";
import { handleError } from "../utils/error-handler";

const moment = (window as any).moment;

/**
 * Meeting Briefing Action
 * Generates AI-powered briefings for meetings
 */
export class MeetingBriefingAction {
  private app: App;
  private settings: PluginSettings;
  private googleServices: GoogleServices;
  private aiService: AIService;
  private vaultSearch: VaultSearchService;
  private personResearch: PersonResearchAction | null = null;
  private feedback: FeedbackAction | null = null;

  constructor(
    app: App,
    settings: PluginSettings,
    googleServices: GoogleServices,
    aiService: AIService,
    vaultSearch: VaultSearchService
  ) {
    this.app = app;
    this.settings = settings;
    this.googleServices = googleServices;
    this.aiService = aiService;
    this.vaultSearch = vaultSearch;
  }

  /**
   * Set the person research action (to avoid circular dependency)
   */
  setPersonResearch(personResearch: PersonResearchAction): void {
    this.personResearch = personResearch;
  }

  /**
   * Set feedback action reference
   */
  setFeedback(feedback: FeedbackAction): void {
    this.feedback = feedback;
  }

  /**
   * Update settings reference
   */
  updateSettings(settings: PluginSettings): void {
    this.settings = settings;
  }

  /**
   * Process a single meeting briefing
   * @param bypassFilter - If true, skip the AI filter and always generate briefing (used for manual triggers)
   */
  async processMeetingBriefing(item: BriefingQueueItem, filePath: string, bypassFilter: boolean = false): Promise<void> {
    const { event: e, anchor, participants, noteTitle } = item;

    // Normalize/clean participants (dedupe + exclude rooms/resources + apply user excludes)
    const cleanedParticipants = this.filterParticipants(participants || []);

    console.log(
      `[GSD] Processing briefing for: "${e.summary}" with ${cleanedParticipants.length} participants`
    );

    // Filter to ONLY external participants (not your domain)
    const externalParticipants = cleanedParticipants.filter((p) => {
      const email = (p.email || "").toLowerCase();
      return !email.includes(this.settings.yourDomain.toLowerCase());
    });

    console.log(`[GSD] External participants: ${externalParticipants.length} (yourDomain: ${this.settings.yourDomain})`);

    // Skip briefing for purely internal meetings without attachments
    const hasAttachments = e.attachments && e.attachments.length > 0;
    if (externalParticipants.length === 0 && !hasAttachments) {
      console.log(`[GSD] Skipping briefing for "${e.summary}" - internal meeting with no attachments`);
      return;
    }

    // Only create People notes for "small" meetings (cap = Max Listed Participants).
    // Note: we apply the cap to the full (filtered+deduped) participant list to avoid creating
    // lots of People notes for very large meetings.
    const cap = this.settings.maxListedParticipants;
    const shouldCreatePeopleNotes = cap <= 0 || cleanedParticipants.length <= cap;
    if (shouldCreatePeopleNotes) {
      await this.ensureExternalPeopleNotes(externalParticipants);
    } else {
      console.log(
        `[GSD] Skipping People note creation for "${e.summary}" - ${cleanedParticipants.length} participants exceeds cap=${cap}`
      );
    }

    const description = e.description || "";
    const attendeesText = externalParticipants
      .map((p) => p.displayName || p.email)
      .join(", ");

    // Step A: Use AI filter to determine if briefing is needed (unless bypassed)
    let isImportant = "NO";

    if (bypassFilter) {
      console.log(`[GSD] Bypassing filter for "${e.summary}" (manual trigger)`);
      isImportant = "YES";
    } else {
      const filterPrompt = this.settings.prompts.meetingFilter
        .replace("{title}", e.summary || "")
        .replace("{attendees}", attendeesText)
        .replace("{description}", description.substring(0, 500).replace(/\n/g, " "));

      try {
        console.log(`[GSD] Calling filter for "${e.summary}" with model: ${this.settings.models.filterModel}`);
        const filterCfg = this.settings.generationConfigs?.meetingFilter;
        const filterRes = await this.aiService.callModel(
          "You are a filter.",
          filterPrompt,
          this.settings.models.filterModel,
          {
            useSearch: false,
            temperature: filterCfg?.temperature,
            thinkingBudget: filterCfg?.thinkingBudget ?? undefined,
          }
        );
        console.log(`[GSD] Filter response for "${e.summary}": ${filterRes}`);
        if (filterRes && filterRes.includes("YES")) {
          isImportant = "YES";
        }
      } catch (error: unknown) {
        handleError("Meeting filter failed", error, {
          silent: true, // Expected to fail sometimes
        });
      }

      console.log(`[GSD] Meeting "${e.summary}" importance: ${isImportant}`);
    }

    if (isImportant === "YES") {
      // Show researching indicator
      const loadingBlock = `\n\t- [!working] ⏳ Researching context & attachments...`;
      await this.vaultSearch.insertAfterLineContaining(filePath, anchor, loadingBlock);

      // Gather context
      const { vaultContext, attachmentContext, previousMeetingsContext } = await this.gatherContext(
        e,
        externalParticipants,
        noteTitle
      );

      // If the meeting title is ambiguous and we have zero usable context, don't hallucinate.
      // This is especially important for internal recurring meetings with acronyms (e.g. "Komu").
      const title = (e.summary || "").trim();
      const descriptionTrimmed = (e.description || "").trim();
      const hasAnyContext =
        !!(vaultContext && vaultContext.trim()) ||
        !!(attachmentContext && attachmentContext.trim()) ||
        !!(previousMeetingsContext && previousMeetingsContext.trim());
      // If we have no usable context and no external attendees, a "briefing" would be pure guesswork.
      // Be transparent instead of hallucinating.
      if (!hasAnyContext && externalParticipants.length === 0 && descriptionTrimmed.length < 20) {
        const fallback = this.buildFallbackBriefing(title, attendeesText);
        const finalBlock = `\n\t- ${fallback}`;
        const oldBlock = `\n\t- [!working] ⏳ Researching context & attachments...`;
        await this.vaultSearch.replaceInFile(filePath, oldBlock, finalBlock);
        return;
      }

      // Get feedback context
      let feedbackContext = "";
      if (this.feedback) {
        feedbackContext = await this.feedback.getFeedbackSummary("briefing");
      }

      // Generate briefing
      const briefingPrompt = this.settings.prompts.meetingBriefing
        .replace("{title}", e.summary || "")
        .replace("{time}", moment(e.start.dateTime).format("HH:mm"))
        .replace("{attendees}", attendeesText)
        .replace("{description}", description)
        .replace(
          "{vaultContext}",
          vaultContext ? "**Vault Context:**\n" + vaultContext : ""
        )
        .replace(
          "{attachmentContext}",
          attachmentContext ? "**Attachments:**\n" + attachmentContext : ""
        )
        .replace(
          "{previousMeetingsContext}",
          previousMeetingsContext || ""
        ) + feedbackContext;

      const cfg = this.settings.generationConfigs?.meetingBriefing;
      const response = await this.aiService.callModel(
        "You are an elite Chief of Staff preparing briefings for a CEO. Use vault context + attachments + prior meetings first, and use Google Search for missing PUBLIC facts about external attendees/companies. Never invent. If you pull a specific fact from the web (numbers/dates/roles), include a short source hint in parentheses (e.g., source: company.com, 2024). Then write with extreme density - every word must carry insight.",
        briefingPrompt,
        this.settings.models.briefingModel,
        {
          useSearch: true, // Enable Google Search to enrich the briefing with public context.
          temperature: cfg?.temperature,
          thinkingBudget: cfg?.thinkingBudget ?? undefined,
        }
      );

      // Update file with result
      if (response) {
        // Return markdown response directly
        // Clean up the response - remove any JSON formatting if present
        let briefingText = response.trim();
        
        // Remove markdown code blocks if present
        briefingText = briefingText.replace(/```json\s*/g, "").replace(/```\s*/g, "");
        
        // Try to extract JSON if it's wrapped, otherwise use as-is
        const jsonMatch = briefingText.match(/\{\s*"briefing"\s*:\s*"([^"]+)"\s*\}/);
        if (jsonMatch && jsonMatch[1]) {
          briefingText = jsonMatch[1].trim();
        } else {
          // Use response as-is, but clean up extra whitespace
          briefingText = briefingText
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line.length > 0)
            .join(" ");
        }

        if (briefingText) {
          // Safety check: if the output doesn't reference the meeting title or any external attendee,
          // it's likely ungrounded/hallucinated. Replace with a transparent fallback.
          const isGrounded = this.isBriefingLikelyGrounded(briefingText, title, externalParticipants);
          const finalText = isGrounded ? briefingText : this.buildFallbackBriefing(title, attendeesText);

          const finalBlock = `\n\t- ${finalText}`;
          const oldBlock = `\n\t- [!working] ⏳ Researching context & attachments...`;
          await this.vaultSearch.replaceInFile(filePath, oldBlock, finalBlock);
        } else {
          // Remove loading indicator if no briefing text
          const oldBlock = `\n\t- [!working] ⏳ Researching context & attachments...`;
          await this.vaultSearch.replaceInFile(filePath, oldBlock, "");
        }
      } else {
        // Remove loading indicator if failed
        const oldBlock = `\n\t- [!working] ⏳ Researching context & attachments...`;
        await this.vaultSearch.replaceInFile(filePath, oldBlock, "");
      }
    }
  }

  /**
   * Trigger briefing for the current cursor line
   */
  async triggerBriefingForCurrentLine(): Promise<void> {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      console.error("[GSD] No active file");
      return;
    }

    const filePath = activeFile.path;

    // Get cursor line from editor
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView || !activeView.editor) {
      console.error("[GSD] No active editor");
      return;
    }

    const editor = activeView.editor;
    const cursor = editor.getCursor();
    const currentLine = editor.getLine(cursor.line);

    // Parse meeting link from line
    const linkMatch = currentLine.match(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/);
    if (!linkMatch) {
      console.error("[GSD] No meeting link found on current line");
      return;
    }

    const meetingPath = linkMatch[0];

    // Extract event ID - support longer IDs with more characters
    const idMatch = linkMatch[1].match(/~([a-zA-Z0-9_-]+)$/);
    if (!idMatch) {
      console.error("[GSD] Could not extract event ID from link");
      return;
    }

    const eventId = idMatch[1];

    // Try to extract date from the daily note filename (format: YYYY-MM-DD.md)
    const dateMatch = activeFile.basename.match(/(\d{4}-\d{2}-\d{2})/);
    let targetDate = moment();
    if (dateMatch) {
      targetDate = moment(dateMatch[1], "YYYY-MM-DD");
      console.log(`[GSD] Using date from filename: ${dateMatch[1]}`);
    }

    // Fetch events for the target day
    const start = targetDate.clone().startOf("day");
    const end = targetDate.clone().endOf("day");
    const events = await this.getCalendarEvents(start, end);

    console.log(`[GSD] Searching for event ID: ${eventId} among ${events.length} events`);

    // Try exact match first, then partial match
    let event = events.find((e) => e.id === eventId);
    if (!event) {
      // Try partial match (event ID might be truncated in filename)
      event = events.find((e) => e.id && (e.id.includes(eventId) || eventId.includes(e.id)));
    }
    
    if (!event) {
      console.error("[GSD] Could not find event with ID", eventId);
      console.log("[GSD] Available event IDs:", events.map(e => e.id).join(", "));
      return;
    }

    // Get participants
    const participantsFiltered = this.filterParticipants(event.attendees || []);

    // Process this event (bypass filter for manual triggers)
    const queueItem: BriefingQueueItem = {
      event: event,
      anchor: meetingPath,
      participants: participantsFiltered,
      noteTitle: event.summary || "(No title)",
    };

    await this.processMeetingBriefing(queueItem, filePath, true);
  }

  /**
   * Gather vault and attachment context for briefing
   */
  private async gatherContext(
    event: CalendarEvent,
    externalParticipants: Attendee[],
    noteTitle: string
  ): Promise<{ vaultContext: string; attachmentContext: string; previousMeetingsContext: string }> {
    let vaultContext = "";
    let attachmentContext = "";
    let previousMeetingsContext = "";

    const allFiles = this.app.vault.getMarkdownFiles();

    // Process attachments
    if (event.attachments && this.settings.appsScriptUrl) {
      for (const att of event.attachments) {
        const fileId = this.googleServices.extractDriveFileId(att.fileUrl);
        if (fileId) {
          const content = await this.googleServices.getDocContent(fileId);
          if (content) {
            attachmentContext += `\n-- Attachment: ${att.title} --\n${content.substring(0, 3000)}\n`;
          }
        }
      }
    }

    // Search vault for People notes
    for (const p of externalParticipants) {
      const name = p.displayName || this.humanizeEmail(p.email);
      const hit = allFiles.find(
        (f) => f.basename.toLowerCase() === name.toLowerCase()
      );
      if (hit) {
        const content = await this.app.vault.read(hit);
        vaultContext += `\n-- Note: [[${hit.path.replace(".md", "")}]] --\n${content.substring(0, 1000)}\n`;
      }
    }

    // Search vault for company mentions in title
    const titleParts = noteTitle.split(/[:\-]/);
    for (const part of titleParts) {
      const cleanPart = part.trim();
      if (cleanPart.length > 3 && !["Meeting", "Sync", "Call"].includes(cleanPart)) {
        const hit = allFiles.find((f) =>
          f.basename.toLowerCase().includes(cleanPart.toLowerCase())
        );
        if (hit) {
          const content = await this.app.vault.read(hit);
          vaultContext += `\n-- Note: [[${hit.path.replace(".md", "")}]] --\n${content.substring(0, 1000)}\n`;
        }
      }
    }

    // Search for previous meetings with same people
    previousMeetingsContext = await this.searchPreviousMeetings(externalParticipants, allFiles);

    return { vaultContext, attachmentContext, previousMeetingsContext };
  }

  /**
   * Search for previous meetings with the same participants
   */
  private async searchPreviousMeetings(
    participants: Attendee[],
    allFiles: TFile[]
  ): Promise<string> {
    let context = "";
    const meetingFiles = allFiles.filter((f) =>
      f.path.startsWith(this.settings.meetingsFolder + "/")
    );

    // Get participant names for matching
    const participantNames = participants.map((p) =>
      (p.displayName || this.humanizeEmail(p.email)).toLowerCase()
    );

    // Search meeting notes for mentions of these participants
    const relevantMeetings: Array<{ file: TFile; date: string; content: string }> = [];

    for (const file of meetingFiles) {
      try {
        const content = await this.app.vault.read(file);
        const contentLower = content.toLowerCase();

        // Check if any participant is mentioned
        const mentionsParticipant = participantNames.some(
          (name) => contentLower.includes(name) || file.basename.toLowerCase().includes(name)
        );

        if (mentionsParticipant) {
          // Extract date from filename or frontmatter
          const dateMatch = file.basename.match(/(\d{4}-\d{2}-\d{2})/);
          const date = dateMatch ? dateMatch[1] : file.stat.ctime.toString();

          relevantMeetings.push({
            file,
            date,
            content: content.substring(0, 1500),
          });
        }
      } catch (error: unknown) {
        // Skip files that can't be read - expected behavior
        handleError("Failed to read file for meeting context", error, {
          silent: true,
          additionalContext: { filePath: file.path },
        });
      }
    }

    // Sort by date (most recent first) and take top 3
    relevantMeetings.sort((a, b) => b.date.localeCompare(a.date));
    const topMeetings = relevantMeetings.slice(0, 3);

    if (topMeetings.length > 0) {
      context = "\n**Previous Meetings:**\n";
      for (const meeting of topMeetings) {
        // Extract key points from meeting content
        const lines = meeting.content.split("\n").filter((line) => {
          const trimmed = line.trim();
          return (
            trimmed.length > 20 &&
            !trimmed.startsWith("---") &&
            !trimmed.startsWith("tags:") &&
            !trimmed.startsWith("created:")
          );
        });
        const summary = lines.slice(0, 5).join("\n");
        context += `\n-- [[${meeting.file.path.replace(".md", "")}]] (${meeting.date}) --\n${summary}\n`;
      }
    }

    return context;
  }

  /**
   * Ensure People notes exist for external participants
   */
  private async ensureExternalPeopleNotes(participants: Attendee[]): Promise<void> {
    // Defensive: ensure no rooms/resources slip through
    const cleaned = this.filterParticipants(participants || []);

    for (const p of cleaned) {
      const email = p.email;
      const name = p.displayName || this.humanizeEmail(email);
      const peoplePath = `${this.settings.peopleFolder}/${name}.md`;

      const existingFile = this.app.vault.getAbstractFileByPath(peoplePath);
      if (existingFile) continue;

      // Check by email
      if (email) {
        const existingByEmail = await this.vaultSearch.findPeopleNoteByEmail(email);
        if (existingByEmail) continue;
      }

      // Create new note
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

        // Trigger research if person research is available
        if (this.personResearch) {
          this.personResearch.researchPerson(peoplePath, { force: false }).catch((error: unknown) =>
            handleError(`Research failed for ${name}`, error, {
              silent: true, // Background operation, don't spam user
            })
          );
        }
      } catch (error: unknown) {
        handleError(`Failed to create note for ${name}`, error, {
          additionalContext: { name, peoplePath },
        });
      }
    }
  }

  /**
   * Filter + dedupe participants.
   * - Applies user excludes (excludeEmails/excludeNames)
   * - Excludes Google "resource calendars" (rooms/equipment)
   * - Excludes likely room naming patterns (e.g., P9-2-2.05)
   * - Dedupes by email (preferred) or name fallback
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

      // Heuristic: office room names like "P9-2-2.05" (user explicitly requested P9-2*)
      if (this.isLikelyRoomName(rawName || "")) return false;

      return true;
    });

    // Dedupe
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

  private isLikelyRoomName(name: string): boolean {
    const n = (name || "").trim().toLowerCase();
    if (!n) return false;

    // Matches patterns like "P9-2", "P9-2-2.05", etc.
    if (/^p\d+-\d+/.test(n)) return true;
    return false;
  }

  /**
   * Get calendar events (delegates to calendar plugin)
   */
  private async getCalendarEvents(start: any, end: any): Promise<CalendarEvent[]> {
    const plugin = (this.app as any).plugins?.plugins?.["google-calendar"];
    if (!plugin?.api?.getEvents) return [];
    return plugin.api.getEvents({ startDate: start, endDate: end });
  }

  /**
   * Humanize email to name
   */
  private humanizeEmail(email: string): string {
    return email
      .split("@")[0]
      .split(/[._]/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }

  /**
   * Heuristic: detect short/acronym meeting titles that are likely internal shorthand.
   * For these, we should not do speculative external "research" unless we have strong context.
   */
  private isAmbiguousMeetingTitle(title: string): boolean {
    const t = (title || "").trim();
    if (!t) return true;
    // Very short single-token words (e.g. "Komu", "QBR", "LT") are frequently internal shorthand.
    if (!/\s/.test(t) && t.length <= 5) return true;
    // All-caps acronyms up to 8 chars.
    if (t.length <= 8 && t === t.toUpperCase() && /^[A-Z0-9]+$/.test(t)) return true;
    return false;
  }

  /**
   * Simple grounding check: require that the generated briefing mentions either the meeting title
   * (or part of it), or at least one external attendee by (display) name.
   */
  private isBriefingLikelyGrounded(
    briefing: string,
    title: string,
    externalParticipants: Attendee[]
  ): boolean {
    const b = (briefing || "").toLowerCase();
    if (!b) return false;

    const t = (title || "").trim().toLowerCase();
    if (t && t.length >= 3) {
      // Check any meaningful token from the title (avoid stop-words)
      const tokens = t
        .split(/[\s\-:()\/]+/)
        .map((x) => x.trim())
        .filter((x) => x.length >= 3 && !["sync", "call", "meeting", "catch", "catchup", "update"].includes(x));
      if (tokens.some((tok) => b.includes(tok))) return true;
    }

    for (const p of externalParticipants || []) {
      const name = (p.displayName || "").trim().toLowerCase();
      if (name && name.length >= 3 && b.includes(name)) return true;
    }

    return false;
  }

  /**
   * Transparent fallback for cases where we can't produce a reliable briefing.
   */
  private buildFallbackBriefing(title: string, attendeesText: string): string {
    const safeTitle = (title || "(no title)").trim();
    const safeAttendees = (attendeesText || "").trim();
    if (safeAttendees) {
      return `I couldn't identify what "${safeTitle}" refers to from your vault/attachments/previous meetings. External attendees: ${safeAttendees}.`;
    }
    return `I couldn't identify what "${safeTitle}" refers to from your vault/attachments/previous meetings.`;
  }
}

