import { App, Plugin, TFile, Notice } from "obsidian";
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

  // Webhook server (public for settings access)
  webhookServer!: WebhookServer;

  // Track files currently being researched to prevent duplicates
  private researchingFiles: Set<string> = new Set();

  // Registry of components that need settings updates
  private settingsSubscribers: SettingsAware[] = [];

  async onload() {
    console.log("[GSD] Loading GetShitDone plugin");

    // Load settings
    await this.loadSettings();

    // Initialize services
    this.aiService = new AIService(this.settings);
    this.googleServices = new GoogleServices(this.settings, this.aiService);
    this.googleServices.setAIService(this.aiService);
    this.calendarService = new CalendarService(this.app);
    this.indexService = new IndexService(this.app, this.settings);
    this.vaultSearch = new VaultSearchService(this.app, this.settings, this.indexService);

    // Initialize actions
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

    this.webhookServer = new WebhookServer(this.settings, this.amieTranscript);

    // Wire up circular dependency
    this.meetingBriefing.setPersonResearch(this.personResearch);

    // Wire feedback to research actions
    this.personResearch.setFeedback(this.feedback);
    this.orgResearch.setFeedback(this.feedback);
    this.meetingBriefing.setFeedback(this.feedback);

    // Register all settings-aware components
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
      this.webhookServer
    );

    // Register settings tab
    this.addSettingTab(new GetShitDoneSettingTab(this.app, this));

    // Register O3 dashboard view
    this.registerView(
      O3_DASHBOARD_VIEW,
      (leaf) => new O3DashboardView(leaf, this, this.o3Prep, this.o3Coach)
    );

    // Register commands
    this.registerCommands();

    // Register URI handler for inbox
    this.registerInboxURIHandler();

    // Register file-open handler for auto-research
    this.registerFileOpenHandler();

    // Register file change handler for index updates
    this.registerFileChangeHandler();

    // Expose API for Templater
    this.exposeTemplaterAPI();

    // Build indexes and start webhook server after layout is ready
    this.app.workspace.onLayoutReady(async () => {
      await this.indexService.buildIndexes();

      // Start webhook server if enabled
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

    // Stop webhook server
    if (this.webhookServer) {
      this.webhookServer.stop();
    }

    this.app.workspace.detachLeavesOfType(O3_DASHBOARD_VIEW);
  }

  async loadSettings() {
    const savedData = await this.loadData();
    this.settings = deepMerge(DEFAULT_SETTINGS, savedData);
  }

  async saveSettings() {
    await this.saveData(this.settings);

    // Notify all registered components of settings change
    for (const subscriber of this.settingsSubscribers) {
      subscriber.updateSettings(this.settings);
    }
  }

  getAIService(): AIService {
    return this.aiService;
  }

  /**
   * Register all commands
   */
  private registerCommands() {
    // Research Person command
    this.addCommand({
      id: "research-person",
      name: "Research Person",
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        if (file && file.path.startsWith(this.settings.peopleFolder + "/")) {
          if (!checking) {
            this.personResearch.researchPerson(file.path, { force: false });
          }
          return true;
        }
        return false;
      },
    });

    // Research Organization command
    this.addCommand({
      id: "research-org",
      name: "Research Organization",
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        if (file && file.path.startsWith(this.settings.organizationsFolder + "/")) {
          if (!checking) {
            this.orgResearch.researchOrg(file.path, { force: false });
          }
          return true;
        }
        return false;
      },
    });

    // Re-research (force) command
    this.addCommand({
      id: "rerun-research",
      name: "Re-research (Force)",
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return false;

        if (file.path.startsWith(this.settings.peopleFolder + "/")) {
          if (!checking) {
            this.personResearch.researchPerson(file.path, { force: true });
          }
          return true;
        }

        if (file.path.startsWith(this.settings.organizationsFolder + "/")) {
          if (!checking) {
            this.orgResearch.researchOrg(file.path, { force: true });
          }
          return true;
        }

        return false;
      },
    });

    // Generate Briefing for current line command
    this.addCommand({
      id: "trigger-briefing",
      name: "Generate Briefing for Current Line",
      callback: () => {
        this.meetingBriefing.triggerBriefingForCurrentLine();
      },
    });

    // Find Phone Number command
    this.addCommand({
      id: "find-phone",
      name: "Find Phone Number",
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        if (file && file.path.startsWith(this.settings.peopleFolder + "/")) {
          if (!checking) {
            this.findPhoneNumberForCurrentFile();
          }
          return true;
        }
        return false;
      },
    });

    // Report Feedback command
    this.addCommand({
      id: "report-feedback",
      name: "Report Research Issue",
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return false;

        // Allow feedback on People, Org, or Daily notes
        const isPeople = file.path.startsWith(this.settings.peopleFolder + "/");
        const isOrg = file.path.startsWith(this.settings.organizationsFolder + "/");
        const isDaily = file.path.startsWith("Daily notes/");

        if (isPeople || isOrg || isDaily) {
          if (!checking) {
            this.feedback.addFeedbackForCurrentNote();
          }
          return true;
        }
        return false;
      },
    });

    // Command: Show Index Stats
    this.addCommand({
      id: "show-index-stats",
      name: "Show Index Statistics",
      callback: () => this.showIndexStats(),
    });

    // Command: Rebuild Index
    this.addCommand({
      id: "rebuild-index",
      name: "Rebuild Search Index",
      callback: () => this.rebuildIndex(),
    });

    // Command: Capture from Clipboard (Inbox)
    this.addCommand({
      id: "inbox-capture-clipboard",
      name: "Inbox: Capture from Clipboard",
      callback: () => this.inbox.captureFromClipboard(),
    });

    // Command: Run LLM Council
    this.addCommand({
      id: "run-llm-council",
      name: "Run LLM Council",
      callback: () => this.llmCouncil.runCouncil(),
    });

    // Command: Open O3 Dashboard
    this.addCommand({
      id: "open-o3-dashboard",
      name: "Open O3 Dashboard",
      callback: () => this.activateO3Dashboard(),
    });
  }

  private async activateO3Dashboard(): Promise<void> {
    const leaf = this.app.workspace.getRightLeaf(false);
    await leaf?.setViewState({ type: O3_DASHBOARD_VIEW, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  /**
   * Show index statistics in a notice
   */
  private showIndexStats(): void {
    const stats = this.indexService.getStats();
    const message = `Index Stats:\n• People (email): ${stats.peopleByEmail}\n• People (name): ${stats.peopleByName}\n• O3 people: ${stats.o3People}\n• Orgs (domain): ${stats.orgsByDomain}\n• Orgs (name): ${stats.orgsByName}\n• Person-meeting links: ${stats.personMeetingMappings}`;
    new Notice(message, 8000);
    console.log("[GSD] " + message.replace(/\n/g, " | "));
  }

  /**
   * Rebuild the search index
   */
  private async rebuildIndex(): Promise<void> {
    new Notice("Rebuilding index...");
    await this.indexService.buildIndexes();
    const stats = this.indexService.getStats();
    new Notice(`Index rebuilt: ${stats.peopleByEmail} emails, ${stats.orgsByDomain} domains`);
  }

  /**
   * Register file change handler for index updates
   */
  private registerFileChangeHandler() {
    // Update index when files are modified
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile) {
          this.indexService.updateFileIndex(file);
        }
      })
    );

    // Update index when files are created
    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (file instanceof TFile) {
          // Delay slightly to let MetadataCache update
          setTimeout(() => this.indexService.updateFileIndex(file), 100);
        }
      })
    );

    // Rebuild relevant parts when files are deleted
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file instanceof TFile) {
          // Could implement removeFromIndex, but for now just log
          console.log(`[GSD] File deleted: ${file.path}`);
        }
      })
    );

    // Update index when files are renamed
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (file instanceof TFile) {
          setTimeout(() => this.indexService.updateFileIndex(file), 100);
        }
      })
    );
  }

  /**
   * Register file-open handler for auto-research
   */
  private registerFileOpenHandler() {
    this.registerEvent(
      this.app.workspace.on("file-open", async (file) => {
        if (!file) return;

        // People auto-research
        if (
          this.settings.autoResearchPeopleOnOpen &&
          file.path.startsWith(this.settings.peopleFolder + "/")
        ) {
          await this.handleAutoResearch(file, "person");
        }

        // Organization auto-research
        if (
          this.settings.autoResearchOrgsOnOpen &&
          file.path.startsWith(this.settings.organizationsFolder + "/")
        ) {
          await this.handleAutoResearch(file, "org");
        }
      })
    );
  }

  /**
   * Register URI handler for inbox captures
   * Handles: obsidian://gsd-inbox?content=...&type=...&source=...
   */
  private registerInboxURIHandler() {
    this.registerObsidianProtocolHandler("gsd-inbox", async (params) => {
      console.log("[GSD] Inbox URI handler triggered", params);
      await this.inbox.processInboxItem(params);
    });
  }

  /**
   * Handle auto-research with duplicate prevention
   */
  private async handleAutoResearch(file: TFile, type: "person" | "org"): Promise<void> {
    // Prevent duplicate research (in-memory check)
    if (this.researchingFiles.has(file.path)) {
      console.log(`[GSD] Already researching ${file.path}, skipping`);
      return;
    }

    // Check if already researched
    const content = await this.app.vault.read(file);
    if (this.vaultSearch.isResearched(content)) {
      return;
    }

    // Check if research is in progress (persistent check via note content)
    if (this.vaultSearch.isResearchInProgress(content)) {
      console.log(`[GSD] Research in progress for ${file.path}, skipping`);
      return;
    }

    // Mark as researching
    this.researchingFiles.add(file.path);

    try {
      if (type === "person") {
        await this.personResearch.researchPerson(file.path, { force: false });
      } else {
        await this.orgResearch.researchOrg(file.path, { force: false });
      }
    } finally {
      this.researchingFiles.delete(file.path);
    }
  }

  /**
   * Find phone number for the current People note
   */
  private async findPhoneNumberForCurrentFile(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice("No active file");
      return;
    }

    const content = await this.app.vault.read(file);
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) {
      new Notice("No frontmatter found");
      return;
    }

    // Check if phone already exists
    const existingPhone = fmMatch[1].match(/^Phone:\s*(.+)$/m);
    if (existingPhone && existingPhone[1].trim() && /[+\d]/.test(existingPhone[1])) {
      new Notice("Phone number already exists");
      return;
    }

    // Get email
    const emailMatch = fmMatch[1].match(/^Email:\s*(.+)$/m);
    const email = emailMatch ? emailMatch[1].trim() : null;

    if (!email) {
      new Notice("No email address found");
      return;
    }

    new Notice(`Searching for ${file.basename}'s phone number...`);

    const phone = await this.googleServices.findPhoneNumber(
      email,
      file.basename,
      this.settings.models.phoneValidationModel
    );

    if (phone) {
      // Update frontmatter
      let newContent = content;
      const fm = fmMatch[1];

      if (/^Phone:\s*$/m.test(fm) || /^Phone:\s*\n/m.test(fm)) {
        const newFm = fm.replace(/^Phone:\s*$/m, `Phone: ${phone}`);
        newContent = content.replace(/^---\n[\s\S]*?\n---/, `---\n${newFm}\n---`);
      } else if (!/^Phone:/m.test(fm)) {
        const newFm = fm + `\nPhone: ${phone}`;
        newContent = content.replace(/^---\n[\s\S]*?\n---/, `---\n${newFm}\n---`);
      }

      await this.app.vault.modify(file, newContent);
      new Notice(`Found phone: ${phone}`);
    } else {
      new Notice("Could not find phone number");
    }
  }

  /**
   * Expose API for Templater integration
   */
  private exposeTemplaterAPI() {
    // API object exposed to Templater
    (this as any).api = {
      /**
       * Generate daily note meeting list
       * Usage in Templater: <% await app.plugins.plugins["getshitdone"].api.generateDailyNote(tp) %>
       */
      generateDailyNote: async (tp: TemplaterObject): Promise<string> => {
        return this.dailyNote.generateDailyNote(tp);
      },

      /**
       * Research the current person note
       * Usage in Templater: <% await app.plugins.plugins["getshitdone"].api.researchPerson(tp) %>
       */
      researchPerson: async (tp: TemplaterObject): Promise<void> => {
        const filePath = tp.file.path(true);
        
        // Prevent duplicate research (same check as handleAutoResearch)
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
       * Usage in Templater: <% await app.plugins.plugins["getshitdone"].api.researchOrg(tp) %>
       */
      researchOrg: async (tp: TemplaterObject): Promise<void> => {
        const filePath = tp.file.path(true);
        
        // Prevent duplicate research (same check as handleAutoResearch)
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
       * Usage in Templater: <% await app.plugins.plugins["getshitdone"].api.captureToInbox(content, type) %>
       */
      captureToInbox: async (content: string, type?: string): Promise<void> => {
        await this.inbox.processInboxItem({ content, type, source: "manual" });
      },

      /**
       * Run LLM Council on the current note
       * Usage in Templater: <% await app.plugins.plugins["getshitdone"].api.runCouncil() %>
       */
      runCouncil: async (): Promise<void> => {
        await this.llmCouncil.runCouncil();
      },
    };
  }
}
