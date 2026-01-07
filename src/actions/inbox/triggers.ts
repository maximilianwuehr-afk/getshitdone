// ============================================================================
// Triggers - Trigger phrase detection and handlers
// ============================================================================

import { App, TFile, Notice } from "obsidian";
import type { PluginSettings, InboxItem, CalendarEvent } from "../../types";
import { handleError } from "../../utils/error-handler";
import { AIService } from "../../services/ai-service";
import { IndexService } from "../../services/index-service";
import { ReferenceAction } from "../reference";
import { parseNaturalLanguageDate, formatDueDate } from "./date-parser";
import { extractEntities, formatWithEntityLinks } from "./entity-detector";

const moment = (window as any).moment;

// ============================================================================
// Public API
// ============================================================================

/**
 * Detect trigger phrases at the start of content
 * Returns "research", "followup", or null
 * Priority: followup > research (checked in processInboxItem)
 */
export function detectTriggerPhrase(
  content: string,
  settings: PluginSettings
): "research" | "followup" | null {
  const normalized = normalizeTriggerContent(content, settings);
  const followupMatch = getLeadingPhraseMatch(
    normalized,
    settings.inbox.triggers.followupPhrases
  );
  if (followupMatch) {
    return "followup";
  }

  const researchMatch = getLeadingPhraseMatch(
    normalized,
    settings.inbox.triggers.researchPhrases
  );
  if (researchMatch) {
    return "research";
  }

  return null;
}

// ============================================================================
// Trigger Handlers
// ============================================================================

/**
 * Handle "Ref:" trigger phrase - process URL into reference note
 */
export async function handleReferenceTrigger(
  app: App,
  settings: PluginSettings,
  referenceAction: ReferenceAction,
  item: InboxItem,
  url: string,
  getDailyNotePath: () => Promise<string | null>,
  appendToThoughtsSection: (content: string, textToInsert: string) => string
): Promise<void> {
  console.log(`[GSD Inbox] Reference trigger detected: ${url}`);

  // Process URL through reference action
  const notePath = await referenceAction.processUrl(url);
  if (!notePath) {
    return; // Error already shown by referenceAction
  }

  // Update daily note with wikilink to reference
  if (settings.reference.dailyNoteLink) {
    // The original line is the full content with trigger
    const originalLine = item.content;

    // Get reference title from the note path
    const fileName = notePath.split("/").pop()?.replace(".md", "") || "";
    const title = fileName
      .replace(/-/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());

    // Read the created note to get the primary tag
    const file = app.vault.getAbstractFileByPath(notePath);
    let primaryTag = "uncategorized";
    if (file && file instanceof TFile) {
      const content = await app.vault.read(file);
      const tagMatch = content.match(/tags:\s*\n\s*-\s*([^\n]+)/);
      if (tagMatch) {
        primaryTag = tagMatch[1].trim();
      }
    }

    // Try to update daily note (replace trigger line with wikilink)
    const updated = await referenceAction.updateDailyNoteWithReference(
      originalLine,
      notePath,
      title,
      primaryTag
    );

    if (!updated) {
      // If we couldn't find the original line, append to daily note
      const dailyNotePath = await getDailyNotePath();
      if (dailyNotePath) {
        const dailyFile = app.vault.getAbstractFileByPath(dailyNotePath);
        if (dailyFile && dailyFile instanceof TFile) {
          const dailyContent = await app.vault.read(dailyFile);
          const timestamp = moment().format(settings.inbox.formatting.timeFormat);
          const wikilink = `[[${notePath.replace(".md", "")}|${title}]]`;
          const newLine = `- ${timestamp} ${wikilink} #${primaryTag}`;
          const newContent = appendToThoughtsSection(dailyContent, newLine);
          await app.vault.modify(dailyFile, newContent);
        }
      }
    }
  }
}

/**
 * Handle "Research" trigger phrase
 */
export async function handleResearchTrigger(
  app: App,
  settings: PluginSettings,
  aiService: AIService,
  item: InboxItem,
  getDailyNotePath: () => Promise<string | null>,
  appendToThoughtsSection: (content: string, textToInsert: string) => string
): Promise<void> {
  // Strip trigger phrase from content
  let researchQuery = stripLeadingTriggerPhrase(
    item.content,
    settings.inbox.triggers.researchPhrases,
    settings,
    { stripTrailingColon: true }
  );

  if (!researchQuery) {
    new Notice("No research query provided");
    return;
  }

  new Notice("Starting deep research...");

  try {
    // Load research prompt
    const researchPrompt = settings.prompts.research ||
      `Research the following topic deeply using web search. Provide a comprehensive summary with key facts, insights, and relevant information.

Topic: {query}

Provide a well-structured research summary.`;

    const prompt = researchPrompt.replace(/{query}/g, researchQuery);

    // Call AI with max effort
    const researchModel = settings.models.personResearchModel || settings.models.orgResearchModel || settings.models.briefingModel;
    const result = await aiService.callModel(
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
    const dailyNotePath = await getDailyNotePath();
    if (!dailyNotePath) {
      new Notice("Could not find today's daily note");
      return;
    }

    const file = app.vault.getAbstractFileByPath(dailyNotePath);
    if (!file || !(file instanceof TFile)) {
      new Notice("Daily note not found");
      return;
    }

    const content = await app.vault.read(file);
    const timestamp = moment().format(settings.inbox.formatting.timeFormat);
    const formatted = `- ${timestamp} **Research: ${researchQuery}**\n\t${result.split("\n").join("\n\t")}`;
    const newContent = appendToThoughtsSection(content, formatted);
    await app.vault.modify(file, newContent);

    new Notice("Research completed and added to daily note");
  } catch (error: unknown) {
    handleError("Inbox: Research failed", error, {
      showNotice: true,
      noticeMessage: "Research failed - check console for details",
    });
  }
}

/**
 * Handle "Follow up" trigger phrase
 */
export async function handleFollowupTrigger(
  app: App,
  settings: PluginSettings,
  indexService: IndexService,
  item: InboxItem,
  getDailyNotePath: () => Promise<string | null>,
  appendToThoughtsSection: (content: string, textToInsert: string) => string,
  insertAfterMeetingLine: (content: string, meeting: CalendarEvent, textToInsert: string) => string
): Promise<void> {
  // Strip trigger phrase from content
  let followupContent = stripLeadingTriggerPhrase(
    item.content,
    settings.inbox.triggers.followupPhrases,
    settings,
    { stripTrailingColon: true }
  );

  if (!followupContent) {
    new Notice("No follow-up content provided");
    return;
  }

  // Extract due date (before entity extraction to avoid interfering with date parsing)
  const dueDate = parseNaturalLanguageDate(followupContent) ||
    moment()
      .add(settings.inbox.formatting.defaultDueDateOffset, "days")
      .format("YYYY-MM-DD");

  // Remove any existing due date from content to avoid duplicates (handle multi-line)
  followupContent = followupContent
    .split("\n")
    .map(line => stripDueDateMarkers(line, settings))
    .filter(line => line.length > 0)
    .join("\n")
    .trim();

  // Extract entities
  const entities = await extractEntities(followupContent, indexService);

  // Format content with entity links
  let taskContent = formatWithEntityLinks(followupContent, entities, settings);

  // Remove leading "- [ ]" if already present
  taskContent = stripTaskPrefix(taskContent, settings);

  // Remove any existing due date that might have been added by formatWithEntityLinks (handle multi-line)
  taskContent = taskContent
    .split("\n")
    .map(line => stripDueDateMarkers(line, settings))
    .filter(line => line.length > 0)
    .join("\n")
    .trim();

  // Format as task - if multi-line, only add due date to the first line
  const taskPrefix = settings.inbox.formatting.taskPrefix;
  const dueDateEmoji = settings.inbox.formatting.dueDateEmoji;

  const formatted = taskContent.includes("\n")
    ? (() => {
        const lines = taskContent.split("\n");
        return `${taskPrefix} ${lines[0]} ${dueDateEmoji} ${dueDate}\n${lines.slice(1).map(l => `\t${l}`).join("\n")}`;
      })()
    : `${taskPrefix} ${taskContent} ${dueDateEmoji} ${dueDate}`;

  // Append to destination
  const dailyNotePath = await getDailyNotePath();
  if (!dailyNotePath) {
    new Notice("Could not find today's daily note");
    return;
  }

  const file = app.vault.getAbstractFileByPath(dailyNotePath);
  if (!file || !(file instanceof TFile)) {
    new Notice("Daily note not found");
    return;
  }

  const content = await app.vault.read(file);

  // If in meeting, add as meeting follow-up; otherwise add to thoughts section
  if (item.meetingContext) {
    const meetingFormatted = `\t${formatted}`;
    const newContent = insertAfterMeetingLine(content, item.meetingContext, meetingFormatted);
    await app.vault.modify(file, newContent);
    new Notice(`Follow-up task added to meeting "${item.meetingContext.summary}"`);
  } else {
    const newContent = appendToThoughtsSection(content, formatted);
    await app.vault.modify(file, newContent);
    new Notice(`Follow-up task added to daily thoughts`);
  }
}

// ============================================================================
// Helpers
// ============================================================================

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function getLeadingPhraseMatch(content: string, phrases: string[]): string | null {
  const trimmed = content.trim();
  if (!trimmed) return null;
  const cleaned = (phrases || []).map((phrase) => phrase.trim()).filter(Boolean);
  if (cleaned.length === 0) return null;

  const pattern = cleaned
    .sort((a, b) => b.length - a.length)
    .map((phrase) => {
      const escaped = escapeRegex(phrase);
      const needsBoundary = /[A-Za-z0-9_]$/.test(phrase);
      return needsBoundary ? `${escaped}\\b` : escaped;
    })
    .join("|");

  const regex = new RegExp(`^(${pattern})`, "i");
  const match = trimmed.match(regex);
  return match ? match[1] : null;
}

export function stripLeadingPhrase(
  content: string,
  phrases: string[],
  options?: { stripTrailingColon?: boolean }
): string {
  const trimmed = content.trim();
  const match = getLeadingPhraseMatch(trimmed, phrases);
  if (!match) return trimmed;
  const suffix = options?.stripTrailingColon ? "\\s*:?" : "";
  const needsBoundary = /[A-Za-z0-9_]$/.test(match);
  const boundary = needsBoundary ? "\\b" : "";
  const regex = new RegExp(`^${escapeRegex(match)}${boundary}${suffix}\\s*`, "i");
  return trimmed.replace(regex, "").trim();
}

export function normalizeTriggerContent(content: string, settings: PluginSettings): string {
  let normalized = content.trim();
  if (!normalized) return normalized;

  // Remove common task/checkbox prefixes and bullets
  normalized = stripTaskPrefix(normalized, settings);
  normalized = normalized.replace(/^[-*•]\s+/, "");

  // Remove leading time stamp (e.g., "09:36 " or "9:36 - ")
  normalized = normalized.replace(/^\d{1,2}:\d{2}(?::\d{2})?\s*(?:[-–—]\s*)?/, "");

  return normalized.trim();
}

export function stripLeadingTriggerPhrase(
  content: string,
  phrases: string[],
  settings: PluginSettings,
  options?: { stripTrailingColon?: boolean }
): string {
  const normalized = normalizeTriggerContent(content, settings);
  return stripLeadingPhrase(normalized, phrases, options);
}

export function stripTaskPrefix(content: string, settings: PluginSettings): string {
  const trimmed = content.trim();
  const taskPrefix = settings.inbox.formatting.taskPrefix.trim();
  if (taskPrefix && trimmed.startsWith(taskPrefix)) {
    return trimmed.slice(taskPrefix.length).trim();
  }
  return trimmed.replace(/^-\s*\[\s*\]\s*/, "").trim();
}

export function stripDueDateMarkers(line: string, settings: PluginSettings): string {
  const emoji = settings.inbox.formatting.dueDateEmoji;
  if (!emoji) return line.trim();
  const escaped = escapeRegex(emoji);
  return line.replace(new RegExp(`\\s*${escaped}\\s*\\d{4}-\\d{2}-\\d{2}`, "g"), "").trim();
}
