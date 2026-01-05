import { App, TFile, Notice, Modal, Setting } from "obsidian";
import type {
  PluginSettings,
  CalendarEvent,
  InboxItem,
  InboxContentType,
  InboxRouteDestination,
  InboxURIParams,
  InboxRoutingRule,
  InboxFormatStyle,
} from "../types";
import { CalendarService } from "../services/calendar";
import { handleError, handleErrorWithDefault } from "../utils/error-handler";
import { GoogleServices } from "../services/google-services";
import { AIService } from "../services/ai-service";
import { VaultSearchService } from "../services/vault-search";
import { IndexService } from "../services/index-service";
import { ReferenceAction } from "./reference";

const moment = (window as any).moment;

type InboxRouteDecision = {
  destination: InboxRouteDestination;
  format: Exclude<InboxFormatStyle, "auto">;
  addDueDate: boolean;
  dueDateOffset?: number;
  ruleId?: string;
};

type SummarizeAPI = {
  summarizeUrl: (
    url: string,
    options?: {
      length?: string;
      language?: string;
      model?: string;
      prompt?: string;
      onStream?: (chunk: string) => void;
    }
  ) => Promise<string>;
  isConfigured: () => boolean;
};

class DailyNoteNotReadyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DailyNoteNotReadyError";
  }
}

/**
 * Inbox Action
 * Processes incoming content from iPhone Shortcuts, Share menu, or manual input
 * Routes to appropriate destination (meeting follow-up or daily thoughts)
 */
export class InboxAction {
  private app: App;
  private settings: PluginSettings;
  private calendarService: CalendarService;
  private googleServices: GoogleServices;
  private aiService: AIService;
  private vaultSearch: VaultSearchService;
  private indexService: IndexService;
  private referenceAction: ReferenceAction;

  constructor(
    app: App,
    settings: PluginSettings,
    calendarService: CalendarService,
    googleServices: GoogleServices,
    aiService: AIService,
    vaultSearch: VaultSearchService,
    indexService: IndexService
  ) {
    this.app = app;
    this.settings = settings;
    this.calendarService = calendarService;
    this.googleServices = googleServices;
    this.aiService = aiService;
    this.vaultSearch = vaultSearch;
    this.indexService = indexService;
    this.referenceAction = new ReferenceAction(app, settings, indexService, aiService);
  }

  /**
   * Update settings reference
   */
  updateSettings(settings: PluginSettings): void {
    this.settings = settings;
    this.referenceAction.updateSettings(settings);
  }

  // ============================================================================
  // Main Entry Point
  // ============================================================================

  /**
   * Process an inbox item from URI parameters
   * 
   * Strategy: Capture FAST with deterministic formatting first, then enhance async.
   * This ensures mobile captures work reliably even if AI/calendar services are slow.
   */
  async processInboxItem(params: InboxURIParams): Promise<void> {
    if (!this.settings.inbox.enabled) {
      new Notice("GetShitDone Inbox is disabled");
      return;
    }

    const content = params.content ? decodeURIComponent(params.content) : "";
    if (!content.trim()) {
      new Notice("No content to capture");
      return;
    }

    console.log(`[GSD Inbox] Processing: "${content.substring(0, 50)}..."`);

    // Create inbox item
    const item: InboxItem = {
      content: content.trim(),
      type: this.parseContentType(params.type),
      source: this.parseSource(params.source),
      timestamp: moment().format("YYYY-MM-DD HH:mm"),
    };

    // Check for trigger phrases FIRST (sync, but quick string check)
    // These are explicit user commands that should be handled specially
    // Priority: reference > followup > research

    // Check reference trigger first (Ref: https://...)
    if (this.settings.reference.enabled) {
      const refUrl = this.referenceAction.detectReferenceTrigger(item.content);
      if (refUrl) {
        this.handleReferenceTrigger(item, refUrl).catch((error: unknown) => {
          handleError("Inbox: Reference trigger failed", error, {
            showNotice: true,
            noticeMessage: "Reference save failed - check console for details",
          });
        });
        return;
      }
    }

    if (this.settings.inbox.triggers.enabled) {
      const trigger = this.detectTriggerPhrase(item.content);
      if (trigger === "followup") {
        // "Follow up X" is an explicit command - handle it synchronously
        // since it needs to format the task properly
        try {
          await this.handleFollowupTrigger(item);
        } catch (error: unknown) {
          handleError("Inbox: Follow-up trigger failed", error, {
            showNotice: true,
            noticeMessage: "Follow-up failed",
          });
        }
        return;
      } else if (trigger === "research") {
        // "Research X" is an explicit command - handle it (will show its own notice)
        this.handleResearchTrigger(item).catch((error: unknown) => {
          handleError("Inbox: Research trigger failed", error, {
            showNotice: true,
            noticeMessage: "Research failed - check console for details",
          });
        });
        new Notice("Starting research...");
        return;
      }
    }

    // =========================================================================
    // FAST PATH: Deterministic capture (no AI, no heavy file operations)
    // =========================================================================
    
    try {
      // Route using ONLY deterministic rules (no AI fallback for fast capture)
      const decision = await this.routeItemDeterministic(item);
      item.destination = decision.destination;

      // Format and append immediately
      await this.appendToDestination(item, decision);

      // Show confirmation immediately
      new Notice(`Captured to ${this.formatDestinationLabel(decision.destination)} ✓`);
      console.log(`[GSD Inbox] Fast capture complete: ${decision.destination}`);
    } catch (error: unknown) {
      const noticeMessage = error instanceof DailyNoteNotReadyError
        ? error.message
        : "Failed to capture inbox item";
      handleError("Inbox: Failed to capture item", error, {
        showNotice: true,
        noticeMessage,
      });
      return;
    }

    // =========================================================================
    // ASYNC ENHANCEMENT: Meeting context, entity detection, etc.
    // These run in the background and don't block the capture confirmation.
    // =========================================================================
    
    this.enhanceInboxItemAsync(item).catch((error: unknown) => {
      // Log but don't show notice - the capture already succeeded
      console.log("[GSD Inbox] Async enhancement failed (capture still succeeded):", error);
    });
  }

  /**
   * Deterministic routing - fast, no AI, no file operations
   * Used for immediate capture; AI routing can enhance later if needed.
   */
  private async routeItemDeterministic(item: InboxItem): Promise<InboxRouteDecision> {
    return this.getRoutingDecision(item, { allowAI: false });
  }

  /**
   * Async enhancement of inbox item after initial capture
   * Runs in background - doesn't block the user
   */
  private async enhanceInboxItemAsync(item: InboxItem): Promise<void> {
    // Try to detect current meeting for context (useful for later reference)
    try {
      const currentMeeting = await this.getCurrentMeeting();
      if (currentMeeting) {
        console.log(`[GSD Inbox] Async: detected meeting context "${currentMeeting.summary}"`);
        // Could potentially update the note with meeting context here
        // For now, just log it - the fast capture already worked
      }
    } catch (error: unknown) {
      // Silent fail - meeting detection is optional enhancement
      console.log("[GSD Inbox] Async: meeting detection failed (non-critical)");
    }

    // Smart suggestions / entity detection runs async but doesn't modify the note
    // (The modal workflow doesn't work well async, so we skip it for now)
    // Future: could auto-add wikilinks without prompting
  }

  // ============================================================================
  // Trigger Phrase Detection
  // ============================================================================

  /**
   * Detect trigger phrases at the start of content
   * Returns "research", "followup", or null
   * Priority: followup > research (checked in processInboxItem)
   */
  private detectTriggerPhrase(content: string): "research" | "followup" | null {
    const normalized = this.normalizeTriggerContent(content);
    const followupMatch = this.getLeadingPhraseMatch(
      normalized,
      this.settings.inbox.triggers.followupPhrases
    );
    if (followupMatch) {
      return "followup";
    }

    const researchMatch = this.getLeadingPhraseMatch(
      normalized,
      this.settings.inbox.triggers.researchPhrases
    );
    if (researchMatch) {
      return "research";
    }

    return null;
  }

  // ============================================================================
  // Natural Language Date Parsing
  // ============================================================================

  /**
   * Parse natural language date phrases and return YYYY-MM-DD format
   * Handles: tomorrow, next week, next Monday, in 3 days, on 2025-12-23, etc.
   */
  private parseNaturalLanguageDate(content: string): string | null {
    const lower = content.toLowerCase();
    const now = moment();

    // "tomorrow" → +1 day
    if (lower.includes("tomorrow")) {
      return now.clone().add(1, "day").format("YYYY-MM-DD");
    }

    // "next week" → +7 days (or next Monday)
    if (lower.includes("next week")) {
      const nextWeek = now.clone().add(7, "days");
      // If today is Monday-Thursday, go to next Monday; otherwise add 7 days
      if (now.day() >= 1 && now.day() <= 4) {
        const daysUntilMonday = (8 - now.day()) % 7 || 7;
        return now.clone().add(daysUntilMonday, "days").format("YYYY-MM-DD");
      }
      return nextWeek.format("YYYY-MM-DD");
    }

    // "next Monday/Tuesday/etc" → next occurrence of that weekday
    const weekdays = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
    for (let i = 0; i < weekdays.length; i++) {
      if (lower.includes(`next ${weekdays[i]}`)) {
        const targetDay = i === 0 ? 1 : i + 1; // moment uses 0=Sunday, 1=Monday
        const currentDay = now.day();
        let daysToAdd = targetDay - currentDay;
        if (daysToAdd <= 0) daysToAdd += 7; // Next week
        return now.clone().add(daysToAdd, "days").format("YYYY-MM-DD");
      }
    }

    // "in [N] days" → +N days
    const inDaysMatch = lower.match(/in\s+(\d+)\s+days?/);
    if (inDaysMatch) {
      const days = parseInt(inDaysMatch[1], 10);
      return now.clone().add(days, "days").format("YYYY-MM-DD");
    }

    // "on [date]" → parse specific date formats
    const onDateMatch = lower.match(/on\s+(\d{4}-\d{2}-\d{2})/); // YYYY-MM-DD
    if (onDateMatch) {
      return onDateMatch[1];
    }

    const onDateMatch2 = lower.match(/on\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/); // MM/DD/YYYY
    if (onDateMatch2) {
      const month = parseInt(onDateMatch2[1], 10);
      const day = parseInt(onDateMatch2[2], 10);
      const year = parseInt(onDateMatch2[3], 10);
      return moment(`${year}-${month}-${day}`, "YYYY-M-D").format("YYYY-MM-DD");
    }

    // Default: use settings default
    return null;
  }

  // ============================================================================
  // Entity Extraction
  // ============================================================================

  /**
   * Extract people and organizations mentioned in content
   * Returns array of { type: "person" | "org", name: string, path: string }
   *
   * Uses IndexService for O(n) lookup where n = words in content (not files in vault)
   */
  private async extractEntities(content: string): Promise<Array<{ type: "person" | "org"; name: string; path: string }>> {
    try {
      return this.indexService.findEntitiesInContent(content);
    } catch (error: unknown) {
      console.log("[GSD Inbox] Entity extraction failed:", error);
      return [];
    }
  }

  /**
   * Detect entity mentions for smart suggestions
   * Similar to extractEntities but returns simplified format
   */
  private async detectEntityMentions(content: string): Promise<Array<{ type: "person" | "org"; name: string; notePath: string }>> {
    const entities = await this.extractEntities(content);
    return entities.map(e => ({
      type: e.type,
      name: e.name,
      notePath: e.path.replace(".md", ""), // Remove .md extension for wikilinks
    }));
  }

  /**
   * Format content with entity wikilinks
   */
  private formatWithEntityLinks(content: string, entities: Array<{ type: "person" | "org"; name: string; path: string }>): string {
    let formatted = content;
    
    // Sort by length (longest first) to avoid partial matches
    const sortedEntities = [...entities].sort((a, b) => b.name.length - a.name.length);

    for (const entity of sortedEntities) {
      const folder = entity.type === "person" ? this.settings.peopleFolder : this.settings.organizationsFolder;
      const wikilink = `[[${folder}/${entity.name}|${entity.name}]]`;
      
      // Replace name with wikilink (case-insensitive, whole word)
      const regex = new RegExp(`\\b${entity.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
      formatted = formatted.replace(regex, wikilink);
    }

    return formatted;
  }

  // ============================================================================
  // Reference Trigger Handler
  // ============================================================================

  /**
   * Handle "Ref:" trigger phrase - process URL into reference note
   */
  private async handleReferenceTrigger(item: InboxItem, url: string): Promise<void> {
    console.log(`[GSD Inbox] Reference trigger detected: ${url}`);

    // Process URL through reference action
    const notePath = await this.referenceAction.processUrl(url);
    if (!notePath) {
      return; // Error already shown by referenceAction
    }

    // Update daily note with wikilink to reference
    if (this.settings.reference.dailyNoteLink) {
      // The original line is the full content with trigger
      const originalLine = item.content;

      // Get reference title from the note path
      const fileName = notePath.split("/").pop()?.replace(".md", "") || "";
      const title = fileName
        .replace(/-/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());

      // Read the created note to get the primary tag
      const file = this.app.vault.getAbstractFileByPath(notePath);
      let primaryTag = "uncategorized";
      if (file && file instanceof TFile) {
        const content = await this.app.vault.read(file);
        const tagMatch = content.match(/tags:\s*\n\s*-\s*([^\n]+)/);
        if (tagMatch) {
          primaryTag = tagMatch[1].trim();
        }
      }

      // Try to update daily note (replace trigger line with wikilink)
      const updated = await this.referenceAction.updateDailyNoteWithReference(
        originalLine,
        notePath,
        title,
        primaryTag
      );

      if (!updated) {
        // If we couldn't find the original line, append to daily note
        const dailyNotePath = await this.getDailyNotePath();
        if (dailyNotePath) {
          const dailyFile = this.app.vault.getAbstractFileByPath(dailyNotePath);
          if (dailyFile && dailyFile instanceof TFile) {
            const dailyContent = await this.app.vault.read(dailyFile);
            const timestamp = moment().format(this.settings.inbox.formatting.timeFormat);
            const wikilink = `[[${notePath.replace(".md", "")}|${title}]]`;
            const newLine = `- ${timestamp} ${wikilink} #${primaryTag}`;
            const newContent = this.appendToThoughtsSection(dailyContent, newLine);
            await this.app.vault.modify(dailyFile, newContent);
          }
        }
      }
    }
  }

  // ============================================================================
  // Research Trigger Handler
  // ============================================================================

  /**
   * Handle "Research" trigger phrase
   */
  private async handleResearchTrigger(item: InboxItem): Promise<void> {
    // Strip trigger phrase from content
    let researchQuery = this.stripLeadingTriggerPhrase(
      item.content,
      this.settings.inbox.triggers.researchPhrases,
      { stripTrailingColon: true }
    );

    if (!researchQuery) {
      new Notice("No research query provided");
      return;
    }

    new Notice("Starting deep research...");

    try {
      // Load research prompt
      const researchPrompt = this.settings.prompts.research || 
        `Research the following topic deeply using web search. Provide a comprehensive summary with key facts, insights, and relevant information.

Topic: {query}

Provide a well-structured research summary.`;

      const prompt = researchPrompt.replace(/{query}/g, researchQuery);

      // Call AI with max effort
      const researchModel = this.settings.models.personResearchModel || this.settings.models.orgResearchModel || this.settings.models.briefingModel;
      const result = await this.aiService.callModel(
        "You are a research assistant. Perform deep research using web search.",
        prompt,
        researchModel,
        {
          useSearch: true,
          thinkingBudget: "high",
          temperature: 0.2,
        }
      );

      if (!result) {
        new Notice("Research failed - no response from AI");
        return;
      }

      // Format as thought in daily note
      const dailyNotePath = await this.getDailyNotePath();
      if (!dailyNotePath) {
        new Notice("Could not find today's daily note");
        return;
      }

      const file = this.app.vault.getAbstractFileByPath(dailyNotePath);
      if (!file || !(file instanceof TFile)) {
        new Notice("Daily note not found");
        return;
      }

      const content = await this.app.vault.read(file);
      const timestamp = moment().format(this.settings.inbox.formatting.timeFormat);
      const formatted = `- ${timestamp} **Research: ${researchQuery}**\n\t${result.split("\n").join("\n\t")}`;
      const newContent = this.appendToThoughtsSection(content, formatted);
      await this.app.vault.modify(file, newContent);

      new Notice("Research completed and added to daily note");
    } catch (error: unknown) {
      handleError("Inbox: Research failed", error, {
        showNotice: true,
        noticeMessage: "Research failed - check console for details",
      });
    }
  }

  // ============================================================================
  // Follow-up Trigger Handler
  // ============================================================================

  /**
   * Handle "Follow up" trigger phrase
   */
  private async handleFollowupTrigger(item: InboxItem): Promise<void> {
    // Strip trigger phrase from content
    let followupContent = this.stripLeadingTriggerPhrase(
      item.content,
      this.settings.inbox.triggers.followupPhrases,
      { stripTrailingColon: true }
    );

    if (!followupContent) {
      new Notice("No follow-up content provided");
      return;
    }

    // Extract due date (before entity extraction to avoid interfering with date parsing)
    const dueDate = this.parseNaturalLanguageDate(followupContent) ||
      moment()
        .add(this.settings.inbox.formatting.defaultDueDateOffset, "days")
        .format("YYYY-MM-DD");

    // Remove any existing due date from content to avoid duplicates (handle multi-line)
    followupContent = followupContent
      .split("\n")
      .map(line => this.stripDueDateMarkers(line))
      .filter(line => line.length > 0)
      .join("\n")
      .trim();

    // Extract entities
    const entities = await this.extractEntities(followupContent);
    
    // Format content with entity links
    let taskContent = this.formatWithEntityLinks(followupContent, entities);

    // Remove leading "- [ ]" if already present
    taskContent = this.stripTaskPrefix(taskContent);

    // Remove any existing due date that might have been added by formatWithEntityLinks (handle multi-line)
    taskContent = taskContent
      .split("\n")
      .map(line => this.stripDueDateMarkers(line))
      .filter(line => line.length > 0)
      .join("\n")
      .trim();

    // Format as task - if multi-line, only add due date to the first line
    const taskPrefix = this.settings.inbox.formatting.taskPrefix;
    const dueDateEmoji = this.settings.inbox.formatting.dueDateEmoji;

    const formatted = taskContent.includes("\n")
      ? (() => {
          const lines = taskContent.split("\n");
          return `${taskPrefix} ${lines[0]} ${dueDateEmoji} ${dueDate}\n${lines.slice(1).map(l => `\t${l}`).join("\n")}`;
        })()
      : `${taskPrefix} ${taskContent} ${dueDateEmoji} ${dueDate}`;

    // Append to destination
    const dailyNotePath = await this.getDailyNotePath();
    if (!dailyNotePath) {
      new Notice("Could not find today's daily note");
      return;
    }

    const file = this.app.vault.getAbstractFileByPath(dailyNotePath);
    if (!file || !(file instanceof TFile)) {
      new Notice("Daily note not found");
      return;
    }

    const content = await this.app.vault.read(file);
    
    // If in meeting, add as meeting follow-up; otherwise add to thoughts section
    if (item.meetingContext) {
      const meetingFormatted = `\t${formatted}`;
      const newContent = this.insertAfterMeetingLine(content, item.meetingContext, meetingFormatted);
      await this.app.vault.modify(file, newContent);
      new Notice(`Follow-up task added to meeting "${item.meetingContext.summary}"`);
    } else {
      const newContent = this.appendToThoughtsSection(content, formatted);
      await this.app.vault.modify(file, newContent);
      new Notice(`Follow-up task added to daily thoughts`);
    }
  }

  // ============================================================================
  // Smart Suggestions Modal
  // ============================================================================

  /**
   * Show smart suggestion modal for adding info to entity notes
   */
  private async showSmartSuggestion(
    item: InboxItem,
    suggestions: Array<{ type: "person" | "org"; name: string; notePath: string }>
  ): Promise<void> {
    const modal = new SmartSuggestionModal(
      this.app,
      item,
      suggestions,
      async (selectedEntities, shouldAdd) => {
        if (!shouldAdd) {
          // User declined - proceed with normal routing
          const decision = await this.routeItem(item);
          item.destination = decision.destination;
          try {
            await this.appendToDestination(item, decision);
          } catch (error: unknown) {
            const noticeMessage = error instanceof DailyNoteNotReadyError
              ? error.message
              : "Failed to capture inbox item";
            handleError("Inbox: Failed to capture item", error, {
              showNotice: true,
              noticeMessage,
            });
          }
          return;
        }

        // Add info to selected entity notes
        for (const entity of selectedEntities) {
          const file = this.app.vault.getAbstractFileByPath(`${entity.notePath}.md`);
          if (file && file instanceof TFile) {
            const content = await this.app.vault.read(file);
            const timestamp = moment().format("YYYY-MM-DD HH:mm");
            const infoToAdd = `\n- ${timestamp} ${item.content}`;
            await this.app.vault.modify(file, content + infoToAdd);
          }
        }

        new Notice(`Added information to ${selectedEntities.length} note(s)`);
      }
    );

    modal.open();
  }

  // ============================================================================
  // Routing Engine
  // ============================================================================

  /**
   * Route an inbox item to its destination
   * Uses deterministic rules first, then AI fallback
   */
  private async routeItem(item: InboxItem): Promise<InboxRouteDecision> {
    return this.getRoutingDecision(item, { allowAI: true });
  }

  /**
   * Use Gemini Flash to classify content
   */
  private async routeWithAI(item: InboxItem): Promise<InboxRouteDecision | null> {
    const prompt = this.settings.prompts.inboxRouting
      .replace("{content}", item.content.substring(0, 500))
      .replace("{length}", String(item.content.length))
      .replace("{inMeeting}", item.meetingContext ? "YES" : "NO")
      .replace("{meetingTitle}", item.meetingContext?.summary || "N/A");

    try {
      const cfg = this.settings.generationConfigs?.inboxRouting;
      const result = await this.aiService.callModel(
        "You are a content classifier. Respond with exactly one word.",
        prompt,
        this.settings.models.inboxRoutingModel,
        {
          useSearch: false,
          temperature: cfg?.temperature,
          thinkingBudget: cfg?.thinkingBudget ?? undefined,
        }
      );

      if (!result) return null;

      const classification = result.trim().toUpperCase();
      console.log(`[GSD Inbox] AI classification: ${classification}`);

      switch (classification) {
        case "TASK":
          return {
            destination: item.meetingContext ? "meeting_followup" : "daily_thoughts",
            format: "task",
            addDueDate: true,
          };
        case "MEETING_FOLLOWUP":
          return {
            destination: item.meetingContext ? "meeting_followup" : "daily_thoughts",
            format: "task",
            addDueDate: true,
          };
        case "THOUGHT":
        case "REFERENCE":
          return {
            destination: "daily_thoughts",
            format: "thought",
            addDueDate: false,
          };
        default:
          return null;
      }
    } catch (error: unknown) {
      return handleErrorWithDefault(
        "Inbox: AI routing failed",
        error,
        null
      );
    }
  }

  private async getRoutingDecision(
    item: InboxItem,
    options: { allowAI: boolean }
  ): Promise<InboxRouteDecision> {
    const ruleDecision = this.evaluateRoutingRules(item);
    if (ruleDecision) {
      return ruleDecision;
    }

    if (options.allowAI && this.settings.inbox.routing.aiFallbackEnabled) {
      const model = this.settings.models.inboxRoutingModel || this.settings.models.briefingModel;
      if (model && this.hasApiKeyForModel(model)) {
        const aiDecision = await this.routeWithAI(item);
        if (aiDecision) {
          return aiDecision;
        }
      }
    }

    return this.buildDefaultDecision(item);
  }

  private evaluateRoutingRules(item: InboxItem): InboxRouteDecision | null {
    const rules = this.settings.inbox.routing.rules || [];

    for (const rule of rules) {
      if (!rule || !rule.match || !rule.action) continue;
      if (!rule.enabled) continue;
      if (!this.matchesRule(rule, item)) continue;

      const format = this.resolveFormat(rule.action.format, item);
      const addDueDate = format === "task" ? rule.action.addDueDate : false;

      return {
        destination: rule.action.destination,
        format,
        addDueDate,
        dueDateOffset: rule.action.dueDateOffset,
        ruleId: rule.id,
      };
    }

    return null;
  }

  private matchesRule(rule: InboxRoutingRule, item: InboxItem): boolean {
    const match = rule.match;
    if (!match) return false;
    const content = item.content ?? "";
    const trimmed = content.trim();
    const lower = trimmed.toLowerCase();

    if (match.inMeeting !== undefined) {
      if (match.inMeeting !== Boolean(item.meetingContext)) return false;
    }

    if (match.contentTypes && match.contentTypes.length > 0) {
      if (!match.contentTypes.includes(item.type)) return false;
    }

    if (match.contentStartsWith && match.contentStartsWith.length > 0) {
      const prefixes = match.contentStartsWith
        .map((value) => value.trim())
        .filter((value) => value.length > 0);
      if (!prefixes.some((prefix) => lower.startsWith(prefix.toLowerCase()))) {
        return false;
      }
    }

    if (match.contentIncludes && match.contentIncludes.length > 0) {
      const includes = match.contentIncludes
        .map((value) => value.trim())
        .filter((value) => value.length > 0);
      if (!includes.some((needle) => lower.includes(needle.toLowerCase()))) {
        return false;
      }
    }

    if (match.contentRegex) {
      const flags = match.regexFlags !== undefined ? match.regexFlags : "i";
      try {
        const regex = new RegExp(match.contentRegex, flags);
        if (!regex.test(trimmed)) return false;
      } catch (error) {
        console.log(`[GSD Inbox] Invalid regex in rule "${rule.name}":`, error);
        return false;
      }
    }

    if (match.isUrl !== undefined) {
      if (match.isUrl !== this.isURL(trimmed)) return false;
    }

    if (match.hasTaskCheckbox !== undefined) {
      if (match.hasTaskCheckbox !== this.hasTaskCheckbox(trimmed)) return false;
    }

    if (match.actionItem !== undefined) {
      if (match.actionItem !== this.looksLikeActionItem(trimmed)) return false;
    }

    if (match.minLength !== undefined && trimmed.length < match.minLength) {
      return false;
    }

    if (match.maxLength !== undefined && trimmed.length > match.maxLength) {
      return false;
    }

    return true;
  }

  private resolveFormat(format: InboxFormatStyle, item: InboxItem): "task" | "thought" {
    if (format !== "auto") return format;
    return this.shouldFormatAsTask(item) ? "task" : "thought";
  }

  private buildDefaultDecision(item: InboxItem): InboxRouteDecision {
    const format = this.resolveFormat(this.settings.inbox.routing.defaultFormat, item);
    const addDueDate =
      format === "task" ? this.settings.inbox.routing.defaultAddDueDate : false;

    return {
      destination: this.settings.inbox.routing.defaultDestination,
      format,
      addDueDate,
    };
  }

  private shouldFormatAsTask(item: InboxItem): boolean {
    const isExplicitTask = item.type === "task" || this.hasTaskCheckbox(item.content);
    const isActionItem = this.looksLikeActionItem(item.content);
    return isExplicitTask || isActionItem;
  }

  private hasApiKeyForModel(model: string): boolean {
    if (!model) return false;
    const lower = model.toLowerCase();
    if (lower.startsWith("openrouter:") || lower.includes("/")) {
      return Boolean(this.settings.openrouterApiKey);
    }
    if (lower.startsWith("claude-")) {
      return Boolean(this.settings.anthropicApiKey);
    }
    if (lower.startsWith("gpt-") || lower.startsWith("o1-") || lower.startsWith("o3-")) {
      return Boolean(this.settings.openaiApiKey);
    }
    return Boolean(this.settings.geminiApiKey);
  }

  private hasTaskCheckbox(content: string): boolean {
    const taskPrefix = this.settings.inbox.formatting.taskPrefix.trim();
    if (!taskPrefix) return /^\s*-\s*\[\s*\]/.test(content);
    return content.trim().startsWith(taskPrefix);
  }

  private formatDestinationLabel(destination: InboxRouteDestination): string {
    if (destination === "meeting_followup") {
      return "meeting follow-ups";
    }
    if (destination === "daily_end") {
      return "daily end";
    }
    return "daily thoughts";
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private getLeadingPhraseMatch(content: string, phrases: string[]): string | null {
    const trimmed = content.trim();
    if (!trimmed) return null;
    const cleaned = (phrases || []).map((phrase) => phrase.trim()).filter(Boolean);
    if (cleaned.length === 0) return null;

    const pattern = cleaned
      .sort((a, b) => b.length - a.length)
      .map((phrase) => {
        const escaped = this.escapeRegex(phrase);
        const needsBoundary = /[A-Za-z0-9_]$/.test(phrase);
        return needsBoundary ? `${escaped}\\b` : escaped;
      })
      .join("|");

    const regex = new RegExp(`^(${pattern})`, "i");
    const match = trimmed.match(regex);
    return match ? match[1] : null;
  }

  private stripLeadingPhrase(
    content: string,
    phrases: string[],
    options?: { stripTrailingColon?: boolean }
  ): string {
    const trimmed = content.trim();
    const match = this.getLeadingPhraseMatch(trimmed, phrases);
    if (!match) return trimmed;
    const suffix = options?.stripTrailingColon ? "\\s*:?" : "";
    const needsBoundary = /[A-Za-z0-9_]$/.test(match);
    const boundary = needsBoundary ? "\\b" : "";
    const regex = new RegExp(`^${this.escapeRegex(match)}${boundary}${suffix}\\s*`, "i");
    return trimmed.replace(regex, "").trim();
  }

  private normalizeTriggerContent(content: string): string {
    let normalized = content.trim();
    if (!normalized) return normalized;

    // Remove common task/checkbox prefixes and bullets
    normalized = this.stripTaskPrefix(normalized);
    normalized = normalized.replace(/^[-*•]\s+/, "");

    // Remove leading time stamp (e.g., "09:36 " or "9:36 - ")
    normalized = normalized.replace(/^\d{1,2}:\d{2}(?::\d{2})?\s*(?:[-–—]\s*)?/, "");

    return normalized.trim();
  }

  private stripLeadingTriggerPhrase(
    content: string,
    phrases: string[],
    options?: { stripTrailingColon?: boolean }
  ): string {
    const normalized = this.normalizeTriggerContent(content);
    return this.stripLeadingPhrase(normalized, phrases, options);
  }

  private stripTaskPrefix(content: string): string {
    const trimmed = content.trim();
    const taskPrefix = this.settings.inbox.formatting.taskPrefix.trim();
    if (taskPrefix && trimmed.startsWith(taskPrefix)) {
      return trimmed.slice(taskPrefix.length).trim();
    }
    return trimmed.replace(/^-\s*\[\s*\]\s*/, "").trim();
  }

  private stripDueDateMarkers(line: string): string {
    const emoji = this.settings.inbox.formatting.dueDateEmoji;
    if (!emoji) return line.trim();
    const escaped = this.escapeRegex(emoji);
    return line.replace(new RegExp(`\\s*${escaped}\\s*\\d{4}-\\d{2}-\\d{2}`, "g"), "").trim();
  }

  private formatDueDate(overrideOffset?: number): string {
    const offset =
      overrideOffset !== undefined
        ? overrideOffset
        : this.settings.inbox.formatting.defaultDueDateOffset;
    return moment().add(offset, "days").format("YYYY-MM-DD");
  }

  // ============================================================================
  // Content Detection Helpers
  // ============================================================================

  /**
   * Check if content looks like an action item
   */
  private looksLikeActionItem(content: string): boolean {
    const trimmed = content.trim();
    if (!trimmed) return false;

    const actionSettings = this.settings.inbox.actionDetection;
    if (!actionSettings.enabled) return false;

    const lower = trimmed.toLowerCase();
    const actionVerbs = actionSettings.verbs || [];
    const matchMode = actionSettings.matchMode;

    if (matchMode === "starts_with" || matchMode === "both") {
      for (const verb of actionVerbs) {
        const normalized = verb.trim().toLowerCase();
        if (!normalized) continue;
        if (lower.startsWith(normalized)) {
          console.log(`[GSD Inbox] Action item detected (starts with): "${normalized}"`);
          return true;
        }
      }
    }

    if (matchMode === "contains" || matchMode === "both") {
      for (const verb of actionVerbs) {
        const normalized = verb.trim().toLowerCase();
        if (!normalized) continue;
        if (normalized.includes(" ")) {
          if (lower.includes(normalized)) {
            console.log(`[GSD Inbox] Action item detected (contains phrase): "${normalized}"`);
            return true;
          }
          const escaped = this.escapeRegex(normalized);
          const regex = new RegExp(`\\b${escaped.replace(/\\s+/g, "\\\\s+")}\\b`, "i");
          if (regex.test(lower)) {
            console.log(`[GSD Inbox] Action item detected (contains regex): "${normalized}"`);
            return true;
          }
        } else {
          const regex = new RegExp(`\\b${this.escapeRegex(normalized)}\\b`, "i");
          if (regex.test(lower)) {
            console.log(`[GSD Inbox] Action item detected (contains): "${normalized}"`);
            return true;
          }
        }
      }
    }

    if (actionSettings.includeImperativePattern) {
      if (/^[a-z]+\s+(the|a|an|with|to|for)\s+/i.test(trimmed)) {
        console.log(`[GSD Inbox] Action item detected (imperative pattern)`);
        return true;
      }
    }

    if (
      actionSettings.includeShortContent &&
      trimmed.length <= actionSettings.shortContentMaxChars &&
      !this.isURL(trimmed) &&
      !trimmed.includes("\n")
    ) {
      if (/^[A-Z][^.!?]*[.!?]?$/.test(trimmed) || /^[a-z]/.test(trimmed)) {
        console.log(
          `[GSD Inbox] Action item detected (short content, likely task): "${trimmed.substring(0, 50)}"`
        );
        return true;
      }
    }

    console.log(`[GSD Inbox] Content does NOT look like action item: "${trimmed.substring(0, 50)}"`);
    return false;
  }

  /**
   * Check if content is a URL
   */
  private isURL(content: string): boolean {
    const trimmed = content.trim();
    return /^https?:\/\//i.test(trimmed) || /^www\./i.test(trimmed);
  }

  private extractFirstUrl(content: string): string | null {
    const trimmed = content.trim();
    if (!trimmed) return null;

    const mdLinkMatch = trimmed.match(/\[[^\]]*]\((https?:\/\/[^)]+)\)/i);
    if (mdLinkMatch?.[1]) {
      return mdLinkMatch[1].trim();
    }

    const urlMatch = trimmed.match(/https?:\/\/[^\s<>"\]]+/i);
    if (urlMatch?.[0]) {
      return urlMatch[0].trim();
    }

    const wwwMatch = trimmed.match(/\bwww\.[^\s<>"\]]+/i);
    if (wwwMatch?.[0]) {
      return `https://${wwwMatch[0]}`;
    }

    return null;
  }

  private getSummarizeApi(): SummarizeAPI | null {
    const plugins = (this.app as any).plugins;
    if (!plugins) return null;

    const plugin =
      typeof plugins.getPlugin === "function"
        ? plugins.getPlugin("summarize")
        : plugins.plugins?.["summarize"];
    const api = plugin?.api;

    if (!api || typeof api.summarizeUrl !== "function") {
      return null;
    }

    return api as SummarizeAPI;
  }

  private getLinkSummaryUrl(item: InboxItem, decision: InboxRouteDecision): string | null {
    if (!this.settings.inbox.contentSummary.enabled) return null;
    if (decision.format !== "thought") return null;
    if (decision.destination === "meeting_followup") return null;

    return this.extractFirstUrl(item.content);
  }

  /**
   * Parse LLM response that contains summary + tags
   * Expects format: "Summary text...\nTAGS: tag1, tag2"
   */
  private parseSummaryWithTags(result: string): { summary: string; tags: string[] } {
    const lines = result.trim().split("\n");
    let tags: string[] = [];
    let summaryLines: string[] = [];

    for (const line of lines) {
      const tagMatch = line.match(/^TAGS?:\s*(.+)$/i);
      if (tagMatch) {
        tags = tagMatch[1]
          .split(",")
          .map(t => t.trim().toLowerCase().replace(/^#/, ""))
          .filter(t => t.length > 0 && t !== "uncategorized");
      } else {
        summaryLines.push(line);
      }
    }

    return {
      summary: summaryLines.join("\n").trim(),
      tags: tags.length > 0 ? tags : ["uncategorized"],
    };
  }

  private formatSummaryAsIndentedBullet(summary: string, tags: string[] = []): string {
    const cleaned = summary
      .split("\n")
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => line.replace(/^[-*•]\s+/, ""));

    if (cleaned.length === 0) {
      return "\t- (No summary)";
    }

    // Format tags as hashtags (e.g., #ai/agents)
    const tagStr = tags.length > 0
      ? " " + tags.map(t => `#${t}`).join(" ")
      : "";

    const [first, ...rest] = cleaned;
    if (rest.length === 0) {
      return `\t- ${first}${tagStr}`;
    }

    return `\t- ${first}${tagStr}\n${rest.map(line => `\t  ${line}`).join("\n")}`;
  }

  private replaceLastOccurrence(content: string, target: string, replacement: string): string {
    const idx = content.lastIndexOf(target);
    if (idx === -1) return content;
    return content.slice(0, idx) + replacement + content.slice(idx + target.length);
  }

  private async replaceSummaryPlaceholder(
    file: TFile,
    originalLine: string,
    replacement: string
  ): Promise<void> {
    const placeholderBlock = `${originalLine}\n\t- ⏳ Summarizing...`;
    const fileContent = await this.app.vault.read(file);
    if (!fileContent.includes(placeholderBlock)) return;

    const updated = this.replaceLastOccurrence(
      fileContent,
      placeholderBlock,
      `${originalLine}\n${replacement}`
    );
    await this.app.vault.modify(file, updated);
  }

  private async generateLinkSummaryAsync(
    file: TFile,
    originalLine: string,
    url: string
  ): Promise<void> {
    const summarizeApi = this.getSummarizeApi();
    if (!summarizeApi) {
      await this.replaceSummaryPlaceholder(
        file,
        originalLine,
        "\t- ❌ Summarize plugin not available"
      );
      new Notice("Summarize plugin not available");
      return;
    }

    if (!summarizeApi.isConfigured()) {
      await this.replaceSummaryPlaceholder(
        file,
        originalLine,
        "\t- ❌ Summarize plugin not configured"
      );
      new Notice("Summarize plugin not configured");
      return;
    }

    try {
      let summary: string;
      let tags: string[] = [];

      // If reference system is enabled, use combined prompt for summary + tags
      if (this.settings.reference.enabled) {
        const topicsContent = await this.referenceAction.getTopicsFileContent();

        if (topicsContent) {
          // Combined prompt: summarize + categorize in one call
          const customPrompt = `Summarize this content in {{wordCount}} words. {{language}}

After the summary, on a NEW LINE, output topic tags from the hierarchy below.

## Topic Hierarchy
${topicsContent}

## Instructions for Tags
- Output tags on the LAST LINE in format: TAGS: tag1, tag2
- Use exact paths from hierarchy (e.g., ai/agents, leadership/urgency)
- Only include clearly relevant tags (1-3 max)
- If nothing matches, use: TAGS: uncategorized

## Content to Summarize
{{content}}`;

          const result = await summarizeApi.summarizeUrl(url, { prompt: customPrompt });

          // Parse result: extract summary and tags
          const parsed = this.parseSummaryWithTags(result);
          summary = parsed.summary;
          tags = parsed.tags;
          console.log(`[GSD Inbox] Combined summary+tags. Tags: ${tags.join(", ")}`);
        } else {
          // No topics file, just summarize
          summary = await summarizeApi.summarizeUrl(url);
        }
      } else {
        // Reference system disabled, just summarize
        summary = await summarizeApi.summarizeUrl(url);
      }

      const formattedSummary = this.formatSummaryAsIndentedBullet(summary, tags);
      await this.replaceSummaryPlaceholder(file, originalLine, formattedSummary);
      new Notice("Link summary added");
    } catch (error: unknown) {
      handleError("Inbox: Link summary failed", error, {
        showNotice: true,
        noticeMessage: "Link summary failed",
      });

      try {
        await this.replaceSummaryPlaceholder(file, originalLine, "\t- ❌ Summary failed");
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Parse content type from string parameter
   */
  private parseContentType(type?: string): InboxContentType {
    if (!type) return "unknown";
    const lower = type.toLowerCase();
    if (["task", "thought", "link", "transcript", "screenshot"].includes(lower)) {
      return lower as InboxContentType;
    }
    return "unknown";
  }

  /**
   * Parse source from string parameter
   */
  private parseSource(source?: string): "share" | "shortcut" | "manual" | "uri" {
    if (!source) return "uri";
    const lower = source.toLowerCase();
    if (["share", "shortcut", "manual"].includes(lower)) {
      return lower as "share" | "shortcut" | "manual";
    }
    return "uri";
  }

  // ============================================================================
  // Calendar Integration
  // ============================================================================

  /**
   * Get the currently ongoing meeting (within configured window)
   */
  async getCurrentMeeting(): Promise<CalendarEvent | null> {
    const now = moment();
    const windowMinutes = this.settings.inbox.meetingWindowMinutes;

    try {
      const events = await this.calendarService.getTodayEvents();
      
      for (const event of events) {
        if (!event.start?.dateTime || !event.end?.dateTime) continue;

        const start = moment(event.start.dateTime);
        const end = moment(event.end.dateTime);

        // Extend window: start - N minutes, end + N minutes
        const windowStart = start.clone().subtract(windowMinutes, "minutes");
        const windowEnd = end.clone().add(windowMinutes, "minutes");

        if (now.isBetween(windowStart, windowEnd)) {
          // Skip excluded titles
          const title = event.summary?.trim() || "";
          if (this.settings.excludeTitles.some(
            (t) => t.toLowerCase() === title.toLowerCase()
          )) {
            continue;
          }
          return event;
        }
      }
    } catch (error: unknown) {
      handleError("Inbox: Failed to get current meeting", error, {
        silent: true, // Expected to fail sometimes when not in a meeting
      });
    }

    return null;
  }

  // ============================================================================
  // Output Formatting & Appending
  // ============================================================================

  /**
   * Append the inbox item to its destination
   * Uses fallback strategy: today → yesterday → latest available Daily Note
   */
  private async appendToDestination(item: InboxItem, decision: InboxRouteDecision): Promise<void> {
    await this.appendToDestinationOnce(item, decision);
  }

  private async appendToDestinationOnce(item: InboxItem, decision: InboxRouteDecision): Promise<void> {
    const dailyNotePath = await this.getDailyNotePath();
    if (!dailyNotePath) {
      throw new DailyNoteNotReadyError("Could not find any daily note (tried today, yesterday, and latest)");
    }

    const file = this.app.vault.getAbstractFileByPath(dailyNotePath);
    if (!file || !(file instanceof TFile)) {
      throw new DailyNoteNotReadyError("Daily note file could not be accessed");
    }

    const content = await this.app.vault.read(file);

    const summaryUrl = this.getLinkSummaryUrl(item, decision);
    if (summaryUrl) {
      const formatted = this.formatAsThought(item);
      const placeholderBlock = `${formatted}\n\t- ⏳ Summarizing...`;

      if (decision.destination === "daily_end") {
        const separator = content.endsWith("\n") ? "" : "\n";
        const newContent = `${content}${separator}${placeholderBlock}`;
        await this.app.vault.modify(file, newContent);
      } else {
        const newContent = this.appendToThoughtsSection(content, placeholderBlock);
        await this.app.vault.modify(file, newContent);
      }

      void this.generateLinkSummaryAsync(file, formatted, summaryUrl);
      return;
    }

    if (decision.destination === "meeting_followup" && item.meetingContext) {
      // Append as task after meeting line
      const formatted = this.formatAsMeetingFollowup(item, decision);
      const newContent = this.insertAfterMeetingLine(content, item.meetingContext, formatted);
      await this.app.vault.modify(file, newContent);
    } else if (decision.destination === "daily_end") {
      const formatted = decision.format === "task"
        ? this.formatAsTask(item, decision)
        : this.formatAsThought(item);
      const separator = content.endsWith("\n") ? "" : "\n";
      const newContent = `${content}${separator}${formatted}`;
      await this.app.vault.modify(file, newContent);
    } else {
      const formatted = decision.format === "task"
        ? this.formatAsTask(item, decision)
        : this.formatAsThought(item);
      console.log(
        `[GSD Inbox] Destination: ${decision.destination}, format: ${decision.format}, addDueDate: ${decision.addDueDate}`
      );
      console.log(`[GSD Inbox] Content: "${item.content.substring(0, 100)}"`);
      console.log(`[GSD Inbox] Formatted as: ${formatted.substring(0, 100)}...`);
      const newContent = this.appendToThoughtsSection(content, formatted);
      await this.app.vault.modify(file, newContent);
    }
  }

  /**
   * Format item as a meeting follow-up task
   */
  private formatAsMeetingFollowup(item: InboxItem, decision: InboxRouteDecision): string {
    const dueDate = decision.addDueDate
      ? this.formatDueDate(decision.dueDateOffset)
      : null;
    const taskPrefix = this.settings.inbox.formatting.taskPrefix;
    const dueDateEmoji = this.settings.inbox.formatting.dueDateEmoji;

    let taskContent = item.content.trim();

    // Remove leading task prefix if already present
    taskContent = this.stripTaskPrefix(taskContent);

    return dueDate
      ? `\t${taskPrefix} ${taskContent} ${dueDateEmoji} ${dueDate}`
      : `\t${taskPrefix} ${taskContent}`;
  }

  /**
   * Format item as a task (for daily thoughts section)
   */
  private formatAsTask(item: InboxItem, decision: InboxRouteDecision): string {
    const dueDate = decision.addDueDate
      ? this.formatDueDate(decision.dueDateOffset)
      : null;
    const taskPrefix = this.settings.inbox.formatting.taskPrefix;
    const dueDateEmoji = this.settings.inbox.formatting.dueDateEmoji;

    let taskContent = item.content.trim();

    // Remove leading task prefix if already present
    taskContent = this.stripTaskPrefix(taskContent);

    const formatted = dueDate
      ? `${taskPrefix} ${taskContent} ${dueDateEmoji} ${dueDate}`
      : `${taskPrefix} ${taskContent}`;
    console.log(`[GSD Inbox] formatAsTask: "${formatted}"`);
    return formatted;
  }

  /**
   * Format item as a thought
   */
  private formatAsThought(item: InboxItem): string {
    const timestamp = moment().format(this.settings.inbox.formatting.timeFormat);
    let formatted = item.content.trim();

    // Handle URLs specially
    if (this.isURL(formatted)) {
      return `- ${timestamp} ${formatted}`;
    }

    // Multi-line content: indent continuation lines
    if (formatted.includes("\n")) {
      const lines = formatted.split("\n");
      formatted = lines[0];
      if (lines.length > 1) {
        formatted += "\n" + lines.slice(1).map(l => `\t${l}`).join("\n");
      }
    }

    return `- ${timestamp} ${formatted}`;
  }

  /**
   * Insert content after the meeting line in daily note
   */
  private insertAfterMeetingLine(
    content: string,
    meeting: CalendarEvent,
    textToInsert: string
  ): string {
    const lines = content.split("\n");
    
    // Find line containing meeting link (by ID or title)
    const meetingId = meeting.id;
    const meetingTitle = meeting.summary || "";
    
    let insertIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Match by event ID in link (try full ID first, then partial match)
      if (meetingId) {
        // Full ID match
        if (line.includes(`~${meetingId}`)) {
          insertIdx = i;
          break;
        }
        // Partial match (ID might be truncated in filename)
        // Check if the last 20 chars of the ID match
        if (meetingId.length > 20) {
          const idSuffix = meetingId.substring(meetingId.length - 20);
          if (line.includes(`~${idSuffix}`)) {
            insertIdx = i;
            break;
          }
        }
      }
    }
    
    // If ID match failed, try title match (but be more specific)
    if (insertIdx === -1 && meetingTitle) {
      const titleWords = meetingTitle.trim().split(/\s+/).filter(w => w.length > 3);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Match if line contains the meeting link pattern AND the title
        if (line.includes("[[") && line.includes("]]")) {
          // Check if at least 2 significant words from title appear in the line
          const matchingWords = titleWords.filter(word => 
            line.toLowerCase().includes(word.toLowerCase())
          );
          if (matchingWords.length >= Math.min(2, titleWords.length)) {
            insertIdx = i;
            break;
          }
        }
      }
    }

    if (insertIdx !== -1) {
      // Find the last sub-item under this meeting (indented lines)
      let lastSubItemIdx = insertIdx;
      for (let i = insertIdx + 1; i < lines.length; i++) {
        const line = lines[i];
        // Check if it's a sub-item (starts with tab or multiple spaces)
        if (line.match(/^[\t\s]{1,}[-*\[]/) || line.match(/^\t/)) {
          lastSubItemIdx = i;
        } else if (line.trim().length > 0 && !line.match(/^[\t\s]/)) {
          // Non-empty, non-indented line - stop (this is the next meeting or section)
          break;
        }
      }
      
      // Insert after last sub-item (or right after meeting line if no sub-items)
      lines.splice(lastSubItemIdx + 1, 0, textToInsert);
      console.log(`[GSD Inbox] Inserted task after meeting "${meetingTitle}" at line ${lastSubItemIdx + 1}`);
    } else {
      // Meeting not found, append to thoughts section instead
      console.log(`[GSD Inbox] Meeting line not found for "${meetingTitle}" (ID: ${meetingId}), falling back to thoughts section`);
      return this.appendToThoughtsSection(content, textToInsert.replace(/^\t/, "- "));
    }

    return lines.join("\n");
  }

  /**
   * Append content to the Thoughts section
   */
  private appendToThoughtsSection(content: string, textToInsert: string): string {
    const sectionHeader = this.settings.inbox.thoughtsSection;
    const lines = content.split("\n");
    
    // Find thoughts section
    let sectionIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === sectionHeader) {
        sectionIdx = i;
        break;
      }
    }

    if (sectionIdx === -1) {
      // Section doesn't exist - create it at end of file
      lines.push("");
      lines.push(sectionHeader);
      lines.push(textToInsert);
    } else {
      // Find end of section (next heading or end of file)
      let insertIdx = sectionIdx + 1;
      for (let i = sectionIdx + 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith("##") || line.startsWith("# ")) {
          // Found next section
          insertIdx = i;
          break;
        }
        insertIdx = i + 1;
      }
      
      // Insert at end of section (before next heading)
      lines.splice(insertIdx, 0, textToInsert);
    }

    return lines.join("\n");
  }

  /**
   * Get a daily note path with fallback strategy:
   * 1. Try today's Daily Note
   * 2. If not found, try yesterday's Daily Note
   * 3. If not found, find the latest Daily Note in the vault
   */
  private async getDailyNotePath(): Promise<string | null> {
    // Try today first
    const today = moment().format("YYYY-MM-DD");
    const todayPath = this.findDailyNoteByDate(today);
    if (todayPath) {
      return todayPath;
    }

    // Try yesterday
    const yesterday = moment().subtract(1, "day").format("YYYY-MM-DD");
    const yesterdayPath = this.findDailyNoteByDate(yesterday);
    if (yesterdayPath) {
      console.log(`[GSD Inbox] Today's daily note not found, falling back to yesterday: ${yesterdayPath}`);
      return yesterdayPath;
    }

    // Find the latest Daily Note in the vault
    const latestPath = this.findLatestDailyNote();
    if (latestPath) {
      console.log(`[GSD Inbox] No recent daily notes found, falling back to latest: ${latestPath}`);
      return latestPath;
    }

    return null;
  }

  /**
   * Find a daily note by date string (YYYY-MM-DD)
   */
  private findDailyNoteByDate(date: string): string | null {
    const possiblePaths = [
      `Daily notes/${date}.md`,
      `daily notes/${date}.md`,
      `Daily Notes/${date}.md`,
      `${date}.md`,
    ];

    for (const path of possiblePaths) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) {
        return path;
      }
    }

    // Try to find any file matching the date pattern
    const allFiles = this.app.vault.getMarkdownFiles();
    for (const file of allFiles) {
      if (file.basename === date) {
        return file.path;
      }
    }

    return null;
  }

  /**
   * Find the latest daily note in the vault by scanning for YYYY-MM-DD pattern files
   */
  private findLatestDailyNote(): string | null {
    const allFiles = this.app.vault.getMarkdownFiles();
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;

    // Filter files that match daily note naming pattern and sort by date descending
    const dailyNotes = allFiles
      .filter(file => datePattern.test(file.basename))
      .sort((a, b) => b.basename.localeCompare(a.basename)); // Descending order (latest first)

    if (dailyNotes.length > 0) {
      return dailyNotes[0].path;
    }

    return null;
  }

  // ============================================================================
  // Command Registration Helper
  // ============================================================================

  /**
   * Manually trigger inbox capture (for testing/command palette)
   */
  async captureFromClipboard(): Promise<void> {
    try {
      const content = await navigator.clipboard.readText();
      if (!content.trim()) {
        new Notice("Clipboard is empty");
        return;
      }

      await this.processInboxItem({
        content: content,
        source: "manual",
      });
    } catch (error: unknown) {
      handleError("Inbox: Clipboard read failed", error, {
        showNotice: true,
        noticeMessage: "Failed to read clipboard",
      });
    }
  }
}

/**
 * Smart Suggestion Modal
 * Shows detected entities and allows user to add information to their notes
 */
class SmartSuggestionModal extends Modal {
  private item: InboxItem;
  private suggestions: Array<{ type: "person" | "org"; name: string; notePath: string }>;
  private selectedEntities: Set<string> = new Set();
  private onComplete: (selected: Array<{ type: "person" | "org"; name: string; notePath: string }>, shouldAdd: boolean) => Promise<void>;

  constructor(
    app: App,
    item: InboxItem,
    suggestions: Array<{ type: "person" | "org"; name: string; notePath: string }>,
    onComplete: (selected: Array<{ type: "person" | "org"; name: string; notePath: string }>, shouldAdd: boolean) => Promise<void>
  ) {
    super(app);
    this.item = item;
    this.suggestions = suggestions;
    this.onComplete = onComplete;
    
    // Select all by default
    suggestions.forEach(s => this.selectedEntities.add(s.notePath));
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "Smart Suggestion" });
    contentEl.createEl("p", { 
      text: "I detected mentions of people or organizations in your note. Would you like to add this information to their notes?" 
    });

    contentEl.createEl("p", { 
      text: `Content: "${this.item.content.substring(0, 100)}${this.item.content.length > 100 ? "..." : ""}"`,
      cls: "gsd-suggestion-content"
    });

    contentEl.createEl("h3", { text: "Detected entities:" });

    // Create checkboxes for each entity
    this.suggestions.forEach(suggestion => {
      const setting = new Setting(contentEl)
        .setName(suggestion.name)
        .setDesc(`${suggestion.type === "person" ? "Person" : "Organization"} note: [[${suggestion.notePath}]]`)
        .addToggle(toggle => {
          toggle.setValue(this.selectedEntities.has(suggestion.notePath))
            .onChange(value => {
              if (value) {
                this.selectedEntities.add(suggestion.notePath);
              } else {
                this.selectedEntities.delete(suggestion.notePath);
              }
            });
        });
    });

    // Buttons
    new Setting(contentEl)
      .addButton(button => {
        button.setButtonText("Add to Notes")
          .setCta()
          .onClick(async () => {
            const selected = this.suggestions.filter(s => this.selectedEntities.has(s.notePath));
            this.close();
            await this.onComplete(selected, true);
          });
      })
      .addButton(button => {
        button.setButtonText("Skip")
          .onClick(async () => {
            this.close();
            await this.onComplete([], false);
          });
      });
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}
