import { App, TFile, Notice } from "obsidian";
import type {
  PluginSettings,
  PersonResearchResult,
  ExtractedPersonInfo,
  OrgLinkResult,
  PersonFrontmatter,
  GmailMessage,
} from "../types";
import { GoogleServices } from "../services/google-services";
import { AIService } from "../services/ai-service";
import { VaultSearchService } from "../services/vault-search";
import type { FeedbackAction } from "./feedback";
import { handleError } from "../utils/error-handler";

const moment = (window as any).moment;

/**
 * Person Research Action
 * Researches people and updates their notes with gathered information
 */
export class PersonResearchAction {
  private app: App;
  private settings: PluginSettings;
  private googleServices: GoogleServices;
  private aiService: AIService;
  private vaultSearch: VaultSearchService;
  private feedback: FeedbackAction | null = null;
  private inFlight = new Set<string>();

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
   * Update settings reference
   */
  updateSettings(settings: PluginSettings): void {
    this.settings = settings;
  }

  /**
   * Set feedback action reference
   */
  setFeedback(feedback: FeedbackAction): void {
    this.feedback = feedback;
  }

  /**
   * Research a person note by file path
   */
  async researchPerson(
    filePath: string,
    options: { force?: boolean } = {}
  ): Promise<PersonResearchResult | null> {
    // Prevent duplicate concurrent research for the same file (any caller)
    if (this.inFlight.has(filePath)) {
      console.log("[GSD] PersonResearch: Research already in-flight, skipping", filePath);
      return null;
    }
    this.inFlight.add(filePath);

    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!file || !(file instanceof TFile)) {
      console.error("[GSD] PersonResearch: Could not find file", filePath);
      this.inFlight.delete(filePath);
      return null;
    }

    try {
      const content = await this.app.vault.read(file);
      const frontmatter = this.vaultSearch.parseFrontmatter<PersonFrontmatter>(content);

      const personName = file.basename;
      const fmEmail = (frontmatter.Email || "").toString();

      // Hard stop: never research rooms/resources (prevents iOS notices + bad People notes)
      if (this.isRoomOrResourceEntity(personName, fmEmail)) {
        console.log("[GSD] PersonResearch: Detected room/resource, skipping", {
          filePath,
          personName,
          email: fmEmail,
        });
        return null;
      }

      // Check if already researched
      if (!options.force && this.vaultSearch.isResearched(content)) {
        console.log("[GSD] PersonResearch: Already researched, skipping", filePath);
        return null;
      }

      // Check if research is already in progress
      if (this.vaultSearch.isResearchInProgress(content)) {
        console.log("[GSD] PersonResearch: Research already in progress, skipping", filePath);
        return null;
      }

      new Notice(`Researching ${personName}...`);

      // Get or find email - handle both string and array values from YAML
      let email: string | undefined = undefined;
      const emailValue = frontmatter.Email;
      if (emailValue) {
        if (Array.isArray(emailValue)) {
          email = emailValue[0]; // Take first email from list
        } else if (typeof emailValue === 'string' && emailValue.trim() !== '') {
          email = emailValue.trim();
        }
      }
      
      if (!email) {
        console.log("[GSD] PersonResearch: No email found, searching Gmail...");
        email = (await this.googleServices.findEmailByName(personName)) || undefined;

        if (email) {
          // If Gmail lookup returns a resource calendar, still skip
          if (this.isRoomOrResourceEntity(personName, email)) {
            console.log(
              "[GSD] PersonResearch: Gmail lookup returned room/resource email, skipping",
              { filePath, personName, email }
            );
            return null;
          }

          console.log("[GSD] PersonResearch: Found email:", email);
          await this.updateFrontmatterField(filePath, "Email", email);
        }
      }

      // Remove old research if re-researching
      if (options.force) {
        await this.removeOldResearch(filePath);
      }

      // Show researching indicator
      await this.vaultSearch.appendToNote(filePath, "\n\n> [!info] ⏳ Researching...\n");

      try {
        // Gather research data
        const researchData = await this.gatherResearchData(personName, email);

        // Generate briefing with Gemini
        const { briefing, extractedInfo } = await this.generateBriefing(
          personName,
          email,
          researchData
        );

        // Handle organization linking
        const orgResult = await this.handleOrganization(
          filePath,
          email,
          frontmatter,
          extractedInfo
        );

        // Merge extracted info
        const allInfo: ExtractedPersonInfo = {
          ...researchData.contactInfo,
          ...extractedInfo,
        };

        // Find phone number (integrated from find_phone_number.js)
        if (email && !allInfo.phone) {
          const phone = await this.googleServices.findPhoneNumber(
            email,
            personName,
            this.settings.models.phoneValidationModel
          );
          if (phone) {
            allInfo.phone = phone;
          }
        }

        // Update the note
        await this.updateNoteWithResearch(filePath, briefing, orgResult, email, allInfo);

        // Mark as researched
        await this.updateFrontmatterField(filePath, "researched", "true");

        new Notice(`Research complete for ${personName}`);

        return {
          success: true,
          personName,
          email,
          orgResult: orgResult || undefined,
          extractedInfo: allInfo,
        };
      } catch (error: unknown) {
        handleError("PersonResearch: Research failed", error, {
          showNotice: true,
          noticeMessage: `Research failed for ${personName}`,
          additionalContext: { personName, filePath },
        });
        await this.removeResearchingIndicator(filePath);
        return null;
      }
    } finally {
      this.inFlight.delete(filePath);
    }
  }

  private isRoomOrResourceEntity(name: string, email?: string): boolean {
    const n = (name || "").trim().toLowerCase();
    const e = (email || "").trim().toLowerCase();

    // Respect user configuration first
    if (
      this.settings.excludeNames.some((sub) => n.includes(sub.toLowerCase()))
    ) {
      return true;
    }
    if (
      this.settings.excludeEmails.some((sub) => {
        const s = sub.toLowerCase();
        return n.includes(s) || e.includes(s);
      })
    ) {
      return true;
    }

    // Google resource calendars (rooms/equipment)
    if (e.includes("resource.calendar.google.com")) return true;

    // Heuristic: office room name patterns like "P9-2-2.05"
    if (/^p\d+-\d+/.test(n)) return true;

    return false;
  }

  /**
   * Gather research data from all sources
   */
  private async gatherResearchData(
    name: string,
    email?: string
  ): Promise<{
    communicationHistory: GmailMessage[];
    vaultContext: string;
    contactInfo: ExtractedPersonInfo;
  }> {
    const data = {
      communicationHistory: [] as GmailMessage[],
      vaultContext: "",
      contactInfo: {} as ExtractedPersonInfo,
    };

    // Get communication history from Gmail
    if (email) {
      data.communicationHistory = await this.googleServices.getCommunicationHistory(email, 15);

      // Extract contact info from email signatures
      if (data.communicationHistory.length > 0) {
        const extracted = this.googleServices.extractContactInfoFromEmails(
          data.communicationHistory
        );
        data.contactInfo = {
          phone: extracted.phone || undefined,
          title: extracted.title || undefined,
        };
      }
    }

    // Search vault for existing context
    data.vaultContext = await this.vaultSearch.searchPersonContext(name);

    return data;
  }

  /**
   * Generate research briefing using Gemini
   */
  private async generateBriefing(
    name: string,
    email: string | undefined,
    researchData: {
      communicationHistory: GmailMessage[];
      vaultContext: string;
    }
  ): Promise<{ briefing: string; extractedInfo: ExtractedPersonInfo }> {
    // Build communication summary
    let commSummary = "";
    if (researchData.communicationHistory.length > 0) {
      commSummary = "Recent email subjects (for context only): ";
      const subjects = researchData.communicationHistory
        .slice(0, 3)
        .map((m) => m.subject)
        .join("; ");
      commSummary += subjects;
    }

    // Build vault hint
    let vaultHint = "";
    if (researchData.vaultContext) {
      const noteRefs = researchData.vaultContext.match(/\[\[[^\]]+\]\]/g) || [];
      if (noteRefs.length > 0) {
        vaultHint = `Related internal notes: ${noteRefs.slice(0, 3).join(", ")}`;
      }
    }

    // Get feedback context
    let feedbackContext = "";
    if (this.feedback) {
      feedbackContext = await this.feedback.getFeedbackSummary("person");
    }

    // Build prompt from settings template
    const prompt = this.settings.prompts.personResearch
      .replace("{name}", name)
      .replace("{emailDomain}", email ? `Email domain: ${email.split("@")[1] || ""}` : "")
      .replace("{vaultHint}", vaultHint)
      .replace("{commSummary}", commSummary) + feedbackContext;

    const cfg = this.settings.generationConfigs?.personResearch;
    const response = await this.aiService.callModel(
      "You are an elite executive research assistant. You dig deep to find specific facts about people - career moves, dates, achievements, numbers. You never pad with generic information.",
      prompt,
      this.settings.models.personResearchModel,
      {
        useSearch: true, // Enable Google Search
        temperature: cfg?.temperature,
        thinkingBudget: cfg?.thinkingBudget ?? undefined,
      }
    );

    if (!response) return { briefing: "", extractedInfo: {} };

    // Extract frontmatter info if present
    const extractedInfo: ExtractedPersonInfo = {};
    const lines = response.split("\n");
    const briefingLines: string[] = [];
    let inFrontmatter = false;

    for (const line of lines) {
      const trimmed = line.trim();
      
      // Skip section headers that the model might add despite instructions
      if (/^[\*\s]*(SECTION|EXTRACTED|INFO|RESEARCH SUMMARY)/i.test(trimmed)) {
        continue;
      }
      
      // Check for frontmatter fields - handle both clean and malformed formats
      // Clean: "Title: Partner" 
      // Malformed: "* *Title:** Partner" or "*Title:** Partner"
      const titleMatch = trimmed.match(/^[\*\s]*\*?Title\*?\*?:?\*?\*?\s*(.+)$/i);
      if (titleMatch) {
        const title = titleMatch[1].trim().replace(/^\*+|\*+$/g, '');
        if (title && !title.toLowerCase().includes("blank") && title.length > 0) {
          extractedInfo.title = this.cleanFrontmatterValue(title);
        }
        inFrontmatter = true;
        continue;
      }

      const orgMatch = trimmed.match(/^[\*\s]*\*?Organization\*?\*?:?\*?\*?\s*(.+)$/i);
      if (orgMatch) {
        const org = orgMatch[1].trim().replace(/^\*+|\*+$/g, '');
        if (org && !org.toLowerCase().includes("blank") && org.length > 0) {
          extractedInfo.organization = this.cleanFrontmatterValue(org);
        }
        inFrontmatter = true;
        continue;
      }

      const locationMatch = trimmed.match(/^[\*\s]*\*?Location\*?\*?:?\*?\*?\s*(.+)$/i);
      if (locationMatch) {
        const location = locationMatch[1].trim().replace(/^\*+|\*+$/g, '');
        if (location && !location.toLowerCase().includes("blank") && location.length > 0) {
          extractedInfo.location = this.cleanFrontmatterValue(location);
        }
        inFrontmatter = true;
        continue;
      }

      // If we hit an empty line after frontmatter, or a real bullet point (not a metadata line), we're done with frontmatter
      if (inFrontmatter && (trimmed === "" || (trimmed.startsWith("*") && !trimmed.match(/^[\*\s]*\*?(Title|Organization|Location)/i)))) {
        inFrontmatter = false;
      }

      // Add non-frontmatter lines to briefing (only real content bullets)
      if (!inFrontmatter && trimmed.length > 0 && !trimmed.match(/^[\*\s]*\*?(Title|Organization|Location)\*?\*?:/i)) {
        briefingLines.push(line);
      }
    }

    // Format briefing bullets consistently
    const formattedLines = briefingLines.map((line) => {
      const trimmed = line.trim();
      // Convert "- " bullets to "* " for consistency
      if (trimmed.startsWith("- ")) {
        return trimmed.replace(/^-\s+/, "* ");
      }
      // Ensure "* " format if it's a bullet
      if (trimmed.startsWith("*") && !trimmed.startsWith("* ")) {
        return trimmed.replace(/^\*/, "* ");
      }
      return line;
    });

    const briefing = formattedLines.join("\n").trim();

    return { briefing, extractedInfo };
  }

  /**
   * Handle organization linking and creation
   */
  private async handleOrganization(
    filePath: string,
    email: string | undefined,
    frontmatter: PersonFrontmatter,
    extractedInfo: ExtractedPersonInfo
  ): Promise<OrgLinkResult | null> {
    // Check if organization already set
    let orgName = frontmatter.Organization;
    if (orgName && orgName !== '""' && orgName !== '"[[]]"' && orgName !== "[[]]") {
      const match = orgName.match(/\[\[([^\]]+)\]\]/);
      if (match) {
        return { name: match[1], created: false };
      }
      return { name: orgName, created: false };
    }

    // Try to find org from email domain
    if (email) {
      const domain = this.googleServices.extractDomainFromEmail(email);

      if (domain) {
        // Search existing organizations by domain
        const existingOrg = await this.vaultSearch.findOrgByDomain(domain);

        if (existingOrg) {
          console.log(`[GSD] Found existing org "${existingOrg}" for domain ${domain}`);
          return { name: existingOrg, created: false, domain };
        }

        // Check if org note exists with capitalized domain name
        const { orgName: inferredOrg } = this.googleServices.extractOrgFromEmail(email);
        if (inferredOrg) {
          if (this.vaultSearch.orgNoteExists(inferredOrg)) {
            return { name: inferredOrg, created: false, domain };
          }

          // Create new org note
          await this.createOrgNote(inferredOrg, domain);
          return { name: inferredOrg, created: true, domain };
        }
      }
    }

    // Fall back to extracted organization name
    if (extractedInfo.organization) {
      const orgName = extractedInfo.organization;
      if (!this.vaultSearch.orgNoteExists(orgName)) {
        const domain = email ? this.googleServices.extractDomainFromEmail(email) : null;
        await this.createOrgNote(orgName, domain || undefined);
        return { name: orgName, created: true, domain: domain || undefined };
      }
      return { name: orgName, created: false };
    }

    return null;
  }

  /**
   * Create a new organization note
   */
  private async createOrgNote(orgName: string, domain?: string): Promise<void> {
    const orgPath = `${this.settings.organizationsFolder}/${orgName}.md`;

    const orgContent = `---
Domain: ${domain || ""}
tags:
  - company
researched: false
---

> [!info] ⏳ Researching organization...
`;

    await this.app.vault.create(orgPath, orgContent);
    console.log(`[GSD] Created org note: ${orgPath}`);
  }

  /**
   * Update the note with research results
   */
  private async updateNoteWithResearch(
    filePath: string,
    briefing: string,
    orgResult: OrgLinkResult | null,
    email: string | undefined,
    extractedInfo: ExtractedPersonInfo
  ): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!file || !(file instanceof TFile)) return;

    let content = await this.app.vault.read(file);

    // Remove researching indicator
    content = content.replace(/\n\n> \[!info\] ⏳ Researching\.\.\.\n/g, "");

    // Parse current frontmatter
    const currentFrontmatter = this.vaultSearch.parseFrontmatter<PersonFrontmatter>(content);

    // Update organization
    if (orgResult && orgResult.name) {
      content = this.vaultSearch.updateFrontmatterInContent(
        content,
        "Organization",
        `"[[${orgResult.name}]]"`
      );
    }

    // Helper to get first value from string or array, handling malformed YAML lists
    const getFirstValue = (val: unknown): string | undefined => {
      if (Array.isArray(val) && val.length > 0) return String(val[0]);
      if (typeof val === 'string' && val.trim() !== '') return val.trim();
      return undefined;
    };

    // Update email if not already set, or clean up if it's in malformed list format
    const fmEmail = currentFrontmatter.Email;
    const existingEmail = getFirstValue(fmEmail);
    
    if (email && !existingEmail) {
      // No email set, add it
      content = this.vaultSearch.updateFrontmatterInContent(content, "Email", email);
    } else if (Array.isArray(fmEmail) && existingEmail) {
      // Email is in malformed list format - normalize to simple string
      content = this.vaultSearch.updateFrontmatterInContent(content, "Email", existingEmail);
    }

    // Update Title if extracted and not set, or clean up if malformed
    const fmTitle = currentFrontmatter.Title;
    const existingTitle = getFirstValue(fmTitle);
    
    if (extractedInfo.title && !existingTitle) {
      content = this.vaultSearch.updateFrontmatterInContent(content, "Title", extractedInfo.title);
    } else if (Array.isArray(fmTitle) && existingTitle) {
      // Normalize array to simple string
      content = this.vaultSearch.updateFrontmatterInContent(content, "Title", existingTitle);
    }

    // Update Location if extracted and not set
    // Validate location is a real value (not empty, not just punctuation)
    const fmLocation = currentFrontmatter.Location;
    const existingLocation = getFirstValue(fmLocation);
    const validLocation = extractedInfo.location && 
      extractedInfo.location.trim().length > 1 && 
      !/^[:\s\-\.]+$/.test(extractedInfo.location.trim());
    
    if (validLocation && !existingLocation && extractedInfo.location) {
      const foundLocation = await this.vaultSearch.findExistingLocation(extractedInfo.location);
      if (foundLocation) {
        content = this.vaultSearch.updateFrontmatterInContent(
          content,
          "Location",
          `"[[${foundLocation}]]"`
        );
      } else {
        content = this.vaultSearch.updateFrontmatterInContent(
          content,
          "Location",
          `"[[Locations/${extractedInfo.location}]]"`
        );
      }
    } else if (Array.isArray(fmLocation) && existingLocation) {
      // Normalize array to simple string (keep the existing value)
      content = this.vaultSearch.updateFrontmatterInContent(content, "Location", existingLocation);
    }

    // Update Phone if extracted and not set, or clean up if malformed
    const fmPhone = currentFrontmatter.Phone;
    const existingPhone = getFirstValue(fmPhone);
    
    if (extractedInfo.phone && !existingPhone) {
      content = this.vaultSearch.updateFrontmatterInContent(content, "Phone", extractedInfo.phone);
    } else if (Array.isArray(fmPhone) && existingPhone) {
      // Normalize array to simple string
      content = this.vaultSearch.updateFrontmatterInContent(content, "Phone", existingPhone);
    }

    // Add research summary
    if (briefing) {
      const cleanBriefing = this.cleanBriefingText(briefing);
      content += `\n## Research Summary\n${cleanBriefing}\n`;

      if (orgResult && orgResult.created) {
        content += `\n*Organization [[${orgResult.name}]] was created and researched.*\n`;
      }
    }

    await this.app.vault.modify(file, content);
  }

  /**
   * Update a specific frontmatter field
   */
  private async updateFrontmatterField(
    filePath: string,
    key: string,
    value: string
  ): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!file || !(file instanceof TFile)) return;

    let content = await this.app.vault.read(file);
    content = this.vaultSearch.updateFrontmatterInContent(content, key, value);
    await this.app.vault.modify(file, content);
  }

  /**
   * Remove old research summary
   */
  private async removeOldResearch(filePath: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!file || !(file instanceof TFile)) return;

    let content = await this.app.vault.read(file);
    content = content.replace(/\n## Research Summary[\s\S]*$/, "");
    content = content.replace(/\n\n> \[!info\] ⏳ Researching\.\.\.\n/g, "");
    content = content.replace(/\n\*Organization \[\[[^\]]+\]\] was created and researched\.\*\n/g, "");
    await this.app.vault.modify(file, content);
  }

  /**
   * Remove researching indicator
   */
  private async removeResearchingIndicator(filePath: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!file || !(file instanceof TFile)) return;

    let content = await this.app.vault.read(file);
    content = content.replace(/\n\n> \[!info\] ⏳ Researching\.\.\.\n/g, "");
    await this.app.vault.modify(file, content);
  }

  /**
   * Clean briefing text formatting
   */
  private cleanBriefingText(text: string): string {
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        if (line.startsWith("*")) {
          return line.replace(/^\*\s+/, "* ");
        }
        if (/^\d+\./.test(line)) {
          return line.replace(/^(\d+\.)\s+/, "$1 ");
        }
        return line;
      })
      .join("\n");
  }

  /**
   * Clean a value for frontmatter
   */
  private cleanFrontmatterValue(value: string): string {
    if (!value) return value;
    return value
      .trim()
      .replace(/^[\*\-•]\s*/, "")
      .replace(/\*\*/g, "")
      .replace(/^\*|\*$/g, "")
      .replace(/^["']|["']$/g, "")
      .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, "$1")
      .trim();
  }
}

