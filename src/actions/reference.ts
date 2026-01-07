// ============================================================================
// Reference Action - URL processing into structured reference notes
// ============================================================================

import { App, TFile, Notice, parseYaml } from "obsidian";
import type {
  PluginSettings,
  TopicHierarchy,
  TopicNode,
  ReferenceSourceType,
} from "../types";
import { IndexService } from "../services/index-service";
import { AIService } from "../services/ai-service";
import { handleError } from "../utils/error-handler";

const moment = (window as any).moment;

// ============================================================================
// Types
// ============================================================================

type SummarizeAPI = {
  summarizeUrl: (
    url: string,
    options?: {
      length?: string;
      language?: string;
      model?: string;
      onStream?: (chunk: string) => void;
    }
  ) => Promise<string>;
  isConfigured: () => boolean;
};

interface ReferenceData {
  url: string;
  title: string;
  summary: string;
  sourceType: ReferenceSourceType;
  tags: string[];
  entities: Array<{ type: "person" | "org"; name: string; path: string }>;
  created: string;
}

// ============================================================================
// ReferenceAction Class
// ============================================================================

/**
 * Reference Action
 * Processes URLs into structured reference notes with automatic categorization
 */
export class ReferenceAction {
  private app: App;
  private settings: PluginSettings;
  private indexService: IndexService;
  private aiService: AIService;
  private topicHierarchy: TopicHierarchy | null = null;
  private topicsFileContent: string | null = null;

  constructor(
    app: App,
    settings: PluginSettings,
    indexService: IndexService,
    aiService: AIService
  ) {
    this.app = app;
    this.settings = settings;
    this.indexService = indexService;
    this.aiService = aiService;
  }

  /**
   * Update settings reference
   */
  updateSettings(settings: PluginSettings): void {
    this.settings = settings;
    this.topicHierarchy = null; // Force reload on next use
    this.topicsFileContent = null;
  }

  /**
   * Public method to match topics for external use (e.g., inbox link summarization)
   * Returns array of matched topic paths using AI
   */
  async matchTopicsForContent(title: string, summary: string): Promise<string[]> {
    const topics = await this.loadTopicHierarchy();
    return this.matchTopics(summary, title, topics);
  }

  /**
   * Infer title from URL (public for external use)
   */
  inferTitle(url: string): string {
    return this.inferTitleFromUrl(url);
  }

  /**
   * Get topics file content (public for external use in prompts)
   */
  async getTopicsFileContent(): Promise<string | null> {
    return this.loadTopicsFileContent();
  }

  // ============================================================================
  // Main Entry Point
  // ============================================================================

  /**
   * Process a URL and create a reference note
   * Returns the path to the created reference note
   */
  async processUrl(url: string): Promise<string | null> {
    if (!this.settings.reference.enabled) {
      new Notice("Reference system is disabled");
      return null;
    }

    console.log(`[GSD Reference] Processing URL: ${url}`);

    try {
      // Step 1: Get summary from summarize plugin
      new Notice("Summarizing...");
      const summary = await this.getSummary(url);
      if (!summary) {
        new Notice("Failed to get summary");
        return null;
      }

      // Step 2: Infer title from URL
      const title = this.inferTitleFromUrl(url);

      // Step 3: Detect source type from URL
      const sourceType = this.detectSourceType(url);

      // Step 4: Load topic hierarchy and match
      const topics = await this.loadTopicHierarchy();
      const tags = await this.matchTopics(summary, title, topics);

      // Step 5: Detect entity mentions
      const combinedText = `${title} ${summary}`;
      const entities = this.indexService.findEntitiesInContent(combinedText);

      // Step 6: Build reference data
      const referenceData: ReferenceData = {
        url,
        title,
        summary,
        sourceType,
        tags,
        entities,
        created: moment().format("YYYY-MM-DD"),
      };

      // Step 7: Create reference note
      const notePath = await this.createReferenceNote(referenceData);

      new Notice(`Reference saved: ${title}`);
      console.log(`[GSD Reference] Created: ${notePath}`);

      return notePath;
    } catch (error: unknown) {
      handleError("Reference: Failed to process URL", error, {
        showNotice: true,
        noticeMessage: "Failed to save reference",
      });
      return null;
    }
  }

  // ============================================================================
  // Summarization
  // ============================================================================

  /**
   * Get summary from summarize plugin
   */
  private async getSummary(url: string): Promise<string | null> {
    const api = this.getSummarizeApi();
    if (!api) {
      new Notice("Summarize plugin not available");
      return null;
    }

    if (!api.isConfigured()) {
      new Notice("Summarize plugin not configured");
      return null;
    }

    try {
      return await api.summarizeUrl(url, {
        length: "short",
        prompt: this.buildReferenceSummaryPrompt(),
      });
    } catch (error: unknown) {
      console.error("[GSD Reference] Summarization failed:", error);
      return null;
    }
  }

  private buildReferenceSummaryPrompt(): string {
    return `Summarize the following content in approximately {{wordCount}} words. {{language}}

Requirements:
- If the content includes an author/byline, mention the author in the first sentence (e.g., "By NAME — ...").
- If the content includes a concrete idea or suggestion to implement, call it out explicitly.
- Do not invent an author; omit if unknown.
- Avoid meta-commentary; start directly with the summary.

Content to summarize:
{{content}}`;
  }

  /**
   * Get the summarize plugin API
   */
  private getSummarizeApi(): SummarizeAPI | null {
    const plugins = (this.app as any).plugins;
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

  // ============================================================================
  // Title & Source Detection
  // ============================================================================

  /**
   * Infer title from URL (best effort)
   */
  private inferTitleFromUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;

      // Try to extract meaningful title from path
      // e.g., /posts/2025/shipping-at-inference-speed -> Shipping at Inference Speed
      const segments = pathname.split("/").filter(Boolean);
      const lastSegment = segments[segments.length - 1] || "";

      // Remove file extension
      const withoutExt = lastSegment.replace(/\.[^.]+$/, "");

      // Convert slug to title case
      if (withoutExt && withoutExt !== "index") {
        const title = withoutExt
          .replace(/[-_]/g, " ")
          .replace(/\b\w/g, (c) => c.toUpperCase());
        return title;
      }

      // Fallback to domain
      return urlObj.hostname.replace(/^www\./, "");
    } catch {
      return "Untitled Reference";
    }
  }

  /**
   * Detect source type from URL patterns
   */
  private detectSourceType(url: string): ReferenceSourceType {
    const lower = url.toLowerCase();

    // Twitter/X
    if (lower.includes("twitter.com") || lower.includes("x.com")) {
      return "tweet";
    }

    // YouTube
    if (lower.includes("youtube.com") || lower.includes("youtu.be")) {
      return "video";
    }

    // GitHub
    if (lower.includes("github.com")) {
      return "repo";
    }

    // Podcasts
    if (
      lower.includes("podcasts.apple.com") ||
      lower.includes("spotify.com/episode") ||
      lower.includes("overcast.fm")
    ) {
      return "podcast";
    }

    // Academic papers
    if (
      lower.includes("arxiv.org") ||
      lower.includes("papers.ssrn") ||
      lower.includes("doi.org")
    ) {
      return "paper";
    }

    // Default to article
    return "article";
  }

  // ============================================================================
  // Topic Matching
  // ============================================================================

  /**
   * Load topic hierarchy from Topics.md file
   */
  private async loadTopicHierarchy(): Promise<TopicHierarchy> {
    if (this.topicHierarchy) {
      return this.topicHierarchy;
    }

    const filePath = this.settings.reference.topicsFilePath;
    const file = this.app.vault.getAbstractFileByPath(filePath);

    if (!file || !(file instanceof TFile)) {
      console.log(`[GSD Reference] Topics file not found: ${filePath}`);
      return {};
    }

    try {
      const content = await this.app.vault.read(file);

      // Extract YAML frontmatter
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (!frontmatterMatch) {
        console.log("[GSD Reference] No frontmatter in Topics.md");
        return {};
      }

      const yaml = parseYaml(frontmatterMatch[1]);
      this.topicHierarchy = yaml.topics || {};
      return this.topicHierarchy;
    } catch (error: unknown) {
      console.error("[GSD Reference] Failed to parse Topics.md:", error);
      return {};
    }
  }

  /**
   * Match content against topic hierarchy using AI + evidence filter
   */
  private async matchTopics(
    summary: string,
    title: string,
    topics: TopicHierarchy
  ): Promise<string[]> {
    const tags = await this.matchTopicsWithAI(title, summary);
    if (!topics || Object.keys(topics).length === 0) {
      return tags;
    }

    return this.filterTagsByEvidence(tags, title, summary, topics);
  }

  /**
   * Match content against topic hierarchy using AI
   * Returns array of tag paths (e.g., ["ai/agents", "leadership/urgency"])
   */
  private async matchTopicsWithAI(title: string, summary: string): Promise<string[]> {
    // Load topics file content
    const topicsContent = await this.loadTopicsFileContent();
    if (!topicsContent) {
      console.log("[GSD Reference] No topics file found, using uncategorized");
      return ["uncategorized"];
    }

    // Build prompt
    const prompt = `You are a content categorization assistant. Given a title, summary, and a topic hierarchy, return the most relevant topic tags.

## Topic Hierarchy (from Topics.md)
${topicsContent}

## Content to Categorize
Title: ${title}
Summary: ${summary}

## Instructions
- Return ONLY the relevant topic paths as a comma-separated list
- Use the exact paths from the hierarchy (e.g., "ai/agents", "leadership/urgency")
- Only return topics that are clearly relevant to the content
- Be conservative - only tag if the topic is explicitly central to the title/summary
- Do NOT infer from weak associations, author/company names, or generic overlap
- If you cannot point to a concrete phrase in the title/summary that supports a tag, do not include it
- If nothing matches well, return "uncategorized"
- Prefer fewer tags (0-2 is normal). Only return 3 if unmistakably central
- Do NOT include the # symbol

## Response Format
Return only the comma-separated tags, nothing else. Example: ai/agents, leadership/shipping`;

    try {
      const model = this.settings.models.inboxRoutingModel || this.settings.models.briefingModel;
      const result = await this.aiService.callModel(
        "You are a precise content categorizer. Return only comma-separated topic paths.",
        prompt,
        model,
        {
          useSearch: false,
          temperature: 0.1,
        }
      );

      if (!result) {
        console.log("[GSD Reference] AI returned no result, using uncategorized");
        return ["uncategorized"];
      }

      // Parse the response - expect comma-separated tags
      const tags = result
        .split(",")
        .map(t => t.trim().toLowerCase().replace(/^#/, ""))
        .filter(t => t.length > 0 && t !== "uncategorized");

      if (tags.length === 0) {
        return ["uncategorized"];
      }

      console.log(`[GSD Reference] AI matched tags: ${tags.join(", ")}`);
      return tags;
    } catch (error: unknown) {
      console.error("[GSD Reference] AI tagging failed:", error);
      return ["uncategorized"];
    }
  }

  private filterTagsByEvidence(
    tags: string[],
    title: string,
    summary: string,
    topics: TopicHierarchy
  ): string[] {
    const cleaned = tags.filter(tag => tag && tag !== "uncategorized");
    if (cleaned.length === 0) {
      return ["uncategorized"];
    }

    const aliasMap = this.buildTagAliasMap(topics);
    const normalizedContent = this.normalizeForTagMatch(`${title} ${summary}`);

    const kept = cleaned.filter(tag => {
      const aliases = aliasMap.get(tag);
      if (!aliases || aliases.length === 0) return false;
      return aliases.some(alias => this.contentHasAlias(normalizedContent, alias));
    });

    if (kept.length === 0) {
      return ["uncategorized"];
    }

    if (kept.length !== cleaned.length) {
      console.log(
        `[GSD Reference] Filtered tags by evidence. Before: ${cleaned.join(", ")} After: ${kept.join(", ")}`
      );
    }

    return kept;
  }

  private buildTagAliasMap(topics: TopicHierarchy): Map<string, string[]> {
    const map = new Map<string, string[]>();

    const visitNode = (
      node: TopicNode | string[] | undefined,
      path: string,
      inheritedAliases: string[]
    ): void => {
      if (!path) return;

      if (!node) {
        map.set(path, this.dedupeAliases([...inheritedAliases, ...this.getPathAliases(path)]));
        return;
      }

      if (Array.isArray(node)) {
        map.set(
          path,
          this.dedupeAliases([...inheritedAliases, ...this.getPathAliases(path), ...node])
        );
        return;
      }

      const nodeAliases = Array.isArray(node._aliases) ? node._aliases : [];
      const combinedAliases = [...inheritedAliases, ...nodeAliases, ...this.getPathAliases(path)];
      map.set(path, this.dedupeAliases(combinedAliases));

      for (const [key, value] of Object.entries(node)) {
        if (key === "_aliases") continue;
        const childPath = `${path}/${key}`;
        const childInherited = [...inheritedAliases, ...nodeAliases, key];
        visitNode(value as TopicNode | string[] | undefined, childPath, childInherited);
      }
    };

    for (const [key, value] of Object.entries(topics)) {
      visitNode(value as TopicNode | string[] | undefined, key, [key]);
    }

    return map;
  }

  private getPathAliases(path: string): string[] {
    const parts = path.split("/").filter(Boolean);
    if (parts.length === 0) return [];
    const aliases = [...parts];
    if (parts.length > 1) {
      aliases.push(parts.join(" "));
    }
    return aliases;
  }

  private normalizeForTagMatch(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  private contentHasAlias(normalizedContent: string, alias: string): boolean {
    const normalizedAlias = this.normalizeForTagMatch(alias);
    if (!normalizedAlias) return false;
    return ` ${normalizedContent} `.includes(` ${normalizedAlias} `);
  }

  private dedupeAliases(aliases: string[]): string[] {
    const seen = new Set<string>();
    const cleaned: string[] = [];

    for (const alias of aliases) {
      const trimmed = alias.trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      cleaned.push(trimmed);
    }

    return cleaned;
  }

  /**
   * Load the raw content of the Topics.md file for use in prompts
   */
  private async loadTopicsFileContent(): Promise<string | null> {
    if (this.topicsFileContent) {
      return this.topicsFileContent;
    }

    const filePath = this.settings.reference.topicsFilePath;
    const file = this.app.vault.getAbstractFileByPath(filePath);

    if (!file || !(file instanceof TFile)) {
      console.log(`[GSD Reference] Topics file not found: ${filePath}`);
      return null;
    }

    try {
      const content = await this.app.vault.read(file);
      // Extract just the YAML frontmatter for the prompt
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (frontmatterMatch) {
        this.topicsFileContent = frontmatterMatch[1];
      } else {
        this.topicsFileContent = content;
      }
      return this.topicsFileContent;
    } catch (error: unknown) {
      console.error("[GSD Reference] Failed to read Topics.md:", error);
      return null;
    }
  }

  // ============================================================================
  // Note Creation
  // ============================================================================

  /**
   * Create the reference note file
   */
  private async createReferenceNote(data: ReferenceData): Promise<string> {
    const { url, title, summary, sourceType, tags, entities, created } = data;

    // Generate file path: References/YYYY/MM/slug.md
    const year = moment(created).format("YYYY");
    const month = moment(created).format("MM");
    const slug = this.generateSlug(title);
    const folderPath = `${this.settings.reference.referencesFolder}/${year}/${month}`;
    const filePath = `${folderPath}/${slug}.md`;

    // Ensure folder exists
    await this.ensureFolderExists(folderPath);

    // Build frontmatter
    const frontmatter = [
      "---",
      `url: ${url}`,
      `title: "${title.replace(/"/g, '\\"')}"`,
      `source: ${sourceType}`,
      `tags:`,
      ...tags.map((t) => `  - ${t}`),
      `created: ${created}`,
      "---",
    ].join("\n");

    // Build body
    const entityLinks = entities
      .map((e) => `[[${e.path.replace(".md", "")}|${e.name}]]`)
      .join(", ");

    const body = [
      "",
      `# ${title}`,
      "",
      summary,
      "",
      entityLinks ? `Related: ${entityLinks}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const content = frontmatter + body;

    // Create or overwrite file
    const existingFile = this.app.vault.getAbstractFileByPath(filePath);
    if (existingFile && existingFile instanceof TFile) {
      await this.app.vault.modify(existingFile, content);
    } else {
      await this.app.vault.create(filePath, content);
    }

    return filePath;
  }

  /**
   * Generate URL-safe slug from title
   */
  private generateSlug(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 50);
  }

  /**
   * Ensure folder path exists, creating if necessary
   */
  private async ensureFolderExists(folderPath: string): Promise<void> {
    const parts = folderPath.split("/");
    let currentPath = "";

    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const folder = this.app.vault.getAbstractFileByPath(currentPath);
      if (!folder) {
        await this.app.vault.createFolder(currentPath);
      }
    }
  }

  // ============================================================================
  // Daily Note Integration
  // ============================================================================

  /**
   * Update daily note: replace raw URL with wikilink to reference
   * Returns true if daily note was updated
   */
  async updateDailyNoteWithReference(
    originalLine: string,
    referenceNotePath: string,
    referenceTitle: string,
    primaryTag: string
  ): Promise<boolean> {
    if (!this.settings.reference.dailyNoteLink) {
      return false;
    }

    const dailyNotePath = await this.getDailyNotePath();
    if (!dailyNotePath) {
      return false;
    }

    const file = this.app.vault.getAbstractFileByPath(dailyNotePath);
    if (!file || !(file instanceof TFile)) {
      return false;
    }

    try {
      const content = await this.app.vault.read(file);

      // Build replacement: [[Reference|Title]] #tag
      const wikilink = `[[${referenceNotePath.replace(".md", "")}|${referenceTitle}]]`;
      const replacement = `${wikilink} #${primaryTag}`;

      // Replace the original line
      if (content.includes(originalLine)) {
        const newContent = content.replace(originalLine, replacement);
        await this.app.vault.modify(file, newContent);
        return true;
      }
    } catch (error: unknown) {
      console.error("[GSD Reference] Failed to update daily note:", error);
    }

    return false;
  }

  /**
   * Get today's daily note path
   */
  private async getDailyNotePath(): Promise<string | null> {
    const today = moment().format("YYYY-MM-DD");
    const possiblePaths = [
      `Daily notes/${today}.md`,
      `daily notes/${today}.md`,
      `Daily Notes/${today}.md`,
      `${today}.md`,
    ];

    for (const path of possiblePaths) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) {
        return path;
      }
    }

    return null;
  }

  // ============================================================================
  // Trigger Detection
  // ============================================================================

  /**
   * Check if content starts with a reference trigger phrase
   * Returns the extracted URL if triggered, null otherwise
   */
  detectReferenceTrigger(content: string): string | null {
    const triggers = this.settings.reference.urlTriggers;
    const lower = content.toLowerCase().trim();

    for (const trigger of triggers) {
      const triggerLower = trigger.toLowerCase();
      if (lower.startsWith(triggerLower)) {
        // Extract URL after trigger
        const afterTrigger = content.slice(trigger.length).trim();
        const urlMatch = afterTrigger.match(/^(https?:\/\/[^\s]+)/);
        if (urlMatch) {
          return urlMatch[1];
        }
      }
    }

    return null;
  }
}
