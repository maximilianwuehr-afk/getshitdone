// ============================================================================
// Formatter - Output formatting and daily note operations
// ============================================================================

import { App, TFile, Notice } from "obsidian";
import type { PluginSettings, InboxItem, CalendarEvent } from "../../types";
import { handleError } from "../../utils/error-handler";
import { ReferenceAction } from "../reference";
import type { InboxRouteDecision, SummarizeAPI, DailyNoteNotReadyError } from "./types";
import { formatDueDate } from "./date-parser";
import { stripTaskPrefix, escapeRegex } from "./triggers";
import { isURL } from "./router";

const moment = (window as any).moment;

// ============================================================================
// Public API
// ============================================================================

/**
 * Append the inbox item to its destination
 * Uses fallback strategy: today → yesterday → latest available Daily Note
 */
export async function appendToDestination(
  app: App,
  settings: PluginSettings,
  referenceAction: ReferenceAction,
  item: InboxItem,
  decision: InboxRouteDecision,
  getDailyNotePath: () => Promise<string | null>
): Promise<void> {
  const dailyNotePath = await getDailyNotePath();
  if (!dailyNotePath) {
    const error = new Error("Could not find any daily note (tried today, yesterday, and latest)") as Error & { name: string };
    error.name = "DailyNoteNotReadyError";
    throw error;
  }

  const file = app.vault.getAbstractFileByPath(dailyNotePath);
  if (!file || !(file instanceof TFile)) {
    const error = new Error("Daily note file could not be accessed") as Error & { name: string };
    error.name = "DailyNoteNotReadyError";
    throw error;
  }

  const content = await app.vault.read(file);

  const summaryUrl = getLinkSummaryUrl(item, decision, settings);
  if (summaryUrl) {
    const formatted = formatAsThought(item, settings);
    const placeholderBlock = `${formatted}\n\t- ⏳ Summarizing...`;

    if (decision.destination === "daily_end") {
      const separator = content.endsWith("\n") ? "" : "\n";
      const newContent = `${content}${separator}${placeholderBlock}`;
      await app.vault.modify(file, newContent);
    } else {
      const newContent = appendToThoughtsSection(content, placeholderBlock, settings);
      await app.vault.modify(file, newContent);
    }

    void generateLinkSummaryAsync(app, settings, referenceAction, file, formatted, summaryUrl);
    return;
  }

  if (decision.destination === "meeting_followup" && item.meetingContext) {
    // Append as task after meeting line
    const formatted = formatAsMeetingFollowup(item, decision, settings);
    const newContent = insertAfterMeetingLine(content, item.meetingContext, formatted);
    await app.vault.modify(file, newContent);
  } else if (decision.destination === "daily_end") {
    const formatted = decision.format === "task"
      ? formatAsTask(item, decision, settings)
      : formatAsThought(item, settings);
    const separator = content.endsWith("\n") ? "" : "\n";
    const newContent = `${content}${separator}${formatted}`;
    await app.vault.modify(file, newContent);
  } else {
    const formatted = decision.format === "task"
      ? formatAsTask(item, decision, settings)
      : formatAsThought(item, settings);
    console.log(
      `[GSD Inbox] Destination: ${decision.destination}, format: ${decision.format}, addDueDate: ${decision.addDueDate}`
    );
    console.log(`[GSD Inbox] Content: "${item.content.substring(0, 100)}"`);
    console.log(`[GSD Inbox] Formatted as: ${formatted.substring(0, 100)}...`);
    const newContent = appendToThoughtsSection(content, formatted, settings);
    await app.vault.modify(file, newContent);
  }
}

// ============================================================================
// Format Functions
// ============================================================================

/**
 * Format item as a meeting follow-up task
 */
export function formatAsMeetingFollowup(
  item: InboxItem,
  decision: InboxRouteDecision,
  settings: PluginSettings
): string {
  const dueDate = decision.addDueDate
    ? formatDueDate(decision.dueDateOffset ?? settings.inbox.formatting.defaultDueDateOffset)
    : null;
  const taskPrefix = settings.inbox.formatting.taskPrefix;
  const dueDateEmoji = settings.inbox.formatting.dueDateEmoji;

  let taskContent = item.content.trim();

  // Remove leading task prefix if already present
  taskContent = stripTaskPrefix(taskContent, settings);

  return dueDate
    ? `\t${taskPrefix} ${taskContent} ${dueDateEmoji} ${dueDate}`
    : `\t${taskPrefix} ${taskContent}`;
}

/**
 * Format item as a task (for daily thoughts section)
 */
export function formatAsTask(
  item: InboxItem,
  decision: InboxRouteDecision,
  settings: PluginSettings
): string {
  const dueDate = decision.addDueDate
    ? formatDueDate(decision.dueDateOffset ?? settings.inbox.formatting.defaultDueDateOffset)
    : null;
  const taskPrefix = settings.inbox.formatting.taskPrefix;
  const dueDateEmoji = settings.inbox.formatting.dueDateEmoji;

  let taskContent = item.content.trim();

  // Remove leading task prefix if already present
  taskContent = stripTaskPrefix(taskContent, settings);

  const formatted = dueDate
    ? `${taskPrefix} ${taskContent} ${dueDateEmoji} ${dueDate}`
    : `${taskPrefix} ${taskContent}`;
  console.log(`[GSD Inbox] formatAsTask: "${formatted}"`);
  return formatted;
}

/**
 * Format item as a thought
 */
export function formatAsThought(item: InboxItem, settings: PluginSettings): string {
  const timestamp = moment().format(settings.inbox.formatting.timeFormat);
  let formatted = item.content.trim();

  // Handle URLs specially
  if (isURL(formatted)) {
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

// ============================================================================
// Daily Note Section Operations
// ============================================================================

/**
 * Insert content after the meeting line in daily note
 */
export function insertAfterMeetingLine(
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
    return appendToThoughtsSection(content, textToInsert.replace(/^\t/, "- "), { inbox: { thoughtsSection: "## Thoughts" } } as PluginSettings);
  }

  return lines.join("\n");
}

/**
 * Append content to the Thoughts section
 */
export function appendToThoughtsSection(
  content: string,
  textToInsert: string,
  settings: PluginSettings
): string {
  const sectionHeader = settings.inbox.thoughtsSection;
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

// ============================================================================
// URL and Summary Helpers
// ============================================================================

export function extractFirstUrl(content: string): string | null {
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

export function getSummarizeApi(app: App): SummarizeAPI | null {
  const plugins = (app as any).plugins;
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

export function getLinkSummaryUrl(
  item: InboxItem,
  decision: InboxRouteDecision,
  settings: PluginSettings
): string | null {
  if (!settings.inbox.contentSummary.enabled) return null;
  if (decision.format !== "thought") return null;
  if (decision.destination === "meeting_followup") return null;

  return extractFirstUrl(item.content);
}

/**
 * Parse LLM response that contains summary + tags
 * Expects format: "Summary text...\nTAGS: tag1, tag2"
 */
export function parseSummaryWithTags(result: string): { summary: string; tags: string[] } {
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

export function formatSummaryAsIndentedBullet(summary: string, tags: string[] = []): string {
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

function replaceLastOccurrence(content: string, target: string, replacement: string): string {
  const idx = content.lastIndexOf(target);
  if (idx === -1) return content;
  return content.slice(0, idx) + replacement + content.slice(idx + target.length);
}

async function replaceSummaryPlaceholder(
  app: App,
  file: TFile,
  originalLine: string,
  replacement: string
): Promise<void> {
  const placeholderBlock = `${originalLine}\n\t- ⏳ Summarizing...`;
  const fileContent = await app.vault.read(file);
  if (!fileContent.includes(placeholderBlock)) return;

  const updated = replaceLastOccurrence(
    fileContent,
    placeholderBlock,
    `${originalLine}\n${replacement}`
  );
  await app.vault.modify(file, updated);
}

export async function generateLinkSummaryAsync(
  app: App,
  settings: PluginSettings,
  referenceAction: ReferenceAction,
  file: TFile,
  originalLine: string,
  url: string
): Promise<void> {
  const summarizeApi = getSummarizeApi(app);
  if (!summarizeApi) {
    await replaceSummaryPlaceholder(
      app,
      file,
      originalLine,
      "\t- ❌ Summarize plugin not available"
    );
    new Notice("Summarize plugin not available");
    return;
  }

  if (!summarizeApi.isConfigured()) {
    await replaceSummaryPlaceholder(
      app,
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
    if (settings.reference.enabled) {
      const topicsContent = await referenceAction.getTopicsFileContent();

      if (topicsContent) {
        // Combined prompt: summarize + categorize in one call
        const customPrompt = `Summarize this content in {{wordCount}} words. {{language}}

Requirements for Summary:
- If the content includes an author/byline, mention the author in the first sentence (e.g., "By NAME — ...").
- If the content includes a concrete idea or suggestion to implement, call it out explicitly.
- Do not invent an author; omit if unknown.
- Avoid meta-commentary; start directly with the summary.

After the summary, on a NEW LINE, output topic tags from the hierarchy below.

## Topic Hierarchy
${topicsContent}

## Instructions for Tags
- Output tags on the LAST LINE in format: TAGS: tag1, tag2
- Use exact paths from hierarchy (e.g., ai/agents, leadership/urgency)
- Only include tags that are explicitly central to the content
- Do NOT infer from weak associations or generic overlap
- Prefer fewer tags (0-2 is normal); only use 3 if unmistakably central
- If nothing matches, use: TAGS: uncategorized

## Content to Summarize
{{content}}`;

        const result = await summarizeApi.summarizeUrl(url, { prompt: customPrompt });

        // Parse result: extract summary and tags
        const parsed = parseSummaryWithTags(result);
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

    const formattedSummary = formatSummaryAsIndentedBullet(summary, tags);
    await replaceSummaryPlaceholder(app, file, originalLine, formattedSummary);
    new Notice("Link summary added");
  } catch (error: unknown) {
    handleError("Inbox: Link summary failed", error, {
      showNotice: true,
      noticeMessage: "Link summary failed",
    });

    try {
      await replaceSummaryPlaceholder(app, file, originalLine, "\t- ❌ Summary failed");
    } catch {
      // Ignore cleanup errors
    }
  }
}

// ============================================================================
// Daily Note Path Helpers
// ============================================================================

/**
 * Get a daily note path with fallback strategy:
 * 1. Try today's Daily Note
 * 2. If not found, try yesterday's Daily Note
 * 3. If not found, find the latest Daily Note in the vault
 */
export async function getDailyNotePath(app: App): Promise<string | null> {
  // Try today first
  const today = moment().format("YYYY-MM-DD");
  const todayPath = findDailyNoteByDate(app, today);
  if (todayPath) {
    return todayPath;
  }

  // Try yesterday
  const yesterday = moment().subtract(1, "day").format("YYYY-MM-DD");
  const yesterdayPath = findDailyNoteByDate(app, yesterday);
  if (yesterdayPath) {
    console.log(`[GSD Inbox] Today's daily note not found, falling back to yesterday: ${yesterdayPath}`);
    return yesterdayPath;
  }

  // Find the latest Daily Note in the vault
  const latestPath = findLatestDailyNote(app);
  if (latestPath) {
    console.log(`[GSD Inbox] No recent daily notes found, falling back to latest: ${latestPath}`);
    return latestPath;
  }

  return null;
}

/**
 * Find a daily note by date string (YYYY-MM-DD)
 */
export function findDailyNoteByDate(app: App, date: string): string | null {
  const possiblePaths = [
    `Daily notes/${date}.md`,
    `daily notes/${date}.md`,
    `Daily Notes/${date}.md`,
    `${date}.md`,
  ];

  for (const path of possiblePaths) {
    const file = app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      return path;
    }
  }

  // Try to find any file matching the date pattern
  const allFiles = app.vault.getMarkdownFiles();
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
export function findLatestDailyNote(app: App): string | null {
  const allFiles = app.vault.getMarkdownFiles();
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
