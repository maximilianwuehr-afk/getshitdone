// ============================================================================
// Index Service - In-memory indexes for people/org lookups
// ============================================================================

import { App, TFile, MetadataCache, Vault } from "obsidian";
import type { PluginSettings } from "../types";

// ============================================================================
// IndexService Class
// ============================================================================

/**
 * Index Service - Maintains in-memory indexes for fast lookups
 * Builds indexes on load and updates them on file changes
 */
export class IndexService {
  private app: App;
  private settings: PluginSettings;
  private cache: MetadataCache;
  private vault: Vault;

  // In-memory indexes
  private emailToPersonPath: Map<string, string> = new Map();
  private nameToPersonPath: Map<string, string> = new Map();
  private domainToOrgPath: Map<string, string> = new Map();
  private nameToOrgPath: Map<string, string> = new Map();
  private personToMeetings: Map<string, string[]> = new Map();
  private o3PeoplePaths: Set<string> = new Set();

  // Word-based index for fast entity mention detection
  // Maps lowercase words (3+ chars) to entities that contain that word in their name
  private wordToEntities: Map<string, Array<{ type: "person" | "org"; name: string; path: string }>> = new Map();

  // Index state
  private isIndexed: boolean = false;
  private indexPromise: Promise<void> | null = null;

  constructor(app: App, settings: PluginSettings) {
    this.app = app;
    this.settings = settings;
    this.cache = app.metadataCache;
    this.vault = app.vault;
  }

  /**
   * Update settings reference
   */
  updateSettings(settings: PluginSettings): void {
    this.settings = settings;
  }

  /**
   * Build all indexes
   */
  async buildIndexes(): Promise<void> {
    // Prevent multiple simultaneous index builds
    if (this.indexPromise) {
      return this.indexPromise;
    }

    this.indexPromise = this._buildIndexes();
    await this.indexPromise;
    this.indexPromise = null;
  }

  private async _buildIndexes(): Promise<void> {
    const startTime = Date.now();
    console.log("[GSD] Building indexes...");

    // Clear existing indexes
    this.emailToPersonPath.clear();
    this.nameToPersonPath.clear();
    this.domainToOrgPath.clear();
    this.nameToOrgPath.clear();
    this.personToMeetings.clear();
    this.wordToEntities.clear();
    this.o3PeoplePaths.clear();

    const allFiles = this.vault.getMarkdownFiles();

    // Index People notes
    const peopleFiles = allFiles.filter((f: TFile) =>
      f.path.startsWith(this.settings.peopleFolder + "/")
    );
    for (const file of peopleFiles) {
      this.indexPersonFile(file);
    }

    // Index Organization notes
    const orgFiles = allFiles.filter((f: TFile) =>
      f.path.startsWith(this.settings.organizationsFolder + "/")
    );
    for (const file of orgFiles) {
      this.indexOrgFile(file);
    }

    // Index Meeting notes for participant lookup
    const meetingFiles = allFiles.filter((f: TFile) =>
      f.path.startsWith(this.settings.meetingsFolder + "/")
    );
    await this.indexMeetingFiles(meetingFiles);

    this.isIndexed = true;
    const elapsed = Date.now() - startTime;
    console.log(
      `[GSD] Indexes built in ${elapsed}ms: ${this.emailToPersonPath.size} emails, ${this.domainToOrgPath.size} domains, ${this.personToMeetings.size} person-meeting mappings`
    );
  }

  /**
   * Index a single person file using MetadataCache
   */
  private indexPersonFile(file: TFile): void {
    const fileCache = this.cache.getFileCache(file);
    if (!fileCache?.frontmatter) return;

    const fm = fileCache.frontmatter;
    const name = file.basename;
    const nameLower = name.toLowerCase();

    // Index by name
    this.nameToPersonPath.set(nameLower, file.path);

    // Index by email
    const email = fm.Email || fm.email;
    if (email) {
      if (Array.isArray(email)) {
        for (const e of email) {
          if (typeof e === "string" && e.trim()) {
            this.emailToPersonPath.set(e.toLowerCase().trim(), file.path);
          }
        }
      } else if (typeof email === "string" && email.trim()) {
        this.emailToPersonPath.set(email.toLowerCase().trim(), file.path);
      }
    }

    if (this.isO3Person(fm)) {
      this.o3PeoplePaths.add(file.path);
    }

    // Index by name words for fast mention detection
    this.indexEntityByWords("person", name, file.path);
  }

  /**
   * Index a single org file using MetadataCache
   */
  private indexOrgFile(file: TFile): void {
    const fileCache = this.cache.getFileCache(file);
    if (!fileCache?.frontmatter) return;

    const fm = fileCache.frontmatter;
    const name = file.basename;
    const nameLower = name.toLowerCase();

    // Index by name
    this.nameToOrgPath.set(nameLower, file.path);

    // Index by domain
    const domain = fm.Domain || fm.domain;
    if (domain && typeof domain === "string" && domain.trim()) {
      this.domainToOrgPath.set(domain.toLowerCase().trim(), file.path);
    }

    // Index by name words for fast mention detection
    this.indexEntityByWords("org", name, file.path);
  }

  /**
   * Add entity to word-based index
   * Splits name into words (3+ chars) and indexes each
   */
  private indexEntityByWords(type: "person" | "org", name: string, path: string): void {
    const words = name.toLowerCase().split(/\s+/).filter(w => w.length >= 3);
    const entity = { type, name, path };

    for (const word of words) {
      if (!this.wordToEntities.has(word)) {
        this.wordToEntities.set(word, []);
      }
      this.wordToEntities.get(word)!.push(entity);
    }

    // Also index the full name as a single key for exact matches
    const fullNameKey = name.toLowerCase();
    if (fullNameKey.length >= 3 && !this.wordToEntities.has(fullNameKey)) {
      this.wordToEntities.set(fullNameKey, []);
    }
    if (fullNameKey.length >= 3) {
      this.wordToEntities.get(fullNameKey)!.push(entity);
    }
  }

  /**
   * Index meeting files for participant lookup
   * Uses links in the file to map people to meetings
   */
  private async indexMeetingFiles(files: TFile[]): Promise<void> {
    for (const file of files) {
      const fileCache = this.cache.getFileCache(file);
      if (!fileCache?.links) continue;

      // Find links to People folder
      for (const link of fileCache.links) {
        const linkPath = link.link;
        if (linkPath.startsWith(this.settings.peopleFolder + "/")) {
          const personName = linkPath
            .replace(this.settings.peopleFolder + "/", "")
            .toLowerCase();

          if (!this.personToMeetings.has(personName)) {
            this.personToMeetings.set(personName, []);
          }
          this.personToMeetings.get(personName)!.push(file.path);
        }
      }
    }
  }

  /**
   * Update index for a single file (called on file changes)
   */
  updateFileIndex(file: TFile): void {
    if (!this.isIndexed) return;

    if (file.path.startsWith(this.settings.peopleFolder + "/")) {
      // Remove old entries for this file
      this.removePersonFromIndex(file.path);
      // Re-index
      this.indexPersonFile(file);
    } else if (file.path.startsWith(this.settings.organizationsFolder + "/")) {
      this.removeOrgFromIndex(file.path);
      this.indexOrgFile(file);
    }
  }

  /**
   * Remove a person from the index
   */
  private removePersonFromIndex(filePath: string): void {
    // Find and remove email entry
    for (const [email, path] of this.emailToPersonPath.entries()) {
      if (path === filePath) {
        this.emailToPersonPath.delete(email);
        break;
      }
    }
    // Find and remove name entry
    for (const [name, path] of this.nameToPersonPath.entries()) {
      if (path === filePath) {
        this.nameToPersonPath.delete(name);
        break;
      }
    }
    this.o3PeoplePaths.delete(filePath);
  }

  /**
   * Remove an org from the index
   */
  private removeOrgFromIndex(filePath: string): void {
    for (const [domain, path] of this.domainToOrgPath.entries()) {
      if (path === filePath) {
        this.domainToOrgPath.delete(domain);
        break;
      }
    }
    for (const [name, path] of this.nameToOrgPath.entries()) {
      if (path === filePath) {
        this.nameToOrgPath.delete(name);
        break;
      }
    }
  }

  // ============================================================================
  // Lookup Methods
  // ============================================================================

  /**
   * Find person note path by email (O(1) lookup)
   */
  findPersonByEmail(email: string): string | null {
    if (!email) return null;
    return this.emailToPersonPath.get(email.toLowerCase().trim()) || null;
  }

  /**
   * Find person note path by name (O(1) lookup)
   */
  findPersonByName(name: string): string | null {
    if (!name) return null;
    return this.nameToPersonPath.get(name.toLowerCase().trim()) || null;
  }

  /**
   * Find org note path by domain (O(1) lookup)
   */
  findOrgByDomain(domain: string): string | null {
    if (!domain) return null;
    return this.domainToOrgPath.get(domain.toLowerCase().trim()) || null;
  }

  /**
   * Find org note path by name (O(1) lookup)
   */
  findOrgByName(name: string): string | null {
    if (!name) return null;
    return this.nameToOrgPath.get(name.toLowerCase().trim()) || null;
  }

  /**
   * Find meetings that include a person (O(1) lookup)
   */
  findMeetingsForPerson(personName: string): string[] {
    if (!personName) return [];
    return this.personToMeetings.get(personName.toLowerCase().trim()) || [];
  }

  /**
   * Find entities mentioned in content using word-based index
   * O(n) where n = number of words in content, not number of entities
   * Returns deduplicated list of matching entities
   */
  findEntitiesInContent(content: string): Array<{ type: "person" | "org"; name: string; path: string }> {
    if (!content) return [];

    // Extract words from content (3+ chars, alphanumeric)
    const contentWords = content.toLowerCase().match(/\b[a-z]{3,}\b/g) || [];
    const seen = new Set<string>();
    const results: Array<{ type: "person" | "org"; name: string; path: string }> = [];

    for (const word of contentWords) {
      const entities = this.wordToEntities.get(word);
      if (entities) {
        for (const entity of entities) {
          if (!seen.has(entity.path)) {
            seen.add(entity.path);
            results.push(entity);
          }
        }
      }
    }

    return results;
  }

  /**
   * Check if person note exists by email (O(1))
   */
  personExistsByEmail(email: string): boolean {
    return this.findPersonByEmail(email) !== null;
  }

  /**
   * Check if person note exists by name (O(1))
   */
  personExistsByName(name: string): boolean {
    return this.findPersonByName(name) !== null;
  }

  /**
   * Get O3 people note paths
   */
  getO3PeoplePaths(): string[] {
    return Array.from(this.o3PeoplePaths.values());
  }

  /**
   * Check if org note exists by domain (O(1))
   */
  orgExistsByDomain(domain: string): boolean {
    return this.findOrgByDomain(domain) !== null;
  }

  /**
   * Get person's email from MetadataCache (no file read needed)
   */
  getPersonEmail(filePath: string): string | null {
    const file = this.vault.getAbstractFileByPath(filePath);
    if (!file || !(file instanceof TFile)) return null;

    const fileCache = this.cache.getFileCache(file);
    const email = fileCache?.frontmatter?.Email || fileCache?.frontmatter?.email;
    if (Array.isArray(email)) {
      const first = email.find((e) => typeof e === "string" && e.trim());
      return first ? first.trim() : null;
    }
    return email && typeof email === "string" ? email.trim() : null;
  }

  /**
   * Get person's organization from MetadataCache
   */
  getPersonOrganization(filePath: string): string | null {
    const file = this.vault.getAbstractFileByPath(filePath);
    if (!file || !(file instanceof TFile)) return null;

    const fileCache = this.cache.getFileCache(file);
    const org =
      fileCache?.frontmatter?.Organization || fileCache?.frontmatter?.organization;
    if (!org || typeof org !== "string") return null;

    // Extract from wikilink format: "[[OrgName]]" or "[[Organizations/OrgName]]"
    const match = org.match(/\[\[(?:Organizations\/)?([^\]|]+)/);
    return match ? match[1] : org.trim();
  }

  /**
   * Check if note is researched using MetadataCache
   */
  isResearched(filePath: string): boolean {
    const file = this.vault.getAbstractFileByPath(filePath);
    if (!file || !(file instanceof TFile)) return false;

    const fileCache = this.cache.getFileCache(file);
    const researched = fileCache?.frontmatter?.researched;
    return researched === true || researched === "true";
  }

  /**
   * Get all indexed people emails
   */
  getAllPeopleEmails(): string[] {
    return Array.from(this.emailToPersonPath.keys());
  }

  /**
   * Get index stats
   */
  getStats(): {
    peopleByEmail: number;
    peopleByName: number;
    orgsByDomain: number;
    orgsByName: number;
    personMeetingMappings: number;
    entityWords: number;
    o3People: number;
  } {
    return {
      peopleByEmail: this.emailToPersonPath.size,
      peopleByName: this.nameToPersonPath.size,
      orgsByDomain: this.domainToOrgPath.size,
      orgsByName: this.nameToOrgPath.size,
      personMeetingMappings: this.personToMeetings.size,
      entityWords: this.wordToEntities.size,
      o3People: this.o3PeoplePaths.size,
    };
  }

  private isO3Person(frontmatter: Record<string, any>): boolean {
    const raw = frontmatter.o3 ?? frontmatter.O3;
    if (raw === true) return true;
    if (raw === false || raw == null) return false;
    if (typeof raw === "string") {
      const v = raw.trim().toLowerCase();
      return v === "true" || v === "yes" || v === "1" || v === "y";
    }
    return false;
  }
}
