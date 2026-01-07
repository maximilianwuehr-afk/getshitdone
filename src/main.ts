// ============================================================================
// GetShitDone Plugin - Main entry point
// ============================================================================

import { Plugin, TFile, Notice } from "obsidian";
import { GetShitDoneSettingTab } from "./settings";
import { DEFAULT_SETTINGS, PluginSettings, SettingsAware, TemplaterObject } from "./types";
import { deepMerge } from "./utils/deep-merge";

// Services
import { GoogleServices } from "./services/google-services";
import { CalendarService } from "./services/calendar";
import { VaultSearchService } from "./services/vault-search";
import { IndexService } from "./services/index-service";
import { AIService } from "./services/ai-service";
import { WebhookServer } from "./services/webhook-server";

// Actions
import { PersonResearchAction } from "./actions/person-research";
import { OrgResearchAction } from "./actions/org-research";
import { DailyNoteAction } from "./actions/daily-note";
import { MeetingBriefingAction } from "./actions/meeting-briefing";
import { FeedbackAction } from "./actions/feedback";
import { InboxAction } from "./actions/inbox";
import { LlmCouncilAction } from "./actions/llm-council";
import { AmieTranscriptAction } from "./actions/amie-transcript";
import { O3PrepAction } from "./actions/o3-prep";
import { O3CoachAction } from "./actions/o3-coach";
import { O3DashboardView, O3_DASHBOARD_VIEW } from "./views/o3-dashboard";
import { ReferenceAction } from "./actions/reference";

// Commands and Event Handlers
import { registerCommands } from "./commands";
import { registerFileChangeHandler, registerFileOpenHandler, registerInboxURIHandler } from "./event-handlers";

// ============================================================================
// Plugin Class
// ============================================================================

export default class GetShitDonePlugin extends Plugin {
  settings: PluginSettings = DEFAULT_SETTINGS;

  // Services
  private googleServices!: GoogleServices;
  private aiService!: AIService;
  private calendarService!: CalendarService;
  private vaultSearch!: VaultSearchService;
  private indexService!: IndexService;

  // Actions
  private personResearch!: PersonResearchAction;
  private orgResearch!: OrgResearchAction;
  private dailyNote!: DailyNoteAction;
  private meetingBriefing!: MeetingBriefingAction;
  private feedback!: FeedbackAction;
  private inbox!: InboxAction;
  private llmCouncil!: LlmCouncilAction;
  private amieTranscript!: AmieTranscriptAction;
  private o3Prep!: O3PrepAction;
  private o3Coach!: O3CoachAction;
  private reference!: ReferenceAction;

  // Webhook server (public for settings access)
  webhookServer!: WebhookServer;

  // Track files currently being researched to prevent duplicates
  private researchingFiles: Set<string> = new Set();

  // Registry of components that need settings updates
  private settingsSubscribers: SettingsAware[] = [];

  // ============================================================================
  // Lifecycle
  // ============================================================================

  async onload() {
    console.log("[GSD] Loading GetShitDone plugin");

    await this.loadSettings();
    this.initializeServices();
    this.initializeActions();
    this.wireDependencies();
    this.registerSettingsSubscribers();

    // Register settings tab
    this.addSettingTab(new GetShitDoneSettingTab(this.app, this));

    // Register O3 dashboard view
    this.registerView(
      O3_DASHBOARD_VIEW,
      (leaf) => new O3DashboardView(leaf, this, this.o3Prep, this.o3Coach)
    );

    // Register commands and event handlers
    registerCommands(this);
    registerInboxURIHandler(this);
    registerFileOpenHandler(this);
    registerFileChangeHandler(this);

    // Expose API for Templater
    this.exposeTemplaterAPI();

    // Build indexes and start webhook server after layout is ready
    this.app.workspace.onLayoutReady(async () => {
      await this.indexService.buildIndexes();

      if (this.settings.webhook.enabled && this.settings.webhook.apiKey) {
        try {
          await this.webhookServer.start();
          console.log(`[GSD] Webhook server started on port ${this.settings.webhook.port}`);
        } catch (error) {
          console.error("[GSD] Failed to start webhook server:", error);
        }
      }
    });

    console.log("[GSD] GetShitDone plugin loaded");
  }

  onunload() {
    console.log("[GSD] Unloading GetShitDone plugin");

    if (this.webhookServer) {
      this.webhookServer.stop();
    }

    this.app.workspace.detachLeavesOfType(O3_DASHBOARD_VIEW);
  }

  // ============================================================================
  // Settings
  // ============================================================================

  async loadSettings() {
    const savedData = await this.loadData();
    this.settings = deepMerge(DEFAULT_SETTINGS, savedData);
  }

  async saveSettings() {
    await this.saveData(this.settings);

    // Notify all registered components of settings change with error recovery
    const errors: Array<{ component: string; error: unknown }> = [];
    for (const subscriber of this.settingsSubscribers) {
      try {
        subscriber.updateSettings(this.settings);
      } catch (error) {
        const componentName = subscriber.constructor?.name || "Unknown";
        errors.push({ component: componentName, error });
      }
    }

    if (errors.length > 0) {
      console.error("[GSD] Settings update errors:", errors);
      for (const { component, error } of errors) {
        console.error(`[GSD] ${component} failed:`, error);
      }
    }
  }

  // ============================================================================
  // Initialization
  // ============================================================================

  private initializeServices(): void {
    this.aiService = new AIService(this.settings);
    this.googleServices = new GoogleServices(this.settings, this.aiService);
    this.calendarService = new CalendarService(this.app);
    this.indexService = new IndexService(this.app, this.settings);
    this.vaultSearch = new VaultSearchService(this.app, this.settings, this.indexService);
  }

  private initializeActions(): void {
    this.meetingBriefing = new MeetingBriefingAction(
      this.app,
      this.settings,
      this.googleServices,
      this.aiService,
      this.vaultSearch
    );

    this.personResearch = new PersonResearchAction(
      this.app,
      this.settings,
      this.googleServices,
      this.aiService,
      this.vaultSearch
    );

    this.orgResearch = new OrgResearchAction(
      this.app,
      this.settings,
      this.googleServices,
      this.aiService,
      this.vaultSearch
    );

    this.dailyNote = new DailyNoteAction(
      this.app,
      this.settings,
      this.calendarService,
      this.vaultSearch,
      this.meetingBriefing
    );

    this.feedback = new FeedbackAction(this.app, this.settings);

    this.inbox = new InboxAction(
      this.app,
      this.settings,
      this.calendarService,
      this.googleServices,
      this.aiService,
      this.vaultSearch,
      this.indexService
    );

    this.llmCouncil = new LlmCouncilAction(
      this.app,
      this.settings,
      this.aiService
    );

    this.amieTranscript = new AmieTranscriptAction(
      this.app,
      this.settings,
      this.calendarService
    );

    this.o3Prep = new O3PrepAction(
      this.app,
      this.settings,
      this.calendarService,
      this.vaultSearch,
      this.indexService,
      this.googleServices,
      this.aiService
    );

    this.o3Coach = new O3CoachAction(
      this.app,
      this.settings,
      this.vaultSearch,
      this.indexService,
      this.googleServices,
      this.aiService
    );

    this.reference = new ReferenceAction(
      this.app,
      this.settings,
      this.indexService,
      this.aiService
    );

    this.webhookServer = new WebhookServer(this.settings, this.amieTranscript);
  }

  private wireDependencies(): void {
    // Wire up circular dependency
    this.meetingBriefing.setPersonResearch(this.personResearch);

    // Wire feedback to research actions
    this.personResearch.setFeedback(this.feedback);
    this.orgResearch.setFeedback(this.feedback);
    this.meetingBriefing.setFeedback(this.feedback);

    // Validate all dependencies are wired correctly
    this.validateDependencies();
  }

  private validateDependencies(): void {
    const errors: string[] = [];

    if (!this.meetingBriefing.hasPersonResearch()) {
      errors.push("MeetingBriefing.personResearch not wired");
    }
    if (!this.personResearch.hasFeedback()) {
      errors.push("PersonResearch.feedback not wired");
    }
    if (!this.orgResearch.hasFeedback()) {
      errors.push("OrgResearch.feedback not wired");
    }
    if (!this.meetingBriefing.hasFeedback()) {
      errors.push("MeetingBriefing.feedback not wired");
    }

    if (errors.length > 0) {
      const msg = `[GSD] Dependency validation failed:\n${errors.join("\n")}`;
      console.error(msg);
      throw new Error(msg);
    }

    console.log("[GSD] All dependencies validated successfully");
  }

  private registerSettingsSubscribers(): void {
    this.settingsSubscribers.push(
      this.aiService,
      this.googleServices,
      this.vaultSearch,
      this.indexService,
      this.personResearch,
      this.orgResearch,
      this.dailyNote,
      this.meetingBriefing,
      this.feedback,
      this.inbox,
      this.llmCouncil,
      this.amieTranscript,
      this.o3Prep,
      this.o3Coach,
      this.reference,
      this.webhookServer
    );
  }

  // ============================================================================
  // Service/Action Getters (for commands and event handlers)
  // ============================================================================

  getAIService(): AIService {
    return this.aiService;
  }

  getGoogleServices(): GoogleServices {
    return this.googleServices;
  }

  getVaultSearch(): VaultSearchService {
    return this.vaultSearch;
  }

  getIndexService(): IndexService {
    return this.indexService;
  }

  getPersonResearch(): PersonResearchAction {
    return this.personResearch;
  }

  getOrgResearch(): OrgResearchAction {
    return this.orgResearch;
  }

  getMeetingBriefing(): MeetingBriefingAction {
    return this.meetingBriefing;
  }

  getFeedback(): FeedbackAction {
    return this.feedback;
  }

  getInbox(): InboxAction {
    return this.inbox;
  }

  getLlmCouncil(): LlmCouncilAction {
    return this.llmCouncil;
  }

  getReference(): ReferenceAction {
    return this.reference;
  }

  // ============================================================================
  // Research Tracking (for event handlers)
  // ============================================================================

  isResearchingFile(path: string): boolean {
    return this.researchingFiles.has(path);
  }

  markFileResearching(path: string): void {
    this.researchingFiles.add(path);
  }

  unmarkFileResearching(path: string): void {
    this.researchingFiles.delete(path);
  }

  // ============================================================================
  // Templater API
  // ============================================================================

  private exposeTemplaterAPI() {
    (this as any).api = {
      /**
       * Generate daily note meeting list
       * Usage: <% await app.plugins.plugins["getshitdone"].api.generateDailyNote(tp) %>
       */
      generateDailyNote: async (tp: TemplaterObject): Promise<string> => {
        return this.dailyNote.generateDailyNote(tp);
      },

      /**
       * Research the current person note
       * Usage: <% await app.plugins.plugins["getshitdone"].api.researchPerson(tp) %>
       */
      researchPerson: async (tp: TemplaterObject): Promise<void> => {
        const filePath = tp.file.path(true);

        if (this.researchingFiles.has(filePath)) {
          console.log(`[GSD] Templater: Already researching ${filePath}, skipping`);
          return;
        }

        this.researchingFiles.add(filePath);
        try {
          await this.personResearch.researchPerson(filePath, { force: false });
        } finally {
          this.researchingFiles.delete(filePath);
        }
      },

      /**
       * Research the current organization note
       * Usage: <% await app.plugins.plugins["getshitdone"].api.researchOrg(tp) %>
       */
      researchOrg: async (tp: TemplaterObject): Promise<void> => {
        const filePath = tp.file.path(true);

        if (this.researchingFiles.has(filePath)) {
          console.log(`[GSD] Templater: Already researching ${filePath}, skipping`);
          return;
        }

        this.researchingFiles.add(filePath);
        try {
          await this.orgResearch.researchOrg(filePath, { force: false });
        } finally {
          this.researchingFiles.delete(filePath);
        }
      },

      /**
       * Capture content to inbox
       * Usage: <% await app.plugins.plugins["getshitdone"].api.captureToInbox(content, type) %>
       */
      captureToInbox: async (content: string, type?: string): Promise<void> => {
        await this.inbox.processInboxItem({ content, type, source: "manual" });
      },

      /**
       * Run LLM Council on the current note
       * Usage: <% await app.plugins.plugins["getshitdone"].api.runCouncil() %>
       */
      runCouncil: async (): Promise<void> => {
        await this.llmCouncil.runCouncil();
      },

      /**
       * Save a URL as a reference note
       * Usage: <% await app.plugins.plugins["getshitdone"].api.saveReference(url) %>
       */
      saveReference: async (url: string): Promise<string | null> => {
        return this.reference.processUrl(url);
      },
    };
  }
}
