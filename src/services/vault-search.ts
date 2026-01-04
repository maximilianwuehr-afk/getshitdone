import { App, TFile, Vault } from "obsidian";
import type { PluginSettings, PersonFrontmatter, OrgFrontmatter } from "../types";
import type { IndexService } from "./index-service";

/**
 * Vault Search Service - Searches and manages vault content
 * Provides context gathering, note lookup, and frontmatter parsing
 * Uses IndexService for O(1) lookups when available
 */
export class VaultSearchService {
  private app: App;
  private vault: Vault;
  private settings: PluginSettings;
  private indexService: IndexService;

  constructor(app: App, settings: PluginSettings, indexService: IndexService) {
    this.app = app;
    this.vault = app.vault;
    this.settings = settings;
    this.indexService = indexService;
  }

  /**
   * Update settings reference
   */
  updateSettings(settings: PluginSettings): void {
    this.settings = settings;
  }

  // ============================================================================
  // People Notes
  // ============================================================================

  /**
   * Find a People note by email address (O(1) via index)
   */
  async findPeopleNoteByEmail(email: string): Promise<string | null> {
    if (!email) return null;

    // Try index first (O(1) lookup)
    const indexPath = this.indexService.findPersonByEmail(email);
    if (indexPath) {
      const file = this.vault.getAbstractFileByPath(indexPath);
      if (file instanceof TFile) {
        return file.basename;
      }
    }

    // Fallback: scan files (slower, but handles edge cases)
    const peopleFiles = this.vault
      .getMarkdownFiles()
      .filter((f: TFile) => f.path.startsWith(this.settings.peopleFolder + "/"));

    for (const file of peopleFiles) {
      try {
        const content = await this.vault.read(file);
        if (content.toLowerCase().includes(email.toLowerCase())) {
          return file.basename;
        }
      } catch (error: unknown) {
        // Skip files that can't be read - expected behavior
        // Silently handle to avoid log spam
      }
    }

    return null;
  }

  /**
   * Check if a People note exists (O(1) via index for email-based check)
   */
  peopleNoteExists(name: string): boolean {
    const path = `${this.settings.peopleFolder}/${name}.md`;
    return !!this.vault.getAbstractFileByPath(path);
  }

  /**
   * Check if a People note exists by email (O(1))
   */
  peopleNoteExistsByEmail(email: string): boolean {
    return this.indexService.personExistsByEmail(email);
  }

  /**
   * Get People note file by name
   */
  getPeopleNote(name: string): TFile | null {
    const path = `${this.settings.peopleFolder}/${name}.md`;
    const file = this.vault.getAbstractFileByPath(path);
    return file instanceof TFile ? file : null;
  }

  /**
   * Find People note by name (O(1) via index)
   */
  async findPeopleNoteByName(name: string): Promise<string | null> {
    if (!name) return null;

    // Try index first (O(1) lookup)
    const indexPath = this.indexService.findPersonByName(name);
    if (indexPath) {
      const file = this.vault.getAbstractFileByPath(indexPath);
      if (file instanceof TFile) {
        return file.basename;
      }
    }

    // Fallback: check if file exists directly
    if (this.peopleNoteExists(name)) {
      return name;
    }

    return null;
  }

  // ============================================================================
  // Organization Notes
  // ============================================================================

  /**
   * Find existing organization by domain in vault (O(1) via index)
   */
  async findOrgByDomain(domain: string): Promise<string | null> {
    if (!domain) return null;

    // Try index first (O(1) lookup)
    const indexPath = this.indexService.findOrgByDomain(domain);
    if (indexPath) {
      const file = this.vault.getAbstractFileByPath(indexPath);
      if (file instanceof TFile) {
        return file.basename;
      }
    }

    // Fallback: scan files (slower, handles edge cases)
    const orgFiles = this.vault
      .getMarkdownFiles()
      .filter((f: TFile) => f.path.startsWith(this.settings.organizationsFolder + "/"));

    for (const file of orgFiles) {
      try {
        const content = await this.vault.read(file);
        const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
        if (!fmMatch) continue;

        const fm = fmMatch[1].toLowerCase();
        if (fm.includes(domain.toLowerCase())) {
          return file.basename;
        }
      } catch (error: unknown) {
        // Skip files that can't be read - expected behavior
        // Silently handle to avoid log spam
      }
    }

    return null;
  }

  /**
   * Check if an Organization note exists
   */
  orgNoteExists(name: string): boolean {
    const path = `${this.settings.organizationsFolder}/${name}.md`;
    return !!this.vault.getAbstractFileByPath(path);
  }

  /**
   * Check if an Organization note exists by domain (O(1))
   */
  orgNoteExistsByDomain(domain: string): boolean {
    return this.indexService.orgExistsByDomain(domain);
  }

  /**
   * Get Organization note file by name
   */
  getOrgNote(name: string): TFile | null {
    const path = `${this.settings.organizationsFolder}/${name}.md`;
    const file = this.vault.getAbstractFileByPath(path);
    return file instanceof TFile ? file : null;
  }

  /**
   * Find Organization note by name (O(1) via index)
   */
  async findOrgNoteByName(name: string): Promise<string | null> {
    if (!name) return null;

    // Try index first (O(1) lookup)
    const indexPath = this.indexService.findOrgByName(name);
    if (indexPath) {
      const file = this.vault.getAbstractFileByPath(indexPath);
      if (file instanceof TFile) {
        return file.basename;
      }
    }

    // Fallback: check if file exists directly
    if (this.orgNoteExists(name)) {
      return name;
    }

    return null;
  }

  // ============================================================================
  // Indexed Meeting Lookups
  // ============================================================================

  /**
   * Find meetings involving a person (O(1) via index)
   */
  findMeetingsForPerson(personName: string): string[] {
    return this.indexService.findMeetingsForPerson(personName);
  }

  /**
   * Check if note is researched via MetadataCache (no file read needed)
   */
  isResearchedFast(filePath: string): boolean {
    return this.indexService.isResearched(filePath);
  }

  // ============================================================================
  // Context Search
  // ============================================================================

  /**
   * Search vault for context about a person
   */
  async searchPersonContext(name: string): Promise<string> {
    let context = "";
    const allFiles = this.vault.getMarkdownFiles();

    for (const file of allFiles) {
      if (file.path.startsWith(this.settings.peopleFolder + "/")) continue;

      try {
        const content = await this.vault.read(file);
        if (content.toLowerCase().includes(name.toLowerCase())) {
          const lines = content.split("\n");
          const relevantLines = lines
            .filter((line: string) => line.toLowerCase().includes(name.toLowerCase()))
            .slice(0, 3);

          if (relevantLines.length > 0) {
            context += `\n-- From [[${file.path.replace(".md", "")}]] --\n${relevantLines.join("\n")}\n`;
          }
        }
      } catch (error: unknown) {
        // Skip files that can't be read - expected behavior
        // Silently handle to avoid log spam
      }
    }

    return context.substring(0, 2000);
  }

  /**
   * Search vault for context about an organization
   */
  async searchOrgContext(orgName: string): Promise<string> {
    let context = "";
    const allFiles = this.vault.getMarkdownFiles();

    for (const file of allFiles) {
      if (file.path.startsWith(this.settings.organizationsFolder + "/")) continue;

      try {
        const content = await this.vault.read(file);
        if (content.toLowerCase().includes(orgName.toLowerCase())) {
          const lines = content.split("\n");
          const relevantLines = lines
            .filter((line: string) => line.toLowerCase().includes(orgName.toLowerCase()))
            .slice(0, 3);

          if (relevantLines.length > 0) {
            context += `\n-- From [[${file.path.replace(".md", "")}]] --\n${relevantLines.join("\n")}\n`;
          }
        }
      } catch (error: unknown) {
        // Skip files that can't be read - expected behavior
        // Silently handle to avoid log spam
      }
    }

    // Also check People notes linked to this org
    const peopleFiles = allFiles.filter((f: TFile) =>
      f.path.startsWith(this.settings.peopleFolder + "/")
    );
    for (const file of peopleFiles) {
      try {
        const content = await this.vault.read(file);
        if (content.includes(`[[${orgName}]]`)) {
          context += `\n-- Employee: [[${file.path.replace(".md", "")}]] --\n`;
        }
    } catch (error: unknown) {
      // Skip - expected behavior for invalid files
    }
    }

    return context.substring(0, 2000);
  }

  // ============================================================================
  // Frontmatter Utilities
  // ============================================================================

  /**
   * Parse frontmatter from note content
   * Handles both simple values and YAML list values
   */
  parseFrontmatter<T extends Record<string, any>>(content: string): T {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return {} as T;

    const fm: Record<string, any> = {};
    const lines = match[1].split("\n");
    let currentKey: string | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Check if this is a list item (continuation of previous key)
      if (line.match(/^\s+-\s/)) {
        if (currentKey) {
          // This is a list item for the current key
          const listValue = line.replace(/^\s+-\s*/, "").trim();
          let cleanValue = listValue;
          if (cleanValue.startsWith('"') && cleanValue.endsWith('"')) {
            cleanValue = cleanValue.slice(1, -1);
          }
          // If key was empty or not an array, make it an array with this value
          if (!fm[currentKey] || fm[currentKey] === "") {
            fm[currentKey] = cleanValue;
          } else if (!Array.isArray(fm[currentKey])) {
            fm[currentKey] = [fm[currentKey], cleanValue];
          } else {
            fm[currentKey].push(cleanValue);
          }
        }
        continue;
      }
      
      const colonIdx = line.indexOf(":");
      if (colonIdx > 0) {
        const key = line.substring(0, colonIdx).trim();
        let value = line.substring(colonIdx + 1).trim();
        currentKey = key;
        
        if (value.startsWith('"') && value.endsWith('"')) {
          value = value.slice(1, -1);
        }
        // Handle boolean values
        if (value === "true") {
          fm[key] = true;
        } else if (value === "false") {
          fm[key] = false;
        } else {
          fm[key] = value;
        }
      }
    }

    return fm as T;
  }

  /**
   * Update frontmatter field in content string
   * Handles both simple values and YAML list continuations
   */
  updateFrontmatterInContent(content: string, key: string, value: string): string {
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) return content;

    const lines = fmMatch[1].split("\n");
    const resultLines: string[] = [];
    let foundKey = false;
    let skipListItems = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Check if this is a list item (indented with -)
      if (line.match(/^\s+-\s/)) {
        // If we're in the middle of replacing a key, skip its list items
        if (skipListItems) {
          continue;
        }
        resultLines.push(line);
        continue;
      }
      
      // Check if this line starts a new key
      const colonIdx = line.indexOf(":");
      if (colonIdx > 0) {
        const lineKey = line.substring(0, colonIdx).trim();
        
        if (lineKey === key) {
          // Replace this key's value and mark to skip any following list items
          resultLines.push(`${key}: ${value}`);
          foundKey = true;
          skipListItems = true;
        } else {
          // Different key, stop skipping list items
          skipListItems = false;
          resultLines.push(line);
        }
      } else {
        // Not a key line, not a list item - keep it
        skipListItems = false;
        resultLines.push(line);
      }
    }

    // If key wasn't found, add it
    if (!foundKey) {
      resultLines.push(`${key}: ${value}`);
    }

    return content.replace(/^---\n[\s\S]*?\n---/, `---\n${resultLines.join("\n")}\n---`);
  }

  /**
   * Check if a note is already researched
   */
  isResearched(content: string): boolean {
    const fm = this.parseFrontmatter<{ researched?: boolean | string }>(content);
    return fm.researched === true || fm.researched === "true";
  }

  /**
   * Check if research is currently in progress for a note
   */
  isResearchInProgress(content: string): boolean {
    return content.includes("⏳ Researching");
  }

  // ============================================================================
  // File Operations
  // ============================================================================

  /**
   * Append text to a note
   */
  async appendToNote(filePath: string, text: string): Promise<void> {
    const file = this.vault.getAbstractFileByPath(filePath);
    if (!file || !(file instanceof TFile)) return;

    const content = await this.vault.read(file);
    await this.vault.modify(file, content + text);
  }

  /**
   * Replace text in a file
   */
  async replaceInFile(filePath: string, oldString: string, newString: string): Promise<void> {
    const file = this.vault.getAbstractFileByPath(filePath);
    if (!file || !(file instanceof TFile)) return;

    const content = await this.vault.read(file);
    if (content.includes(oldString)) {
      const newContent = content.replace(oldString, newString);
      await this.vault.modify(file, newContent);
    }
  }

  /**
   * Insert text after a line containing a search string
   */
  async insertAfterLineContaining(
    filePath: string,
    searchString: string,
    textToInsert: string
  ): Promise<void> {
    const file = this.vault.getAbstractFileByPath(filePath);
    if (!file || !(file instanceof TFile)) return;

    const content = await this.vault.read(file);
    const lines = content.split("\n");
    const idx = lines.findIndex((line: string) => line.includes(searchString));

    if (idx !== -1) {
      // Check if already inserted to avoid dupes
      if (lines[idx + 1] && lines[idx + 1].includes("Researching context")) return;

      const cleanLine = textToInsert.startsWith("\n") ? textToInsert.substring(1) : textToInsert;
      lines.splice(idx + 1, 0, cleanLine);

      const newContent = lines.join("\n");
      await this.vault.modify(file, newContent);
    }
  }

  /**
   * Append content to a specific section in a file
   * Creates the section if it doesn't exist
   */
  async appendToSection(
    filePath: string,
    sectionHeader: string,
    textToInsert: string
  ): Promise<boolean> {
    const file = this.vault.getAbstractFileByPath(filePath);
    if (!file || !(file instanceof TFile)) return false;

    const content = await this.vault.read(file);
    const lines = content.split("\n");

    // Find section
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
          insertIdx = i;
          break;
        }
        insertIdx = i + 1;
      }
      lines.splice(insertIdx, 0, textToInsert);
    }

    await this.vault.modify(file, lines.join("\n"));
    return true;
  }

  /**
   * Get today's daily note path
   */
  async getDailyNotePath(): Promise<string | null> {
    const moment = (window as any).moment;
    const today = moment().format("YYYY-MM-DD");
    const possiblePaths = [
      `Daily notes/${today}.md`,
      `daily notes/${today}.md`,
      `Daily Notes/${today}.md`,
      `${today}.md`,
    ];

    for (const path of possiblePaths) {
      const file = this.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) {
        return path;
      }
    }

    // Try to find any file matching the date pattern
    const allFiles = this.vault.getMarkdownFiles();
    for (const file of allFiles) {
      if (file.basename === today) {
        return file.path;
      }
    }

    return null;
  }

  // ============================================================================
  // Location Notes
  // ============================================================================

  /**
   * Find an existing location note that matches the given location string
   */
  async findExistingLocation(locationStr: string): Promise<string | null> {
    if (!locationStr) return null;

    const locationFiles = this.vault
      .getMarkdownFiles()
      .filter((f: TFile) => f.path.startsWith("Locations/"));
    const searchTerms = locationStr
      .toLowerCase()
      .split(/[,\s]+/)
      .filter((t) => t.length > 2);

    // First try exact match on basename
    for (const file of locationFiles) {
      if (file.basename.toLowerCase() === locationStr.toLowerCase()) {
        return file.basename;
      }
    }

    // Then try partial match
    for (const file of locationFiles) {
      const basename = file.basename.toLowerCase();
      const mainTerm = searchTerms[0];
      if (mainTerm && basename.includes(mainTerm)) {
        return file.basename;
      }
    }

    return null;
  }
}


