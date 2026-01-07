// ============================================================================
// Master Note - O3 master note CRUD operations
// ============================================================================

import { App, TFile, TFolder } from "obsidian";
import type { PluginSettings } from "../../types";
import { handleError } from "../../utils/error-handler";
import { WEEK_MARKER_PREFIX, PERSON_MARKER_PREFIX } from "./types";

// ============================================================================
// Master Note Management
// ============================================================================

/**
 * Ensure master note exists, create if needed
 */
export async function ensureMasterNote(
  app: App,
  settings: PluginSettings
): Promise<TFile | null> {
  const path = settings.o3.masterNotePath;
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) return existing;

  await ensureFolderExists(app, path);
  const content = "# O3 Prep\n";
  try {
    return await app.vault.create(path, content);
  } catch (error: unknown) {
    handleError("Failed to create master O3 prep note", error, { showNotice: true });
    return null;
  }
}

/**
 * Ensure folder exists for a file path
 */
export async function ensureFolderExists(app: App, filePath: string): Promise<void> {
  const folderPath = filePath.split("/").slice(0, -1).join("/");
  if (!folderPath) return;
  const folder = app.vault.getAbstractFileByPath(folderPath);
  if (folder instanceof TFolder) return;

  const parts = folderPath.split("/");
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    const existing = app.vault.getAbstractFileByPath(current);
    if (!existing) {
      await app.vault.createFolder(current);
    }
  }
}

// ============================================================================
// Section Operations
// ============================================================================

/**
 * Upsert a person section in master note
 */
export function upsertPersonSection(
  content: string,
  weekKey: string,
  personKey: string,
  heading: string,
  body: string
): string {
  let updated = content;
  const weekMarker = `${WEEK_MARKER_PREFIX}${weekKey} -->`;
  const weekHeader = `## Week of ${weekKey}\n${weekMarker}`;

  if (!updated.includes(weekMarker)) {
    const lines = updated.split("\n");
    const insertIdx = lines[0]?.startsWith("# ") ? 1 : 0;
    lines.splice(insertIdx + 1, 0, "", weekHeader, "");
    updated = lines.join("\n");
  }

  const section = extractWeekSection(updated, weekKey);
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
    const bodyLines = body.trim().split("\n");
    lines.splice(markerIdx + 1, endIdx - markerIdx - 1, ...bodyLines);
  }

  return replaceWeekSection(updated, section.startIdx, section.endIdx, lines.join("\n"));
}

/**
 * Extract person section from master note
 */
export function extractPersonSection(
  content: string,
  weekKey: string,
  personKey: string
): string | null {
  const weekSection = extractWeekSection(content, weekKey);
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
  return lines.slice(markerIdx + 1, endIdx).join("\n").trim();
}

/**
 * Extract week section from master note
 */
export function extractWeekSection(
  content: string,
  weekKey: string
): { lines: string[]; startIdx: number; endIdx: number } | null {
  const weekMarker = `${WEEK_MARKER_PREFIX}${weekKey} -->`;
  const lines = content.split("\n");
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

/**
 * Replace week section in content
 */
export function replaceWeekSection(
  content: string,
  startIdx: number,
  endIdx: number,
  newSection: string
): string {
  const lines = content.split("\n");
  lines.splice(startIdx, endIdx - startIdx, ...newSection.split("\n"));
  return lines.join("\n");
}

// ============================================================================
// Task Operations
// ============================================================================

/**
 * Add task to O3 section in a People note
 */
export async function addTaskToO3Section(
  app: App,
  personPath: string,
  sectionTitle: string,
  text: string
): Promise<void> {
  const file = app.vault.getAbstractFileByPath(personPath);
  if (!(file instanceof TFile)) return;
  const content = await app.vault.read(file);
  const updated = upsertTask(content, sectionTitle, text);
  if (updated !== content) {
    await app.vault.modify(file, updated);
  }
}

/**
 * Remove task from O3 section in a People note
 */
export async function removeTaskFromO3Section(
  app: App,
  personPath: string,
  sectionTitle: string,
  text: string
): Promise<void> {
  const file = app.vault.getAbstractFileByPath(personPath);
  if (!(file instanceof TFile)) return;
  const content = await app.vault.read(file);
  const updated = removeTask(content, sectionTitle, text);
  if (updated !== content) {
    await app.vault.modify(file, updated);
  }
}

/**
 * Upsert a task in O3 section
 */
export function upsertTask(content: string, sectionTitle: string, text: string): string {
  const lines = content.split("\n");
  let o3Idx = lines.findIndex((l) => l.trim().toLowerCase() === "## o3");
  if (o3Idx === -1) {
    lines.push("");
    lines.push("## O3");
    lines.push("");
    lines.push(`### ${sectionTitle}`);
    lines.push(`- [ ] ${text}`);
    return lines.join("\n");
  }

  const sectionIdx = findSectionIndex(lines, o3Idx + 1, sectionTitle);
  if (sectionIdx === -1) {
    lines.splice(o3Idx + 1, 0, "", `### ${sectionTitle}`, `- [ ] ${text}`);
    return lines.join("\n");
  }

  // Insert after section heading, avoid duplicates
  const insertAt = sectionIdx + 1;
  const exists = lines.slice(insertAt).some((l) => l.includes(text));
  if (!exists) {
    lines.splice(insertAt, 0, `- [ ] ${text}`);
  }
  return lines.join("\n");
}

/**
 * Remove a task from O3 section
 */
export function removeTask(content: string, sectionTitle: string, text: string): string {
  const lines = content.split("\n");
  const o3Idx = lines.findIndex((l) => l.trim().toLowerCase() === "## o3");
  if (o3Idx === -1) return content;
  const sectionIdx = findSectionIndex(lines, o3Idx + 1, sectionTitle);
  if (sectionIdx === -1) return content;

  for (let i = sectionIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("### ") || line.startsWith("## ")) break;
    if (line.includes(text)) {
      lines.splice(i, 1);
      break;
    }
  }
  return lines.join("\n");
}

/**
 * Find section index within O3 section
 */
export function findSectionIndex(lines: string[], startIdx: number, sectionTitle: string): number {
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

/**
 * Append text to a section in content
 */
export function appendToSection(content: string, sectionTitle: string, text: string): string {
  const normalized = content.trim();
  const heading = `### ${sectionTitle}`;
  if (!normalized) {
    return `${heading}\n- ${text.trim()}`.trim();
  }

  const regex = new RegExp(`### ${escapeRegex(sectionTitle)}\\n([\\s\\S]*?)(?=\\n### |\\n## |$)`, "m");
  const match = normalized.match(regex);
  if (!match) {
    return `${normalized}\n\n${heading}\n- ${text.trim()}`.trim();
  }

  const existingBlock = match[0];
  const updatedBlock = `${heading}\n- ${text.trim()}\n${match[1].trim()}`.trim();
  return normalized.replace(existingBlock, updatedBlock);
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
