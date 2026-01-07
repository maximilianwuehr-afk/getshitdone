// ============================================================================
// Organization Research Action - Auto-research orgs and update notes
// ============================================================================

import { App, TFile, Notice } from "obsidian";
import type { PluginSettings, OrgResearchResult, OrgFrontmatter } from "../types";
import { GoogleServices } from "../services/google-services";
import { AIService } from "../services/ai-service";
import { VaultSearchService } from "../services/vault-search";
import type { FeedbackAction } from "./feedback";
import { handleError } from "../utils/error-handler";

// ============================================================================
// OrgResearchAction Class
// ============================================================================

/**
 * Organization Research Action
 * Researches organizations and updates their notes with gathered information
 */
export class OrgResearchAction {
  private app: App;
  private settings: PluginSettings;
  private googleServices: GoogleServices;
  private aiService: AIService;
  private vaultSearch: VaultSearchService;
  private feedback: FeedbackAction | null = null;

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
   * Check if feedback dependency is wired
   */
  hasFeedback(): boolean {
    return this.feedback !== null;
  }

  /**
   * Research an organization note by file path
   */
  async researchOrg(
    filePath: string,
    options: { force?: boolean } = {}
  ): Promise<OrgResearchResult | null> {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!file || !(file instanceof TFile)) {
      console.error("[GSD] OrgResearch: Could not find file", filePath);
      return null;
    }

    const content = await this.app.vault.read(file);
    const frontmatter = this.vaultSearch.parseFrontmatter<OrgFrontmatter>(content);

    // Check if already researched
    if (!options.force && this.vaultSearch.isResearched(content)) {
      console.log("[GSD] OrgResearch: Already researched, skipping", filePath);
      return null;
    }

    // Check if research is already in progress
    if (this.vaultSearch.isResearchInProgress(content)) {
      console.log("[GSD] OrgResearch: Research already in progress, skipping", filePath);
      return null;
    }

    const orgName = file.basename;
    const domain = frontmatter.Domain || undefined;

    new Notice(`Researching ${orgName}...`);

    // Remove old research if re-researching
    if (options.force) {
      await this.removeOldResearch(filePath);
    }

    // Add researching indicator
    await this.vaultSearch.appendToNote(filePath, "\n\n> [!info] ⏳ Researching organization...\n");

    try {
      // Gather vault context
      const vaultContext = await this.vaultSearch.searchOrgContext(orgName);

      // Generate briefing
      const briefing = await this.generateBriefing(orgName, domain, vaultContext);

      // Update note with research
      await this.updateNoteWithResearch(filePath, briefing);

      // Mark as researched
      await this.updateFrontmatterField(filePath, "researched", "true");

      new Notice(`Research complete for ${orgName}`);

      return {
        success: true,
        orgName,
        domain,
      };
    } catch (error: unknown) {
      handleError("OrgResearch: Research failed", error, {
        showNotice: true,
        noticeMessage: `Research failed for ${orgName}`,
        additionalContext: { orgName, filePath },
      });
      await this.removeResearchingIndicator(filePath);
      return null;
    }
  }

  /**
   * Generate research briefing using Gemini
   */
  private async generateBriefing(
    orgName: string,
    domain: string | undefined,
    vaultContext: string
  ): Promise<string> {
    // Get feedback context
    let feedbackContext = "";
    if (this.feedback) {
      feedbackContext = await this.feedback.getFeedbackSummary("org");
    }

    // Build prompt from settings template
    const prompt = this.settings.prompts.orgResearch
      .replace("{orgName}", orgName)
      .replace("{domain}", domain ? `Website: ${domain}` : "")
      .replace(
        "{vaultContext}",
        vaultContext ? "**Vault Context:**\n" + vaultContext : ""
      ) + feedbackContext;

    const cfg = this.settings.generationConfigs?.orgResearch;
    const response = await this.aiService.callModel(
      "You are an elite business intelligence analyst. You find specific numbers, dates, and facts that others miss. Your briefings are dense with actionable intelligence - fund sizes, investment multiples, portfolio companies, key people. You never pad with generic descriptions.",
      prompt,
      this.settings.models.orgResearchModel,
      {
        useSearch: true, // Enable Google Search
        temperature: cfg?.temperature,
        thinkingBudget: cfg?.thinkingBudget ?? undefined,
      }
    );

    if (!response) return "";

    // Return markdown response directly
    // Ensure bullets use "- " format consistently
    const lines = response.split("\n");
    const formattedLines = lines.map((line) => {
      const trimmed = line.trim();
      // Convert "* " bullets to "- " for consistency
      if (trimmed.startsWith("* ")) {
        return trimmed.replace(/^\*\s+/, "- ");
      }
      // Ensure "- " format if it's a bullet
      if (trimmed.startsWith("-") && !trimmed.startsWith("- ")) {
        return trimmed.replace(/^-/, "- ");
      }
      return line;
    });

    return formattedLines.join("\n").trim();
  }

  /**
   * Update the note with research results
   */
  private async updateNoteWithResearch(filePath: string, briefing: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!file || !(file instanceof TFile)) return;

    let content = await this.app.vault.read(file);

    // Remove researching indicator
    content = content.replace(/\n\n> \[!info\] ⏳ Researching organization\.\.\.\n/g, "");
    content = content.replace(/> \[!info\] ⏳ Researching organization\.\.\.\n/g, "");

    // Add research summary
    // Note: briefing is already formatted as markdown bullets from generateBriefing
    if (briefing) {
      const cleanBriefing = briefing
        .split("\n")
        .map((line) => {
          line = line.replace(/^[\s\u00A0]+/, "");
          // Ensure consistent "- " prefix format
          if (!line.startsWith("-")) {
            line = line.replace(/^[•●○◦▪▸►*]\s*/, "- ");
          }
          return line;
        })
        .filter((line) => line.length > 0)
        .join("\n");

      content += `\n## About\n${cleanBriefing}\n`;
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
   * Remove old research
   */
  private async removeOldResearch(filePath: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!file || !(file instanceof TFile)) return;

    let content = await this.app.vault.read(file);
    content = content.replace(/\n## About[\s\S]*$/, "");
    content = content.replace(/\n\n> \[!info\] ⏳ Researching organization\.\.\.\n/g, "");
    content = content.replace(/> \[!info\] ⏳ Researching organization\.\.\.\n/g, "");
    await this.app.vault.modify(file, content);
  }

  /**
   * Remove researching indicator
   */
  private async removeResearchingIndicator(filePath: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!file || !(file instanceof TFile)) return;

    let content = await this.app.vault.read(file);
    content = content.replace(/\n\n> \[!info\] ⏳ Researching organization\.\.\.\n/g, "");
    content = content.replace(/> \[!info\] ⏳ Researching organization\.\.\.\n/g, "");
    await this.app.vault.modify(file, content);
  }
}

