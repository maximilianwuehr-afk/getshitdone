// ============================================================================
// Inbox Action - Main entry point for inbox processing
// ============================================================================

import { App, TFile, Notice } from "obsidian";
import type {
  PluginSettings,
  CalendarEvent,
  InboxItem,
  InboxContentType,
  InboxURIParams,
} from "../../types";
import { CalendarService } from "../../services/calendar";
import { handleError, handleErrorWithDefault } from "../../utils/error-handler";
import { GoogleServices } from "../../services/google-services";
import { AIService } from "../../services/ai-service";
import { VaultSearchService } from "../../services/vault-search";
import { IndexService } from "../../services/index-service";
import { ReferenceAction } from "../reference";

import { DailyNoteNotReadyError, type InboxRouteDecision } from "./types";
import { detectTriggerPhrase, handleReferenceTrigger, handleResearchTrigger, handleFollowupTrigger } from "./triggers";
import { routeItemDeterministic, routeItem, formatDestinationLabel } from "./router";
import {
  appendToDestination,
  getDailyNotePath,
  appendToThoughtsSection,
  insertAfterMeetingLine,
} from "./formatter";
import { detectEntityMentions, showSmartSuggestion } from "./entity-detector";

const moment = (window as any).moment;

// ============================================================================
// Inbox Action Class
// ============================================================================

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
        handleReferenceTrigger(
          this.app,
          this.settings,
          this.referenceAction,
          item,
          refUrl,
          () => this.getDailyNotePath(),
          (content, text) => appendToThoughtsSection(content, text, this.settings)
        ).catch((error: unknown) => {
          handleError("Inbox: Reference trigger failed", error, {
            showNotice: true,
            noticeMessage: "Reference save failed - check console for details",
          });
        });
        return;
      }
    }

    if (this.settings.inbox.triggers.enabled) {
      const trigger = detectTriggerPhrase(item.content, this.settings);
      if (trigger === "followup") {
        // "Follow up X" is an explicit command - handle it synchronously
        // since it needs to format the task properly
        try {
          await handleFollowupTrigger(
            this.app,
            this.settings,
            this.indexService,
            item,
            () => this.getDailyNotePath(),
            (content, text) => appendToThoughtsSection(content, text, this.settings),
            (content, meeting, text) => insertAfterMeetingLine(content, meeting, text)
          );
        } catch (error: unknown) {
          handleError("Inbox: Follow-up trigger failed", error, {
            showNotice: true,
            noticeMessage: "Follow-up failed",
          });
        }
        return;
      } else if (trigger === "research") {
        // "Research X" is an explicit command - handle it (will show its own notice)
        handleResearchTrigger(
          this.app,
          this.settings,
          this.aiService,
          item,
          () => this.getDailyNotePath(),
          (content, text) => appendToThoughtsSection(content, text, this.settings)
        ).catch((error: unknown) => {
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
      const decision = await routeItemDeterministic(item, this.settings);
      item.destination = decision.destination;

      // Format and append immediately
      await appendToDestination(
        this.app,
        this.settings,
        this.referenceAction,
        item,
        decision,
        () => this.getDailyNotePath()
      );

      // Show confirmation immediately
      new Notice(`Captured to ${formatDestinationLabel(decision.destination)} ✓`);
      console.log(`[GSD Inbox] Fast capture complete: ${decision.destination}`);
    } catch (error: unknown) {
      const noticeMessage = error instanceof Error && error.name === "DailyNoteNotReadyError"
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
  // Daily Note Helper
  // ============================================================================

  /**
   * Get a daily note path with fallback strategy
   */
  private async getDailyNotePath(): Promise<string | null> {
    return getDailyNotePath(this.app);
  }

  // ============================================================================
  // Content Type Parsing
  // ============================================================================

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
