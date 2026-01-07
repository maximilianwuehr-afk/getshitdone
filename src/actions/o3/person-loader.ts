// ============================================================================
// Person Loader - O3 person loading and resolution
// ============================================================================

import { App, TFile } from "obsidian";
import type { PluginSettings, Attendee } from "../../types";
import { VaultSearchService } from "../../services/vault-search";
import { IndexService } from "../../services/index-service";
import { handleError } from "../../utils/error-handler";
import type { O3Person } from "./types";
import { parseO3Sections } from "./context-builder";

// ============================================================================
// Public API
// ============================================================================

/**
 * Get all O3 people from index
 */
export async function getO3People(
  app: App,
  settings: PluginSettings,
  indexService: IndexService,
  vaultSearch: VaultSearchService
): Promise<O3Person[]> {
  const paths = indexService.getO3PeoplePaths();
  const people: O3Person[] = [];
  for (const path of paths) {
    try {
      const person = await loadPerson(app, vaultSearch, path);
      if (person) people.push(person);
    } catch (error: unknown) {
      handleError("Failed to load O3 person", error, { silent: true });
    }
  }
  return people;
}

/**
 * Load a person from a file path
 */
export async function loadPerson(
  app: App,
  vaultSearch: VaultSearchService,
  path: string
): Promise<O3Person> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) {
    throw new Error(`People note not found: ${path}`);
  }
  const content = await app.vault.read(file);
  const fm = vaultSearch.parseFrontmatter<Record<string, any>>(content);
  const sections = parseO3Sections(content);

  const email = extractPrimaryEmail(fm);
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

/**
 * Resolve person from attendee
 */
export async function resolvePersonFromAttendee(
  app: App,
  settings: PluginSettings,
  vaultSearch: VaultSearchService,
  indexService: IndexService,
  attendee: Attendee,
  o3People: O3Person[]
): Promise<O3Person | null> {
  const email = (attendee.email || "").toLowerCase();
  if (email) {
    const path = indexService.findPersonByEmail(email);
    if (path) {
      try {
        return await loadPerson(app, vaultSearch, path);
      } catch (error: unknown) {
        handleError("Failed to load People note by email", error, { silent: true });
      }
    }
    const existing = o3People.find((p) => (p.email || "").toLowerCase() === email);
    if (existing) return existing;
  }

  const name = attendee.displayName || humanizeEmail(attendee.email);
  const byName = await vaultSearch.findPeopleNoteByName(name);
  if (byName) {
    try {
      return await loadPerson(app, vaultSearch, `${settings.peopleFolder}/${byName}.md`);
    } catch (error: unknown) {
      handleError("Failed to load People note by name", error, { silent: true });
    }
  }
  return null;
}

/**
 * Get last meeting date for a person
 */
export async function getLastMeetingDate(
  app: App,
  indexService: IndexService,
  person: O3Person
): Promise<string | null> {
  const meetingPaths = indexService.findMeetingsForPerson(person.name);
  if (!meetingPaths || meetingPaths.length === 0) return null;

  let latest: string | null = null;
  for (const path of meetingPaths) {
    const file = app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) continue;
    const fileCache = app.metadataCache.getFileCache(file);
    const date = extractMeetingDate(file, fileCache?.frontmatter);
    if (date && (!latest || date > latest)) {
      latest = date;
    }
  }

  return latest;
}

/**
 * Ensure O3 meeting ID is stored in frontmatter
 */
export async function ensureO3MeetingId(
  app: App,
  vaultSearch: VaultSearchService,
  personPath: string,
  meetingId: string
): Promise<void> {
  const file = app.vault.getAbstractFileByPath(personPath);
  if (!(file instanceof TFile)) return;
  const content = await app.vault.read(file);
  if (content.includes("o3_meeting_id:")) return;
  const updated = vaultSearch.updateFrontmatterInContent(content, "o3_meeting_id", meetingId);
  if (updated !== content) {
    await app.vault.modify(file, updated);
  }
}

// ============================================================================
// Helpers
// ============================================================================

export function extractPrimaryEmail(frontmatter: Record<string, any>): string | null {
  const raw = frontmatter.Email || frontmatter.email;
  if (!raw) return null;
  if (Array.isArray(raw)) {
    const first = raw.find((e) => typeof e === "string" && e.trim());
    return first ? first.trim() : null;
  }
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  return null;
}

export function extractMeetingDate(file: TFile, frontmatter?: Record<string, any>): string | null {
  const fmDate = frontmatter?.date || frontmatter?.start;
  if (typeof fmDate === "string") {
    const match = fmDate.match(/\d{4}-\d{2}-\d{2}/);
    if (match) return match[0];
  }
  const nameMatch = file.basename.match(/\d{4}-\d{2}-\d{2}/);
  if (nameMatch) return nameMatch[0];
  return null;
}

export function humanizeEmail(email: string): string {
  return email
    .split("@")[0]
    .split(/[._]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function isLikelyRoomName(name: string): boolean {
  const n = (name || "").trim().toLowerCase();
  if (!n) return false;
  return /^p\d+-\d+/.test(n);
}

/**
 * Filter attendees to exclude self, rooms, and excluded names/emails
 */
export function filterAttendees(attendees: Attendee[], settings: PluginSettings): Attendee[] {
  return (attendees || []).filter((a) => {
    if (a.self) return false;
    const rawName = a.displayName || humanizeEmail(a.email);
    const name = (rawName || "").toLowerCase();
    const email = (a.email || "").toLowerCase();

    if (settings.excludeEmails.some((sub) => email.includes(sub.toLowerCase()))) return false;
    if (settings.excludeNames.some((sub) => name.includes(sub.toLowerCase()))) return false;
    if (email.includes("resource.calendar.google.com")) return false;
    if (isLikelyRoomName(rawName || "")) return false;
    return true;
  });
}
