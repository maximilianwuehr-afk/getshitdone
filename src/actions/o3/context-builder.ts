// ============================================================================
// Context Builder - O3 context aggregation and AI prep
// ============================================================================

import { App, TFile } from "obsidian";
import type { PluginSettings, CalendarEvent } from "../../types";
import { IndexService } from "../../services/index-service";
import { GoogleServices } from "../../services/google-services";
import type { O3Person, O3SectionData } from "./types";

const moment = (window as any).moment;

// ============================================================================
// Public API
// ============================================================================

/**
 * Parse O3 sections from a People note content
 */
export function parseO3Sections(content: string): O3SectionData {
  const lines = content.split("\n");
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
    const taskMatch = trimmed.match(/^-\s*(?:\[[ xX]\]\s*)?(.*)$/);
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

/**
 * Build O3 context for AI prompt
 */
export async function buildO3Context(
  app: App,
  settings: PluginSettings,
  indexService: IndexService,
  googleServices: GoogleServices,
  person: O3Person,
  event: CalendarEvent | null
): Promise<string | null> {
  const parts: string[] = [];
  const weekKey = getWeekKey(event?.start?.dateTime);
  const meetingTime = event?.start?.dateTime ? moment(event.start.dateTime).format("ddd, HH:mm") : "Not scheduled";

  parts.push(`# O3 Prep Context`);
  parts.push(`Person: ${person.name}`);
  parts.push(`Week of: ${weekKey}`);
  parts.push(`Meeting time: ${meetingTime}`);
  if (person.sections.standingTopics.length > 0) {
    parts.push(`Standing topics: ${person.sections.standingTopics.join("; ")}`);
  }

  const personFile = app.vault.getAbstractFileByPath(person.filePath);
  if (personFile instanceof TFile) {
    const content = await app.vault.read(personFile);
    parts.push(`\n## People Note\n${content.substring(0, 2000)}`);
  }

  const meetings = indexService.findMeetingsForPerson(person.name);
  const meetingSnippets: string[] = [];
  for (const meetingPath of meetings.slice(0, 5)) {
    const file = app.vault.getAbstractFileByPath(meetingPath);
    if (file instanceof TFile) {
      const content = await app.vault.read(file);
      meetingSnippets.push(`-- ${file.basename} --\n${content.substring(0, 1200)}`);
    }
  }
  if (meetingSnippets.length > 0) {
    parts.push(`\n## Past Meetings\n${meetingSnippets.join("\n\n")}`);
  }

  if (person.o3Doc) {
    const fileId = googleServices.extractDriveFileId(person.o3Doc);
    if (fileId) {
      const docContent = await googleServices.getDocContent(fileId);
      if (docContent) {
        parts.push(`\n## O3 Doc (latest)\n${docContent.substring(0, 3000)}`);
      }
    }
  }

  parts.push(`\n## Output Requirements
Return markdown with these sections (omit empty ones):
### Follow-ups to Discuss
- [ ] question
### Updates You Need to Prepare
- [ ] item
### Discussion Topics
1. "Question"
### Feedback to Give
**What I liked:** bullets
**What I wish would change:** bullets

Rules:
- Specific names, dates, commitments. No generic questions.
- Highlight overdue action items and accountability gaps.
- If something is stale, call it out.
`);

  return parts.join("\n");
}

/**
 * Ensure a section exists in generated content
 */
export function ensureSection(title: string, content: string): string {
  if (content.includes(`### ${title}`)) return content;
  return `${content.trim()}\n\n### ${title}\n`;
}

/**
 * Inject tasks into a section
 */
export function injectTasks(title: string, tasks: string[], content: string): string {
  if (!tasks || tasks.length === 0) return content;
  const unique = Array.from(new Set(tasks));
  const taskLines = unique.map((t) => `- [ ] ${t}`);
  const re = new RegExp(`### ${title}\\n([\\s\\S]*?)(?=\\n### |\\n## |$)`, "m");
  const match = content.match(re);
  if (!match) {
    return `${content.trim()}\n\n### ${title}\n${taskLines.join("\n")}`;
  }
  const existing = match[0];
  const merged = `### ${title}\n${taskLines.join("\n")}\n${match[1].trim()}`;
  return content.replace(existing, merged.trimEnd());
}

// ============================================================================
// Helpers
// ============================================================================

export function getWeekKey(dateTime?: string): string {
  const base = dateTime ? moment(dateTime) : moment();
  return base.startOf("isoWeek").format("YYYY-MM-DD");
}

export function buildPersonHeading(person: O3Person, event: CalendarEvent | null): string {
  if (!event?.start?.dateTime) return `### ${person.name}`;
  const time = moment(event.start.dateTime).format("ddd, HH:mm");
  return `### ${person.name} — ${time}`;
}

export function getPersonKey(person: O3Person): string {
  if (person.email) return person.email.toLowerCase();
  return person.filePath.toLowerCase();
}
