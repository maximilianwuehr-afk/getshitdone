import { App, PluginSettingTab, Setting, Notice, Modal, TextAreaComponent, requestUrl, RequestUrlResponse } from "obsidian";
import type GetShitDonePlugin from "./main";
import {
  DEFAULT_SETTINGS,
  PluginSettings,
  InboxContentType,
  InboxRoutingRule,
  InboxRouteDestination,
  InboxFormatStyle,
  OpenRouterModel,
} from "./types";
import { GoogleServices } from "./services/google-services";
import type { AIService } from "./services/ai-service";

type SettingsTabId = "general" | "daily" | "api" | "inbox" | "ai" | "council" | "openrouter";
type OpenRouterSortKey = "name" | "provider" | "context" | "cost" | "arena" | "openllm" | "value";

type SettingsHelperOptions = {
  title: string;
  context: string;
  currentValue: string;
  defaultQuestion?: string;
  model: string;
  aiService: AIService;
  onReplace?: (value: string) => Promise<void>;
  onAppend?: (value: string) => Promise<void>;
};

export class GetShitDoneSettingTab extends PluginSettingTab {
  plugin: GetShitDonePlugin;
  private activeTab: SettingsTabId = "general";
  private openRouterSearch = "";
  private openRouterProviderFilter = "all";
  private openRouterFreeOnly = false;
  private openRouterSelectedOnly = false;
  private openRouterSort: OpenRouterSortKey = "name";
  private openRouterSortDirection: "asc" | "desc" = "asc";
  private openLlmOrgIndex = new Map<string, Map<string, string>>();
  private openRouterSearchFocus: { start: number; end: number } | null = null;
  private openLlmLastRequestAt = 0;
  private openLlmBackoffUntil = 0;

  constructor(app: App, plugin: GetShitDonePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    this.ensureStyles();
    this.renderTabs(containerEl);

    const contentEl = containerEl.createDiv({ cls: "gsd-settings-tab-content" });

    switch (this.activeTab) {
      case "general":
        this.renderGeneralTab(contentEl);
        break;
      case "daily":
        this.renderDailyNotesTab(contentEl);
        break;
      case "api":
        this.renderApiTab(contentEl);
        break;
      case "openrouter":
        this.renderOpenRouterTab(contentEl);
        break;
      case "inbox":
        this.renderInboxTab(contentEl);
        break;
      case "ai":
        this.renderAiTab(contentEl);
        break;
      case "council":
        this.renderCouncilTab(contentEl);
        break;
    }
  }

  private ensureStyles(): void {
    const styleId = "gsd-settings-tabs-style";
    if (document.getElementById(styleId)) return;

    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      .gsd-settings-tabs {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        margin-bottom: 16px;
      }
      .gsd-settings-tab {
        border: 1px solid var(--background-modifier-border);
        background: var(--background-secondary);
        color: var(--text-normal);
        padding: 6px 10px;
        border-radius: 8px;
        cursor: pointer;
        font-size: 13px;
      }
      .gsd-settings-tab.is-active {
        background: var(--interactive-accent);
        color: var(--text-on-accent);
        border-color: var(--interactive-accent);
      }
      .gsd-settings-details {
        margin-top: 12px;
        border: 1px solid var(--background-modifier-border);
        border-radius: 8px;
        padding: 8px 12px;
        background: var(--background-secondary);
      }
      .gsd-settings-details > summary {
        cursor: pointer;
        font-weight: 600;
      }
      .gsd-settings-details-body {
        margin-top: 8px;
      }
      .gsd-openrouter-toolbar {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin: 12px 0;
        align-items: center;
      }
      .gsd-openrouter-toolbar input[type="text"] {
        min-width: 220px;
      }
      .gsd-openrouter-meta {
        font-size: 12px;
        color: var(--text-muted);
      }
      .gsd-openrouter-table-wrap {
        border: 1px solid var(--background-modifier-border);
        border-radius: 10px;
        background: var(--background-secondary);
        overflow-x: auto;
        margin-top: 12px;
      }
      .gsd-openrouter-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 12px;
      }
      .gsd-openrouter-table th,
      .gsd-openrouter-table td {
        padding: 8px 10px;
        border-bottom: 1px solid var(--background-modifier-border);
        vertical-align: top;
      }
      .gsd-openrouter-table thead th {
        text-align: left;
        color: var(--text-muted);
        font-weight: 600;
        background: var(--background-secondary);
        position: sticky;
        top: 0;
        z-index: 1;
      }
      .gsd-openrouter-table tbody tr.is-selected {
        background: var(--background-modifier-hover);
      }
      .gsd-openrouter-row-title {
        font-weight: 600;
        font-size: 13px;
      }
      .gsd-openrouter-row-id {
        font-family: var(--font-monospace);
        font-size: 12px;
        color: var(--text-muted);
      }
      .gsd-openrouter-table-actions {
        display: flex;
        gap: 8px;
        align-items: center;
      }
      .gsd-openrouter-table-meta {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .gsd-openrouter-rank-list {
        display: grid;
        gap: 8px;
        margin-top: 8px;
      }
      .gsd-openrouter-rank-item {
        border: 1px solid var(--background-modifier-border);
        border-radius: 8px;
        padding: 8px 10px;
        background: var(--background-secondary);
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: center;
      }
      .gsd-openrouter-rank-item.is-dragging {
        opacity: 0.6;
      }
      .gsd-openrouter-rank-item.is-drop-target {
        border-color: var(--interactive-accent);
      }
      .gsd-openrouter-rank-handle {
        font-size: 14px;
        color: var(--text-muted);
        cursor: grab;
        margin-right: 6px;
      }
    `;
    document.head.appendChild(style);
  }

  private renderTabs(containerEl: HTMLElement): void {
    const tabs: { id: SettingsTabId; label: string }[] = [
      { id: "general", label: "General" },
      { id: "daily", label: "Daily notes" },
      { id: "api", label: "API & Integration" },
      { id: "openrouter", label: "OpenRouter" },
      { id: "inbox", label: "Inbox" },
      { id: "ai", label: "AI models & prompts" },
      { id: "council", label: "LLM council" },
    ];

    const tabBar = containerEl.createDiv({ cls: "gsd-settings-tabs" });

    tabs.forEach((tab) => {
      const button = tabBar.createEl("button", {
        text: tab.label,
        cls: "gsd-settings-tab",
      });
      button.setAttr("type", "button");
      if (this.activeTab === tab.id) {
        button.addClass("is-active");
      }
      button.addEventListener("click", () => {
        this.activeTab = tab.id;
        this.display();
      });
    });
  }

  private renderGeneralTab(containerEl: HTMLElement): void {
    containerEl.createEl("p", {
      text: "Core behavior and folder locations.",
      cls: "setting-item-description",
    });

    new Setting(containerEl)
      .setName("Auto-research People on open")
      .setDesc("Research People notes automatically when opened")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoResearchPeopleOnOpen)
          .onChange(async (value) => {
            this.plugin.settings.autoResearchPeopleOnOpen = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Auto-research Organizations on open")
      .setDesc("Research Organization notes automatically when opened")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoResearchOrgsOnOpen)
          .onChange(async (value) => {
            this.plugin.settings.autoResearchOrgsOnOpen = value;
            await this.plugin.saveSettings();
          })
      );

    this.renderFolders(containerEl);
    this.renderPerformance(containerEl);
  }

  private renderDailyNotesTab(containerEl: HTMLElement): void {
    containerEl.createEl("p", {
      text: "Daily note generation, meeting lists, and prep.",
      cls: "setting-item-description",
    });

    this.renderIdentity(containerEl);
    this.renderMeetings(containerEl);
    this.renderO3(containerEl);
  }

  private renderApiTab(containerEl: HTMLElement): void {
    containerEl.createEl("p", {
      text: "Keys, endpoints, and external service connections.",
      cls: "setting-item-description",
    });

    this.renderApiConfig(containerEl);
    this.renderWebhook(containerEl);
    this.renderDiagnostics(containerEl);
  }

  private renderOpenRouterTab(containerEl: HTMLElement): void {
    containerEl.createEl("p", {
      text: "Browse and select OpenRouter models, then use their IDs in your workflow model fields.",
      cls: "setting-item-description",
    });

    if (!this.plugin.settings.openrouterApiKey) {
      containerEl.createEl("p", {
        text: "Add an OpenRouter API key in the API & Integration tab to enable requests.",
        cls: "setting-item-description",
      });
    }

    const header = containerEl.createDiv({ cls: "gsd-openrouter-toolbar" });
    const refreshButton = header.createEl("button", { text: "Refresh models" });
    refreshButton.addEventListener("click", async () => {
      refreshButton.setAttr("disabled", "true");
      await this.fetchOpenRouterModels(true);
      this.display();
    });

    const benchButton = header.createEl("button", { text: "Fetch benchmarks (visible)" });
    benchButton.addEventListener("click", async () => {
      benchButton.setAttr("disabled", "true");
      const visibleModels = this.getOpenRouterVisibleModels();
      await this.fetchOpenRouterBenchmarks(visibleModels);
      this.display();
    });

    const benchSelectedButton = header.createEl("button", { text: "Fetch benchmarks (selected)" });
    benchSelectedButton.addEventListener("click", async () => {
      benchSelectedButton.setAttr("disabled", "true");
      const selectedModels = this.getOpenRouterSelectedModels();
      if (!selectedModels.length) {
        new Notice("No OpenRouter models selected.");
        benchSelectedButton.removeAttribute("disabled");
        return;
      }
      await this.fetchOpenRouterBenchmarks(selectedModels);
      this.display();
    });

    const lastFetched = this.plugin.settings.openrouter.lastFetched;
    const lastFetchedText = lastFetched
      ? `Last sync: ${new Date(lastFetched).toLocaleString()}`
      : "No model cache yet";
    header.createEl("span", { text: lastFetchedText, cls: "gsd-openrouter-meta" });

    const benchFetched = this.plugin.settings.openrouter.benchmarks?.lastFetched ?? null;
    const benchFetchedText = benchFetched
      ? `Benchmarks: ${new Date(benchFetched).toLocaleString()}`
      : "Benchmarks: not fetched";
    header.createEl("span", { text: benchFetchedText, cls: "gsd-openrouter-meta" });

    const models = this.plugin.settings.openrouter.modelCache;
    if (!models.length) {
      containerEl.createEl("p", {
        text: "No models cached yet. Click \"Refresh models\" to load the latest list.",
        cls: "setting-item-description",
      });
      return;
    }

    const providers = Array.from(
      new Set(models.map((model) => this.getOpenRouterProvider(model)))
    ).sort((a, b) => a.localeCompare(b));
    if (this.openRouterProviderFilter !== "all" && !providers.includes(this.openRouterProviderFilter)) {
      this.openRouterProviderFilter = "all";
    }

    const filters = containerEl.createDiv({ cls: "gsd-openrouter-toolbar" });
    const searchInput = filters.createEl("input", {
      type: "text",
      placeholder: "Search models...",
    });
    searchInput.value = this.openRouterSearch;
    searchInput.addEventListener("input", () => {
      this.openRouterSearch = searchInput.value;
      this.openRouterSearchFocus = {
        start: searchInput.selectionStart ?? this.openRouterSearch.length,
        end: searchInput.selectionEnd ?? this.openRouterSearch.length,
      };
      this.display();
    });
    if (this.openRouterSearchFocus) {
      const { start, end } = this.openRouterSearchFocus;
      this.openRouterSearchFocus = null;
      searchInput.focus();
      try {
        searchInput.setSelectionRange(start, end);
      } catch {
        // Ignore selection errors for unsupported inputs
      }
    }

    const providerSelect = filters.createEl("select");
    providerSelect.createEl("option", { text: "All providers", value: "all" });
    providers.forEach((provider) => {
      providerSelect.createEl("option", { text: provider, value: provider });
    });
    providerSelect.value = this.openRouterProviderFilter;
    providerSelect.addEventListener("change", () => {
      this.openRouterProviderFilter = providerSelect.value;
      this.display();
    });

    const freeToggleLabel = filters.createEl("label");
    const freeToggle = freeToggleLabel.createEl("input", { type: "checkbox" });
    freeToggle.checked = this.openRouterFreeOnly;
    freeToggle.addEventListener("change", () => {
      this.openRouterFreeOnly = freeToggle.checked;
      this.display();
    });
    freeToggleLabel.appendText(" Free only");

    const selectedToggleLabel = filters.createEl("label");
    const selectedToggle = selectedToggleLabel.createEl("input", { type: "checkbox" });
    selectedToggle.checked = this.openRouterSelectedOnly;
    selectedToggle.addEventListener("change", () => {
      this.openRouterSelectedOnly = selectedToggle.checked;
      this.display();
    });
    selectedToggleLabel.appendText(" Selected only");

    const sortSelect = filters.createEl("select");
    sortSelect.createEl("option", { text: "Sort: Name", value: "name" });
    sortSelect.createEl("option", { text: "Sort: Provider", value: "provider" });
    sortSelect.createEl("option", { text: "Sort: Context", value: "context" });
    sortSelect.createEl("option", { text: "Sort: Cost", value: "cost" });
    sortSelect.createEl("option", { text: "Sort: Arena", value: "arena" });
    sortSelect.createEl("option", { text: "Sort: OpenLLM", value: "openllm" });
    sortSelect.createEl("option", { text: "Sort: Value", value: "value" });
    sortSelect.value = this.openRouterSort;
    sortSelect.addEventListener("change", () => {
      this.openRouterSort = sortSelect.value as OpenRouterSortKey;
      this.display();
    });

    const sortDirectionButton = filters.createEl("button", {
      text: this.openRouterSortDirection === "asc" ? "Asc" : "Desc",
    });
    sortDirectionButton.addEventListener("click", () => {
      this.openRouterSortDirection = this.openRouterSortDirection === "asc" ? "desc" : "asc";
      this.display();
    });

    const selectedSet = new Set(
      this.plugin.settings.openrouter.selectedModels.map((id) => id.toLowerCase())
    );

    const filtered = this.getOpenRouterVisibleModels();

    containerEl.createEl("p", {
      text: `Showing ${filtered.length} of ${models.length} models.`,
      cls: "setting-item-description",
    });

    const tableWrap = containerEl.createDiv({ cls: "gsd-openrouter-table-wrap" });
    const table = tableWrap.createEl("table", { cls: "gsd-openrouter-table" });
    const thead = table.createEl("thead");
    const headRow = thead.createEl("tr");
    ["Select", "Model", "Provider", "Context", "Cost", "Benchmarks", "Value", "Tools", "Actions"].forEach(
      (label) => headRow.createEl("th", { text: label })
    );

    const tbody = table.createEl("tbody");

    filtered.forEach((model) => {
      const isSelected = selectedSet.has(model.id.toLowerCase());
      const row = tbody.createEl("tr", {
        cls: isSelected ? "is-selected" : undefined,
      });

      const selectCell = row.createEl("td");
      const selectBox = selectCell.createEl("input", { type: "checkbox" });
      selectBox.checked = isSelected;
      selectBox.addEventListener("change", async () => {
        this.toggleOpenRouterSelection(model.id, selectBox.checked);
        await this.plugin.saveSettings();
        this.display();
      });

      const modelCell = row.createEl("td");
      const metaWrap = modelCell.createDiv({ cls: "gsd-openrouter-table-meta" });
      metaWrap.createDiv({ text: model.name || model.id, cls: "gsd-openrouter-row-title" });
      metaWrap.createDiv({ text: model.id, cls: "gsd-openrouter-row-id" });

      row.createEl("td", { text: this.getOpenRouterProvider(model) });
      row.createEl("td", { text: `${model.context_length.toLocaleString()} tokens` });
      row.createEl("td", { text: this.formatOpenRouterPricing(model) });
      row.createEl("td", { text: this.formatOpenRouterBenchmark(model) });
      row.createEl("td", { text: this.formatOpenRouterValue(model) });
      row.createEl("td", {
        text: model.supported_parameters?.includes("tools") ? "Yes" : "No",
      });

      const actionsCell = row.createEl("td");
      const actions = actionsCell.createDiv({ cls: "gsd-openrouter-table-actions" });

      const copyButton = actions.createEl("button", { text: "Copy ID" });
      copyButton.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(model.id);
          new Notice("Copied model ID");
        } catch (error) {
          console.warn("[GSD] Clipboard copy failed", error);
          new Notice("Copy failed");
        }
      });

      if (this.isOpenRouterFreeModel(model)) {
        const rankButton = actions.createEl("button", { text: "Rank" });
        rankButton.addEventListener("click", async () => {
          this.toggleOpenRouterSelection(model.id, true);
          this.addFreeRankModel(model.id);
          await this.plugin.saveSettings();
          this.display();
        });
      }
    });

    this.renderOpenRouterFreeRank(containerEl, models);
  }

  private async fetchOpenRouterModels(force: boolean): Promise<OpenRouterModel[]> {
    if (!force && this.plugin.settings.openrouter.modelCache.length > 0) {
      return this.plugin.settings.openrouter.modelCache;
    }

    try {
      const response = await requestUrl({
        url: "https://openrouter.ai/api/v1/models",
        method: "GET",
        headers: { "Content-Type": "application/json" },
      }) as RequestUrlResponse;

      if (response.status !== 200) {
        new Notice(`OpenRouter models request failed (HTTP ${response.status}).`);
        return this.plugin.settings.openrouter.modelCache;
      }

      const payload = response.json as { data?: Array<Record<string, unknown>> };
      if (!payload?.data || !Array.isArray(payload.data)) {
        new Notice("OpenRouter returned an unexpected payload.");
        return this.plugin.settings.openrouter.modelCache;
      }

      const normalized = payload.data
        .map((raw) => this.normalizeOpenRouterModel(raw))
        .filter((model): model is OpenRouterModel => Boolean(model));

      this.plugin.settings.openrouter.modelCache = normalized;
      this.plugin.settings.openrouter.lastFetched = new Date().toISOString();
      await this.plugin.saveSettings();
      return normalized;
    } catch (error) {
      console.warn("[GSD] Failed to fetch OpenRouter models", error);
      new Notice("Failed to fetch OpenRouter models.");
      return this.plugin.settings.openrouter.modelCache;
    }
  }

  private normalizeOpenRouterModel(raw: Record<string, unknown>): OpenRouterModel | null {
    const id = typeof raw.id === "string" ? raw.id : null;
    if (!id) return null;

    const pricing = (raw.pricing as Record<string, unknown> | undefined) ?? {};
    const parseNumber = (value: unknown): number => {
      if (typeof value === "number") return value;
      if (typeof value === "string") {
        const parsed = parseFloat(value);
        return Number.isFinite(parsed) ? parsed : 0;
      }
      return 0;
    };
    const parseOptionalNumber = (value: unknown): number | undefined => {
      const parsed = parseNumber(value);
      return parsed === 0 ? undefined : parsed;
    };

    const contextLengthRaw = raw.context_length;
    const contextLength = typeof contextLengthRaw === "number"
      ? contextLengthRaw
      : typeof contextLengthRaw === "string"
        ? parseInt(contextLengthRaw, 10)
        : 0;

    return {
      id,
      canonical_slug: typeof raw.canonical_slug === "string" ? raw.canonical_slug : undefined,
      hugging_face_id: typeof raw.hugging_face_id === "string" ? raw.hugging_face_id : undefined,
      name: typeof raw.name === "string" ? raw.name : id,
      description: typeof raw.description === "string" ? raw.description : undefined,
      context_length: Number.isFinite(contextLength) ? contextLength : 0,
      pricing: {
        prompt: parseNumber(pricing.prompt),
        completion: parseNumber(pricing.completion),
        request: parseOptionalNumber(pricing.request),
        image: parseOptionalNumber(pricing.image),
        web_search: parseOptionalNumber(pricing.web_search),
        internal_reasoning: parseOptionalNumber(pricing.internal_reasoning),
      },
      supported_parameters: Array.isArray(raw.supported_parameters)
        ? (raw.supported_parameters as string[])
        : [],
      per_request_limits: raw.per_request_limits as Record<string, unknown> | null,
      architecture: raw.architecture as OpenRouterModel["architecture"],
    };
  }

  private getOpenRouterProvider(model: OpenRouterModel): string {
    const id = model.id;
    if (!id.includes("/")) return "unknown";
    return id.split("/")[0];
  }

  private getOpenRouterVisibleModels(): OpenRouterModel[] {
    const models = this.plugin.settings.openrouter.modelCache;
    const selectedSet = new Set(
      this.plugin.settings.openrouter.selectedModels.map((id) => id.toLowerCase())
    );
    const searchTerm = this.openRouterSearch.trim().toLowerCase();
    const bench = this.plugin.settings.openrouter.benchmarks ?? {
      arenaScores: {},
      openLlmScores: {},
      lastFetched: null,
    };

    const filtered = models.filter((model) => {
      if (this.openRouterProviderFilter !== "all") {
        if (this.getOpenRouterProvider(model) !== this.openRouterProviderFilter) {
          return false;
        }
      }
      if (this.openRouterFreeOnly && !this.isOpenRouterFreeModel(model)) {
        return false;
      }
      if (this.openRouterSelectedOnly && !selectedSet.has(model.id.toLowerCase())) {
        return false;
      }
      if (searchTerm) {
        const haystack = `${model.name} ${model.id} ${model.description ?? ""}`.toLowerCase();
        if (!haystack.includes(searchTerm)) {
          return false;
        }
      }
      return true;
    });

    const direction = this.openRouterSortDirection === "asc" ? 1 : -1;
    const compareNumber = (left: number | null | undefined, right: number | null | undefined): number => {
      if (left == null && right == null) return 0;
      if (left == null) return 1;
      if (right == null) return -1;
      return (left - right) * direction;
    };
    const compareString = (left: string, right: string): number => left.localeCompare(right) * direction;

    return filtered.sort((a, b) => {
      let result = 0;
      switch (this.openRouterSort) {
        case "provider": {
          result = compareString(this.getOpenRouterProvider(a), this.getOpenRouterProvider(b));
          break;
        }
        case "context": {
          result = compareNumber(a.context_length, b.context_length);
          break;
        }
        case "cost": {
          const aCost = a.pricing.prompt + a.pricing.completion;
          const bCost = b.pricing.prompt + b.pricing.completion;
          result = compareNumber(aCost, bCost);
          break;
        }
        case "arena": {
          result = compareNumber(bench.arenaScores[a.id], bench.arenaScores[b.id]);
          break;
        }
        case "openllm": {
          result = compareNumber(bench.openLlmScores[a.id], bench.openLlmScores[b.id]);
          break;
        }
        case "value": {
          result = compareNumber(this.getOpenRouterValueScore(a, bench), this.getOpenRouterValueScore(b, bench));
          break;
        }
        case "name":
        default: {
          const aName = a.name || a.id;
          const bName = b.name || b.id;
          result = compareString(aName, bName);
          break;
        }
      }

      if (result !== 0) {
        return result;
      }

      return a.id.localeCompare(b.id) * direction;
    });
  }

  private getOpenRouterSelectedModels(): OpenRouterModel[] {
    const models = this.plugin.settings.openrouter.modelCache;
    const selectedSet = new Set(
      this.plugin.settings.openrouter.selectedModels.map((id) => id.toLowerCase())
    );
    return models.filter((model) => selectedSet.has(model.id.toLowerCase()));
  }

  private isOpenRouterFreeModel(model: OpenRouterModel): boolean {
    return model.pricing.prompt === 0 && model.pricing.completion === 0;
  }

  private formatOpenRouterPricing(model: OpenRouterModel): string {
    if (this.isOpenRouterFreeModel(model)) {
      return "Free";
    }
    const formatCost = (value: number) => `$${value.toFixed(3)}`;
    const prompt = model.pricing.prompt * 1_000_000;
    const completion = model.pricing.completion * 1_000_000;
    let text = `${formatCost(prompt)}/1M in · ${formatCost(completion)}/1M out`;
    if (model.pricing.request && model.pricing.request > 0) {
      text += ` · ${formatCost(model.pricing.request)}/request`;
    }
    return text;
  }

  private formatOpenRouterBenchmark(model: OpenRouterModel): string {
    const bench = this.plugin.settings.openrouter.benchmarks ?? {
      arenaScores: {},
      openLlmScores: {},
      lastFetched: null,
    };
    const arenaScore = bench.arenaScores[model.id];
    const openLlmScore = bench.openLlmScores[model.id];
    const parts: string[] = [];
    if (arenaScore != null) {
      parts.push(`Arena ${Math.round(arenaScore)}`);
    }
    if (openLlmScore != null) {
      parts.push(`OpenLLM ${openLlmScore.toFixed(1)}%`);
    }
    if (parts.length === 0) {
      return "N/A";
    }
    return parts.join(" · ");
  }

  private getOpenRouterValueScore(
    model: OpenRouterModel,
    bench = this.plugin.settings.openrouter.benchmarks ?? {
      arenaScores: {},
      openLlmScores: {},
      lastFetched: null,
    }
  ): number | null {
    const openLlmScore = bench.openLlmScores[model.id];
    const arenaScore = bench.arenaScores[model.id];
    const score = openLlmScore ?? arenaScore;
    if (score == null) return null;

    const costPerToken = model.pricing.prompt + model.pricing.completion;
    if (costPerToken <= 0) return Number.POSITIVE_INFINITY;
    const costPer1M = costPerToken * 1_000_000;
    if (!Number.isFinite(costPer1M) || costPer1M <= 0) return null;

    return score / costPer1M;
  }

  private formatOpenRouterValue(model: OpenRouterModel): string {
    const value = this.getOpenRouterValueScore(model);
    if (value == null) {
      return this.isOpenRouterFreeModel(model) ? "Free" : "N/A";
    }
    if (!Number.isFinite(value)) {
      return "∞";
    }
    const formatted = value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2);
    return `${formatted} score/$1M`;
  }

  private async fetchOpenRouterBenchmarks(models: OpenRouterModel[]): Promise<void> {
    if (!models.length) {
      new Notice("No models to benchmark.");
      return;
    }

    const arenaMap = await this.fetchArenaScores();
    const arenaScores = { ...this.plugin.settings.openrouter.benchmarks.arenaScores };
    const openLlmScores = { ...this.plugin.settings.openrouter.benchmarks.openLlmScores };

    models.forEach((model) => {
      const arenaScore = this.matchArenaScore(model, arenaMap);
      if (arenaScore != null) {
        arenaScores[model.id] = arenaScore;
      }
    });

    for (const model of models) {
      if (this.openLlmBackoffUntil && Date.now() < this.openLlmBackoffUntil) {
        new Notice("Open LLM benchmark rate limited; try again later.");
        break;
      }
      if (openLlmScores[model.id] != null) {
        continue;
      }
      const openLlmScore = await this.fetchOpenLlmScore(model);
      if (openLlmScore != null) {
        openLlmScores[model.id] = openLlmScore;
      }
    }

    this.plugin.settings.openrouter.benchmarks = {
      arenaScores,
      openLlmScores,
      lastFetched: new Date().toISOString(),
    };
    await this.plugin.saveSettings();
    new Notice("Benchmarks updated.");
  }

  private normalizeBenchmarkKey(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
  }

  private stripHtmlTags(value: string): string {
    return value.replace(/<[^>]*>/g, "");
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  private async rateLimitOpenLlm(): Promise<void> {
    const now = Date.now();
    const minDelayMs = 700;
    const waitFor = Math.max(0, this.openLlmLastRequestAt + minDelayMs - now);
    if (waitFor > 0) {
      await this.sleep(waitFor);
    }
    this.openLlmLastRequestAt = Date.now();
  }

  private async requestOpenLlm(
    options: { url: string; method: "GET" },
    label: string
  ): Promise<RequestUrlResponse | null> {
    if (this.openLlmBackoffUntil && Date.now() < this.openLlmBackoffUntil) {
      return null;
    }

    const maxRetries = 2;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        await this.rateLimitOpenLlm();
        const response = await requestUrl(options) as RequestUrlResponse;
        if (response.status === 429) {
          this.openLlmBackoffUntil = Date.now() + 60_000;
          await this.sleep(2000 * (attempt + 1));
          continue;
        }
        return response;
      } catch (error) {
        const status = (error as { status?: number }).status;
        const message = error instanceof Error ? error.message : String(error);
        if (status === 429 || message.includes("status 429")) {
          this.openLlmBackoffUntil = Date.now() + 60_000;
          await this.sleep(2000 * (attempt + 1));
          continue;
        }
        console.warn(`[GSD] Failed to fetch Open LLM benchmark (${label})`, error);
        return null;
      }
    }

    return null;
  }

  private getArenaKeyVariants(value: string): string[] {
    const trimmed = value.trim();
    if (!trimmed) return [];

    const variants = new Set<string>();
    const base = this.normalizeBenchmarkKey(trimmed);
    if (base) {
      variants.add(base);
    }

    let next = base.replace(/\d{8}$/g, "").replace(/\d{6}$/g, "");
    if (next && next !== base) {
      variants.add(next);
    }

    const withoutSuffix = next.replace(/(latest|preview|alpha|beta|rc)$/g, "");
    if (withoutSuffix && withoutSuffix !== next) {
      variants.add(withoutSuffix);
    }

    const withoutChatGpt = withoutSuffix.replace(/^chatgpt/, "");
    if (withoutChatGpt && withoutChatGpt !== withoutSuffix) {
      variants.add(withoutChatGpt);
    }

    return Array.from(variants);
  }

  private matchArenaScore(model: OpenRouterModel, arenaMap: Map<string, number>): number | null {
    const candidates = [
      model.name,
      model.id,
      model.id.split("/").pop() ?? model.id,
      model.canonical_slug ?? "",
      model.hugging_face_id ?? "",
    ].filter(Boolean);

    for (const candidate of candidates) {
      const keys = this.getArenaKeyVariants(candidate);
      for (const key of keys) {
        const score = arenaMap.get(key);
        if (score != null) {
          return score;
        }
      }
    }
    return null;
  }

  private async fetchOpenLlmResultFiles(path: string): Promise<string[] | null> {
    const treeResponse = await this.requestOpenLlm(
      {
        url: `https://huggingface.co/api/datasets/open-llm-leaderboard/results/tree/main/${this.encodePath(path)}`,
        method: "GET",
      },
      "tree"
    );

    if (!treeResponse || treeResponse.status !== 200) {
      return null;
    }

    const files = treeResponse.json as Array<{ path?: string }>;
    return files
      .map((file) => file.path)
      .filter((entry): entry is string => Boolean(entry) && entry.includes("results_") && entry.endsWith(".json"));
  }

  private async getOpenLlmOrgIndex(org: string): Promise<Map<string, string> | null> {
    if (this.openLlmOrgIndex.has(org)) {
      return this.openLlmOrgIndex.get(org) ?? null;
    }

    const response = await this.requestOpenLlm(
      {
        url: `https://huggingface.co/api/datasets/open-llm-leaderboard/results/tree/main/${this.encodePath(org)}`,
        method: "GET",
      },
      "org-index"
    );

    if (!response || response.status !== 200) {
      return null;
    }

    const entries = response.json as Array<{ path?: string; type?: string }>;
    const index = new Map<string, string>();
    entries.forEach((entry) => {
      if (entry.type !== "directory") return;
      const path = entry.path;
      if (!path) return;
      const leaf = path.split("/").pop() ?? path;
      index.set(this.normalizeBenchmarkKey(leaf), path);
    });

    this.openLlmOrgIndex.set(org, index);
    return index;
  }

  private async resolveOpenLlmPath(candidateId: string): Promise<string | null> {
    if (!candidateId.includes("/")) return null;

    const [org, ...rest] = candidateId.split("/");
    const repo = rest.join("/");
    const index = await this.getOpenLlmOrgIndex(org);
    if (!index) return null;

    const directKey = this.normalizeBenchmarkKey(repo);
    if (index.has(directKey)) {
      return index.get(directKey) ?? null;
    }

    const withoutMeta = repo.replace(/^meta[-_]/i, "");
    if (withoutMeta !== repo) {
      const altKey = this.normalizeBenchmarkKey(withoutMeta);
      if (index.has(altKey)) {
        return index.get(altKey) ?? null;
      }
    }

    return null;
  }

  private async fetchArenaScores(): Promise<Map<string, number>> {
    const arenaMap = new Map<string, number>();
    const pageSize = 100;
    let offset = 0;

    while (true) {
      try {
        const response = await requestUrl({
          url: `https://datasets-server.huggingface.co/rows?dataset=mathewhe/chatbot-arena-elo&config=default&split=train&offset=${offset}&length=${pageSize}`,
          method: "GET",
        }) as RequestUrlResponse;

        if (response.status !== 200) {
          console.warn(`[GSD] Arena benchmark fetch failed: HTTP ${response.status}`);
          break;
        }

        const payload = response.json as { rows?: Array<{ row?: Record<string, unknown> }> };
        const rows = payload.rows ?? [];
        if (!rows.length) break;

        rows.forEach((entry) => {
          const row = entry.row ?? {};
          const model = typeof row["Model"] === "string" ? row["Model"] : null;
          const score = typeof row["Arena Score"] === "number" ? row["Arena Score"] : null;
          if (model && score != null) {
            const markup = typeof row["Model Markup"] === "string" ? row["Model Markup"] : null;
            const candidates = [model, markup ? this.stripHtmlTags(markup) : null]
              .filter((value): value is string => Boolean(value));
            candidates.forEach((candidate) => {
              this.getArenaKeyVariants(candidate).forEach((key) => {
                if (!arenaMap.has(key)) {
                  arenaMap.set(key, score);
                }
              });
            });
          }
        });

        if (rows.length < pageSize) break;
        offset += rows.length;
      } catch (error) {
        console.warn("[GSD] Failed to fetch Arena benchmarks", error);
        break;
      }
    }

    return arenaMap;
  }

  private async fetchOpenLlmScore(model: OpenRouterModel): Promise<number | null> {
    if (this.openLlmBackoffUntil && Date.now() < this.openLlmBackoffUntil) {
      return null;
    }

    const candidates = Array.from(new Set(
      [model.hugging_face_id, model.canonical_slug, model.id]
        .filter((value): value is string => Boolean(value) && value.includes("/"))
    ));

    for (const candidate of candidates) {
      if (this.openLlmBackoffUntil && Date.now() < this.openLlmBackoffUntil) {
        return null;
      }
      const directFiles = await this.fetchOpenLlmResultFiles(candidate);
      const files = directFiles?.length ? directFiles : null;
      const resolved = files ? null : await this.resolveOpenLlmPath(candidate);
      const resolvedFiles = !files && resolved ? await this.fetchOpenLlmResultFiles(resolved) : null;
      const resultFiles = files ?? resolvedFiles ?? [];

      if (!resultFiles.length) continue;

      const latestPath = resultFiles.sort().at(-1);
      if (!latestPath) continue;

      const resultResponse = await this.requestOpenLlm(
        {
          url: `https://huggingface.co/datasets/open-llm-leaderboard/results/resolve/main/${this.encodePath(latestPath)}`,
          method: "GET",
        },
        "results"
      );

      if (!resultResponse || resultResponse.status !== 200) {
        continue;
      }

      const data = resultResponse.json as { results?: Record<string, Record<string, unknown>> };
      const leaderboard = data?.results?.leaderboard ?? {};
      const accNorm = leaderboard["acc_norm,none"];
      const acc = leaderboard["acc,none"];
      const value = typeof accNorm === "number" ? accNorm : typeof acc === "number" ? acc : null;
      if (value == null) continue;

      return Math.round(value * 1000) / 10;
    }

    return null;
  }

  private encodePath(path: string): string {
    return path.split("/").map((segment) => encodeURIComponent(segment)).join("/");
  }

  private toggleOpenRouterSelection(modelId: string, selected: boolean): void {
    const existing = this.plugin.settings.openrouter.selectedModels;
    const lowered = modelId.toLowerCase();
    if (selected) {
      if (!existing.some((id) => id.toLowerCase() === lowered)) {
        this.plugin.settings.openrouter.selectedModels = [...existing, modelId];
      }
      return;
    }
    this.plugin.settings.openrouter.selectedModels = existing.filter(
      (id) => id.toLowerCase() !== lowered
    );
  }

  private addFreeRankModel(modelId: string): void {
    const rank = this.plugin.settings.openrouter.freeModelRank;
    if (!rank.includes(modelId)) {
      this.plugin.settings.openrouter.freeModelRank = [...rank, modelId];
    }
  }

  private renderOpenRouterFreeRank(containerEl: HTMLElement, models: OpenRouterModel[]): void {
    this.createSection(
      containerEl,
      "Free model fallback (auto-free)",
      "Set the priority order for free OpenRouter models. Use model ID \"openrouter:auto-free\" to always pick the highest-ranked model that is not rate limited."
    );

    const modelsById = new Map(models.map((model) => [model.id, model]));

    const actions = containerEl.createDiv({ cls: "gsd-openrouter-toolbar" });
    const seedButton = actions.createEl("button", { text: "Seed from selected free models" });
    seedButton.addEventListener("click", async () => {
      const selectedFree = this.plugin.settings.openrouter.selectedModels.filter((id) => {
        const model = modelsById.get(id);
        return model ? this.isOpenRouterFreeModel(model) : false;
      });
      this.plugin.settings.openrouter.freeModelRank = Array.from(new Set(selectedFree));
      await this.plugin.saveSettings();
      this.display();
    });

    const clearButton = actions.createEl("button", { text: "Clear ranking" });
    clearButton.addEventListener("click", async () => {
      this.plugin.settings.openrouter.freeModelRank = [];
      await this.plugin.saveSettings();
      this.display();
    });

    const rankList = containerEl.createDiv({ cls: "gsd-openrouter-rank-list" });
    let dragId: string | null = null;

    const renderList = () => {
      rankList.empty();
      const ranked = this.plugin.settings.openrouter.freeModelRank;
      if (ranked.length === 0) {
        rankList.createEl("p", {
          text: "No ranked free models yet. Add one from the model list above.",
          cls: "setting-item-description",
        });
        return;
      }

      ranked.forEach((modelId) => {
        const model = modelsById.get(modelId);
        const row = rankList.createDiv({ cls: "gsd-openrouter-rank-item" });
        row.setAttr("draggable", "true");

        const label = row.createDiv();
        const handle = label.createSpan({ text: "||", cls: "gsd-openrouter-rank-handle" });
        handle.setAttr("aria-hidden", "true");
        label.createSpan({ text: model?.name || modelId });
        label.createEl("div", { text: modelId, cls: "gsd-openrouter-row-id" });

        const removeButton = row.createEl("button", { text: "Remove" });
        removeButton.addEventListener("click", async () => {
          this.plugin.settings.openrouter.freeModelRank = this.plugin.settings.openrouter.freeModelRank.filter(
            (id) => id !== modelId
          );
          await this.plugin.saveSettings();
          renderList();
        });

        row.addEventListener("dragstart", () => {
          dragId = modelId;
          row.addClass("is-dragging");
        });

        row.addEventListener("dragend", () => {
          dragId = null;
          row.removeClass("is-dragging");
        });

        row.addEventListener("dragover", (event) => {
          event.preventDefault();
          row.addClass("is-drop-target");
        });

        row.addEventListener("dragleave", () => {
          row.removeClass("is-drop-target");
        });

        row.addEventListener("drop", async (event) => {
          event.preventDefault();
          row.removeClass("is-drop-target");
          if (!dragId || dragId === modelId) return;

          const current = [...this.plugin.settings.openrouter.freeModelRank];
          const fromIndex = current.indexOf(dragId);
          const toIndex = current.indexOf(modelId);
          if (fromIndex === -1 || toIndex === -1) return;

          current.splice(fromIndex, 1);
          current.splice(toIndex, 0, dragId);
          this.plugin.settings.openrouter.freeModelRank = current;
          await this.plugin.saveSettings();
          renderList();
        });
      });
    };

    renderList();
  }

  private renderInboxTab(containerEl: HTMLElement): void {
    this.renderInbox(containerEl);
  }

  private renderAiTab(containerEl: HTMLElement): void {
    containerEl.createEl("p", {
      text: "Choose models and (optionally) edit prompts and generation settings.",
      cls: "setting-item-description",
    });
    containerEl.createEl("p", {
      text: "OpenRouter models use provider/model IDs (e.g., openai/gpt-4o-mini).",
      cls: "setting-item-description",
    });

    this.renderModelQuickApply(containerEl);

    const modelDetails = this.createDetailsSection(
      containerEl,
      "Per-workflow models (advanced)",
      "Override the default model for specific workflows."
    );
    this.renderModels(modelDetails, { includeHeader: false });

    const configDetails = this.createDetailsSection(
      containerEl,
      "Generation config (advanced)",
      "Control temperature and reasoning effort per workflow."
    );
    this.renderGenerationConfigs(configDetails, { includeHeader: false });

    const promptDetails = this.createDetailsSection(
      containerEl,
      "Prompts (advanced)",
      "Edit the exact prompts used for each workflow."
    );
    this.renderPrompts(promptDetails, { includeHeader: false });
  }

  private renderModelQuickApply(containerEl: HTMLElement): void {
    this.createSection(
      containerEl,
      "Model defaults",
      "Set one model for everything, then override only where needed."
    );

    let bulkModel = this.plugin.settings.models.briefingModel || "";

    const bulkSetting = new Setting(containerEl)
      .setName("Default model")
      .setDesc("Apply this model name to all workflows.");

    bulkSetting.addText((text) =>
      text
        .setPlaceholder("gemini-flash-latest or gpt-4o-mini")
        .setValue(bulkModel)
        .onChange((value) => {
          bulkModel = value.trim();
        })
    );

    bulkSetting.addButton((button) =>
      button.setButtonText("Apply to all").setCta().onClick(async () => {
        if (!bulkModel) {
          new Notice("Enter a model name first.");
          return;
        }
        this.applyModelToAll(bulkModel);
        await this.plugin.saveSettings();
        this.display();
      })
    );

  }

  private applyModelToAll(model: string): void {
    this.plugin.settings.models = {
      ...this.plugin.settings.models,
      filterModel: model,
      briefingModel: model,
      personResearchModel: model,
      orgResearchModel: model,
      phoneValidationModel: model,
      inboxRoutingModel: model,
      settingsHelperModel: model,
    };
  }

  private renderCouncilTab(containerEl: HTMLElement): void {
    this.renderLlmCouncil(containerEl);
  }

  private renderApiConfig(containerEl: HTMLElement): void {
    this.createSection(
      containerEl,
      "API Providers",
      "Keys for Gemini, OpenAI, Anthropic, and OpenRouter."
    );

    const statusLine = [
      this.plugin.settings.geminiApiKey ? "Gemini ✓" : "Gemini ✕",
      this.plugin.settings.openaiApiKey ? "OpenAI ✓" : "OpenAI ✕",
      this.plugin.settings.anthropicApiKey ? "Anthropic ✓" : "Anthropic ✕",
      this.plugin.settings.openrouterApiKey ? "OpenRouter ✓" : "OpenRouter ✕",
    ].join(" · ");
    containerEl.createEl("p", {
      text: `Configured: ${statusLine}`,
      cls: "setting-item-description",
    });

    this.addSecretSetting(containerEl, {
      name: "Gemini API Key",
      desc: "API key for Google Gemini",
      placeholder: "AI... or your Gemini key",
      value: this.plugin.settings.geminiApiKey,
      onChange: async (value) => {
        this.plugin.settings.geminiApiKey = value;
        await this.plugin.saveSettings();
      },
    });

    this.addSecretSetting(containerEl, {
      name: "OpenAI API Key",
      desc: "API key for OpenAI (optional, for GPT models)",
      placeholder: "sk-...",
      value: this.plugin.settings.openaiApiKey,
      onChange: async (value) => {
        this.plugin.settings.openaiApiKey = value;
        await this.plugin.saveSettings();
      },
    });

    this.addSecretSetting(containerEl, {
      name: "OpenRouter API Key",
      desc: "API key for OpenRouter (optional, for router models)",
      placeholder: "sk-or-...",
      value: this.plugin.settings.openrouterApiKey,
      onChange: async (value) => {
        this.plugin.settings.openrouterApiKey = value;
        await this.plugin.saveSettings();
      },
    });

    this.addSecretSetting(containerEl, {
      name: "Anthropic API Key",
      desc: "API key for Anthropic (optional, for Claude models)",
      placeholder: "sk-ant-...",
      value: this.plugin.settings.anthropicApiKey,
      onChange: async (value) => {
        this.plugin.settings.anthropicApiKey = value;
        await this.plugin.saveSettings();
      },
    });

    this.createSection(
      containerEl,
      "Google Apps Script",
      "Gmail/Docs access for meeting briefs and research."
    );

    new Setting(containerEl)
      .setName("Apps Script URL")
      .setDesc("URL for the Google Apps Script that handles Gmail/Docs access")
      .addText((text) =>
        text
          .setPlaceholder("https://script.google.com/...")
          .setValue(this.plugin.settings.appsScriptUrl)
          .onChange(async (value) => {
            this.plugin.settings.appsScriptUrl = value;
            await this.plugin.saveSettings();
          })
      );

    this.addSecretSetting(containerEl, {
      name: "Apps Script Secret",
      desc: "Secret token for authenticating with the Apps Script",
      placeholder: "Enter secret",
      value: this.plugin.settings.appsScriptSecret,
      onChange: async (value) => {
        this.plugin.settings.appsScriptSecret = value;
        await this.plugin.saveSettings();
      },
    });
  }

  private renderIdentity(containerEl: HTMLElement): void {
    this.createSection(
      containerEl,
      "Identity & Exclusions",
      "Used to filter attendees and avoid noisy matches."
    );

    new Setting(containerEl)
      .setName("Your Domain")
      .setDesc("Your company email domain (e.g., finn.com)")
      .addText((text) =>
        text
          .setPlaceholder("company.com")
          .setValue(this.plugin.settings.yourDomain)
          .onChange(async (value) => {
            this.plugin.settings.yourDomain = value;
            await this.plugin.saveSettings();
          })
      );

    this.createListSetting(containerEl, {
      name: "Excluded Emails",
      desc: "Emails to exclude from attendee lists (one per line)",
      value: this.plugin.settings.excludeEmails,
      placeholder: "you@company.com\nassistant@company.com",
      onChange: async (value) => {
        this.plugin.settings.excludeEmails = value;
        await this.plugin.saveSettings();
      },
    });

    this.createListSetting(containerEl, {
      name: "Excluded Names",
      desc: "Names to exclude from attendee lists (one per line)",
      value: this.plugin.settings.excludeNames,
      placeholder: "Your Name\nConference Room",
      onChange: async (value) => {
        this.plugin.settings.excludeNames = value;
        await this.plugin.saveSettings();
      },
    });
  }

  private renderFolders(containerEl: HTMLElement): void {
    this.createSection(containerEl, "Folder Paths", "Where notes are stored in your vault.");

    new Setting(containerEl)
      .setName("People Folder")
      .setDesc("Folder path for People notes")
      .addText((text) =>
        text
          .setPlaceholder("People")
          .setValue(this.plugin.settings.peopleFolder)
          .onChange(async (value) => {
            this.plugin.settings.peopleFolder = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Organizations Folder")
      .setDesc("Folder path for Organization notes")
      .addText((text) =>
        text
          .setPlaceholder("Organizations")
          .setValue(this.plugin.settings.organizationsFolder)
          .onChange(async (value) => {
            this.plugin.settings.organizationsFolder = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Meetings Folder")
      .setDesc("Folder path for Meeting notes")
      .addText((text) =>
        text
          .setPlaceholder("Meetings")
          .setValue(this.plugin.settings.meetingsFolder)
          .onChange(async (value) => {
            this.plugin.settings.meetingsFolder = value;
            await this.plugin.saveSettings();
          })
      );
  }

  private renderMeetings(containerEl: HTMLElement): void {
    this.createSection(
      containerEl,
      "Meetings & Daily Notes",
      "Controls meeting list generation and briefing behavior."
    );

    this.createListSetting(containerEl, {
      name: "Excluded Titles",
      desc: "Meeting titles to skip entirely (one per line)",
      value: this.plugin.settings.excludeTitles,
      placeholder: "Blocker\nLunch\nFocus Time",
      onChange: async (value) => {
        this.plugin.settings.excludeTitles = value;
        await this.plugin.saveSettings();
      },
    });

    new Setting(containerEl)
      .setName("Max Listed Participants")
      .setDesc("Maximum number of participants to list in daily note (0 = no limit)")
      .addSlider((slider) =>
        slider
          .setLimits(0, 20, 1)
          .setValue(this.plugin.settings.maxListedParticipants)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.maxListedParticipants = value;
            await this.plugin.saveSettings();
          })
      );
  }

  private renderO3(containerEl: HTMLElement): void {
    this.createSection(
      containerEl,
      "O3 Prep",
      "Configure the O3 dashboard and master prep note."
    );

    new Setting(containerEl)
      .setName("Enable O3 dashboard")
      .setDesc("Show the O3 sidebar view and enable O3 prep features")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.o3.enabled)
          .onChange(async (value) => {
            this.plugin.settings.o3.enabled = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Master O3 prep note")
      .setDesc("Rolling weekly note where O3 prep is written")
      .addText((text) =>
        text
          .setPlaceholder("FINN/O3 prep.md")
          .setValue(this.plugin.settings.o3.masterNotePath)
          .onChange(async (value) => {
            this.plugin.settings.o3.masterNotePath = value || "FINN/O3 prep.md";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("O3 meeting title regex")
      .setDesc("Regex used to identify O3/1:1 meetings from calendar events")
      .addText((text) =>
        text
          .setPlaceholder("\\bO3\\b|\\b1:1\\b|\\b1-1\\b|one-on-one")
          .setValue(this.plugin.settings.o3.meetingTitleRegex)
          .onChange(async (value) => {
            this.plugin.settings.o3.meetingTitleRegex = value || "\\bO3\\b|\\b1:1\\b|\\b1-1\\b|one-on-one";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Insert O3 prep link in daily notes")
      .setDesc("Adds a prep link under O3 meetings in daily notes")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.o3.dailyNoteInsert)
          .onChange(async (value) => {
            this.plugin.settings.o3.dailyNoteInsert = value;
            await this.plugin.saveSettings();
          })
      );

    this.createSubsection(containerEl, "O3 Coach", "Configure chat coach context scope.");

    new Setting(containerEl)
      .setName("Coach lookback days")
      .setDesc("How many days of daily/meeting notes to include")
      .addText((text) =>
        text
          .setPlaceholder("21")
          .setValue(this.plugin.settings.o3Coach.lookbackDays.toString())
          .onChange(async (value) => {
            const parsed = this.parseOptionalNumber(value);
            this.plugin.settings.o3Coach.lookbackDays = parsed ?? 21;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Performance review folder")
      .setDesc("Folder path containing business performance reviews")
      .addText((text) =>
        text
          .setPlaceholder("Y_Resources/FINN Files")
          .setValue(this.plugin.settings.o3Coach.perfReviewFolder)
          .onChange(async (value) => {
            this.plugin.settings.o3Coach.perfReviewFolder = value || "Y_Resources/FINN Files";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Max performance review files")
      .setDesc("Maximum number of performance reviews to include")
      .addText((text) =>
        text
          .setPlaceholder("6")
          .setValue(this.plugin.settings.o3Coach.perfReviewMax.toString())
          .onChange(async (value) => {
            const parsed = this.parseOptionalNumber(value);
            this.plugin.settings.o3Coach.perfReviewMax = parsed ?? 6;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Max current notes")
      .setDesc("Maximum number of daily/meeting notes to include")
      .addText((text) =>
        text
          .setPlaceholder("50")
          .setValue(this.plugin.settings.o3Coach.currentNotesMax.toString())
          .onChange(async (value) => {
            const parsed = this.parseOptionalNumber(value);
            this.plugin.settings.o3Coach.currentNotesMax = parsed ?? 50;
            await this.plugin.saveSettings();
          })
      );
  }

  private renderInbox(containerEl: HTMLElement): void {
    this.createSection(
      containerEl,
      "Inbox",
      "Capture, route, and format content from shortcuts or share sheets."
    );

    new Setting(containerEl)
      .setName("Enable Inbox")
      .setDesc("Enable the inbox feature for capturing content via URI")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.inbox.enabled)
          .onChange(async (value) => {
            this.plugin.settings.inbox.enabled = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Thoughts Section")
      .setDesc("Section heading in daily note where captured thoughts are appended")
      .addText((text) =>
        text
          .setPlaceholder("## Thoughts")
          .setValue(this.plugin.settings.inbox.thoughtsSection)
          .onChange(async (value) => {
            this.plugin.settings.inbox.thoughtsSection = value || "## Thoughts";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Meeting Detection Window")
      .setDesc("Minutes before/after meeting times to consider as 'in a meeting'")
      .addSlider((slider) =>
        slider
          .setLimits(5, 30, 5)
          .setValue(this.plugin.settings.inbox.meetingWindowMinutes)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.inbox.meetingWindowMinutes = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Smart Suggestions")
      .setDesc("Suggest adding information to existing People/Organization notes when mentioned")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.inbox.smartSuggestionsEnabled)
          .onChange(async (value) => {
            this.plugin.settings.inbox.smartSuggestionsEnabled = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("AI Routing Fallback")
      .setDesc("Use AI routing when no deterministic rule matches")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.inbox.routing.aiFallbackEnabled)
          .onChange(async (value) => {
            this.plugin.settings.inbox.routing.aiFallbackEnabled = value;
            await this.plugin.saveSettings();
          })
      );

    const triggerSection = this.createDetailsSection(
      containerEl,
      "Trigger phrases",
      "Custom commands recognized at the start of a capture."
    );

    new Setting(triggerSection)
      .setName("Enable Trigger Phrases")
      .setDesc("Enable special phrases like 'Research' or 'Follow up'")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.inbox.triggers.enabled)
          .onChange(async (value) => {
            this.plugin.settings.inbox.triggers.enabled = value;
            await this.plugin.saveSettings();
          })
      );

    this.createListSetting(triggerSection, {
      name: "Follow-up phrases",
      desc: "Starts a follow-up task when a capture begins with one of these",
      value: this.plugin.settings.inbox.triggers.followupPhrases,
      placeholder: "follow up\nfollow-up\nfollowup",
      helper: {
        title: "Follow-up phrase helper",
        context: "Inbox follow-up trigger phrases",
        defaultQuestion: "Suggest more follow-up phrases. Return one per line.",
      },
      onChange: async (value) => {
        this.plugin.settings.inbox.triggers.followupPhrases = value;
        await this.plugin.saveSettings();
      },
    });

    this.createListSetting(triggerSection, {
      name: "Research phrases",
      desc: "Starts a research run when a capture begins with one of these",
      value: this.plugin.settings.inbox.triggers.researchPhrases,
      placeholder: "research",
      helper: {
        title: "Research phrase helper",
        context: "Inbox research trigger phrases",
        defaultQuestion: "Suggest research trigger phrases. Return one per line.",
      },
      onChange: async (value) => {
        this.plugin.settings.inbox.triggers.researchPhrases = value;
        await this.plugin.saveSettings();
      },
    });

    const routingSection = this.createDetailsSection(
      containerEl,
      "Routing",
      "Deterministic rules with a fallback default."
    );

    new Setting(routingSection)
      .setName("Default destination")
      .setDesc("Where to send items when no rule matches")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("daily_thoughts", "Daily thoughts")
          .addOption("meeting_followup", "Meeting follow-up")
          .addOption("daily_end", "Daily end")
          .setValue(this.plugin.settings.inbox.routing.defaultDestination)
          .onChange(async (value) => {
            this.plugin.settings.inbox.routing.defaultDestination =
              value as InboxRouteDestination;
            await this.plugin.saveSettings();
          })
      );

    new Setting(routingSection)
      .setName("Default format")
      .setDesc("How to format items when no rule matches")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("auto", "Auto")
          .addOption("task", "Task")
          .addOption("thought", "Thought")
          .setValue(this.plugin.settings.inbox.routing.defaultFormat)
          .onChange(async (value) => {
            this.plugin.settings.inbox.routing.defaultFormat = value as InboxFormatStyle;
            await this.plugin.saveSettings();
          })
      );

    new Setting(routingSection)
      .setName("Default add due date")
      .setDesc("Add a due date when default formatting yields a task")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.inbox.routing.defaultAddDueDate)
          .onChange(async (value) => {
            this.plugin.settings.inbox.routing.defaultAddDueDate = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(routingSection)
      .setName("Routing rule helper")
      .setDesc("Ask for ideas, edge cases, or regex examples")
      .addButton((button) =>
        button.setButtonText("Ask AI").onClick(() => {
          this.openSettingsHelperModal({
            title: "Inbox routing rules",
            context: "Inbox routing rules and deterministic matching",
            currentValue: this.plugin.settings.inbox.routing.rules
              .map((rule) => `- ${rule.name}`)
              .join("\n"),
            defaultQuestion:
              "How would you structure inbox routing rules for tasks, references, and meeting follow-ups?",
            model: this.getSettingsHelperModel(),
            aiService: this.plugin.getAIService(),
          });
        })
      );

    this.renderInboxRoutingRules(routingSection);

    const actionSection = this.createDetailsSection(
      containerEl,
      "Action detection",
      "Controls when content becomes a task."
    );

    new Setting(actionSection)
      .setName("Enable action detection")
      .setDesc("Detects action verbs and short tasks")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.inbox.actionDetection.enabled)
          .onChange(async (value) => {
            this.plugin.settings.inbox.actionDetection.enabled = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(actionSection)
      .setName("Match mode")
      .setDesc("Whether verbs must start the line or just appear anywhere")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("starts_with", "Starts with")
          .addOption("contains", "Contains")
          .addOption("both", "Starts with or contains")
          .setValue(this.plugin.settings.inbox.actionDetection.matchMode)
          .onChange(async (value) => {
            this.plugin.settings.inbox.actionDetection.matchMode = value as
              | "starts_with"
              | "contains"
              | "both";
            await this.plugin.saveSettings();
          })
      );

    this.createListSetting(actionSection, {
      name: "Action verbs",
      desc: "Verbs or phrases that should imply a task (one per line)",
      value: this.plugin.settings.inbox.actionDetection.verbs,
      placeholder: "call\nemail\nfollow up\nreview\nprepare",
      helper: {
        title: "Action verb helper",
        context: "Inbox action verb list",
        defaultQuestion: "Suggest action verbs for tasks. Return one per line.",
      },
      onChange: async (value) => {
        this.plugin.settings.inbox.actionDetection.verbs = value;
        await this.plugin.saveSettings();
      },
    });

    new Setting(actionSection)
      .setName("Imperative detection")
      .setDesc("Treat imperative phrasing (e.g., 'Review the draft') as tasks")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.inbox.actionDetection.includeImperativePattern)
          .onChange(async (value) => {
            this.plugin.settings.inbox.actionDetection.includeImperativePattern = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(actionSection)
      .setName("Short content heuristics")
      .setDesc("Treat short lines as tasks when no other rule matches")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.inbox.actionDetection.includeShortContent)
          .onChange(async (value) => {
            this.plugin.settings.inbox.actionDetection.includeShortContent = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(actionSection)
      .setName("Short content max length")
      .setDesc("Maximum characters to treat a short line as a task")
      .addSlider((slider) =>
        slider
          .setLimits(20, 200, 5)
          .setValue(this.plugin.settings.inbox.actionDetection.shortContentMaxChars)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.inbox.actionDetection.shortContentMaxChars = value;
            await this.plugin.saveSettings();
          })
      );

    const formattingSection = this.createDetailsSection(
      containerEl,
      "Formatting",
      "Controls task and thought formatting."
    );

    new Setting(formattingSection)
      .setName("Default Due Date Offset")
      .setDesc("Days from today for task due dates (0 = today, 1 = tomorrow)")
      .addSlider((slider) =>
        slider
          .setLimits(0, 14, 1)
          .setValue(this.plugin.settings.inbox.formatting.defaultDueDateOffset)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.inbox.formatting.defaultDueDateOffset = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(formattingSection)
      .setName("Task prefix")
      .setDesc("Prefix used for tasks")
      .addText((text) =>
        text
          .setPlaceholder("- [ ]")
          .setValue(this.plugin.settings.inbox.formatting.taskPrefix)
          .onChange(async (value) => {
            this.plugin.settings.inbox.formatting.taskPrefix = value || "- [ ]";
            await this.plugin.saveSettings();
          })
      );

    new Setting(formattingSection)
      .setName("Due date marker")
      .setDesc("Marker inserted before due dates")
      .addText((text) =>
        text
          .setPlaceholder("📅")
          .setValue(this.plugin.settings.inbox.formatting.dueDateEmoji)
          .onChange(async (value) => {
            this.plugin.settings.inbox.formatting.dueDateEmoji = value || "📅";
            await this.plugin.saveSettings();
          })
      );

    new Setting(formattingSection)
      .setName("Thought timestamp format")
      .setDesc("Moment.js format used for thought timestamps")
      .addText((text) =>
        text
          .setPlaceholder("HH:mm")
          .setValue(this.plugin.settings.inbox.formatting.timeFormat)
          .onChange(async (value) => {
            this.plugin.settings.inbox.formatting.timeFormat = value || "HH:mm";
            await this.plugin.saveSettings();
          })
      );

    const summarySection = this.createDetailsSection(
      containerEl,
      "Link summaries",
      "Use the Summarize plugin to add an indented summary under captured links."
    );

    new Setting(summarySection)
      .setName("Enable link summaries")
      .setDesc("When a capture includes a URL, insert a summary using the Summarize plugin")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.inbox.contentSummary.enabled)
          .onChange(async (value) => {
            this.plugin.settings.inbox.contentSummary.enabled = value;
            await this.plugin.saveSettings();
          })
      );

    const uriSection = this.createDetailsSection(
      containerEl,
      "Capture URI",
      "Use this format in iPhone Shortcuts."
    );

    const uriValue = "obsidian://gsd-inbox?content={content}&type={type}";

    new Setting(uriSection)
      .setName("Inbox URI Format")
      .setDesc("Use this URI format in your shortcuts")
      .addText((text) => {
        text.setValue(uriValue).setDisabled(true);
        text.inputEl.style.width = "100%";
        text.inputEl.style.fontFamily = "monospace";
        text.inputEl.style.fontSize = "12px";
      })
      .addButton((button) =>
        button.setButtonText("Copy").onClick(async () => {
          try {
            await navigator.clipboard.writeText(uriValue);
            new Notice("Inbox URI copied to clipboard.");
          } catch (error) {
            console.error("[GSD] Clipboard copy failed", error);
            new Notice("Could not copy. Please copy manually.");
          }
        })
      );

    const resetSection = this.createDetailsSection(
      containerEl,
      "Reset",
      "Restore inbox settings to defaults."
    );

    new Setting(resetSection)
      .setName("Reset Inbox Settings")
      .setDesc("Reset inbox settings to defaults")
      .addButton((button) =>
        button.setButtonText("Reset Inbox").onClick(async () => {
          this.plugin.settings.inbox = this.cloneInboxSettings();
          await this.plugin.saveSettings();
          this.display();
        })
      );
  }

  private renderInboxRoutingRules(containerEl: HTMLElement): void {
    const rules = this.plugin.settings.inbox.routing.rules;

    if (!rules.length) {
      containerEl.createEl("p", {
        text: "No routing rules configured. Add one below.",
        cls: "setting-item-description",
      });
    }

    rules.forEach((rule, index) => {
      rule.match = rule.match || {};
      rule.action = rule.action || {
        destination: "daily_thoughts",
        format: "auto",
        addDueDate: true,
      };

      const details = containerEl.createEl("details", {
        cls: "gsd-routing-rule",
      });
      details.open = false;

      const summary = details.createEl("summary");
      const summaryLabel = summary.createSpan({
        text: this.formatRuleSummary(rule),
      });

      const body = details.createDiv({ cls: "gsd-routing-rule-body" });

      const updateSummary = () => {
        summaryLabel.setText(this.formatRuleSummary(rule));
      };

      new Setting(body)
        .setName("Name")
        .setDesc("Short description for this rule")
        .addText((text) =>
          text
            .setPlaceholder("Task from clipboard")
            .setValue(rule.name)
            .onChange(async (value) => {
              rule.name = value;
              updateSummary();
              await this.plugin.saveSettings();
            })
        );

      new Setting(body)
        .setName("Enabled")
        .setDesc("Turn this rule on or off")
        .addToggle((toggle) =>
          toggle.setValue(rule.enabled).onChange(async (value) => {
            rule.enabled = value;
            updateSummary();
            await this.plugin.saveSettings();
          })
        );

      new Setting(body)
        .setName("Rule actions")
        .setDesc("Order and lifecycle controls")
        .addButton((button) =>
          button.setButtonText("Move up").onClick(async () => {
            if (index === 0) return;
            const updated = [...rules];
            [updated[index - 1], updated[index]] = [updated[index], updated[index - 1]];
            this.plugin.settings.inbox.routing.rules = updated;
            await this.plugin.saveSettings();
            this.display();
          })
        )
        .addButton((button) =>
          button.setButtonText("Move down").onClick(async () => {
            if (index >= rules.length - 1) return;
            const updated = [...rules];
            [updated[index + 1], updated[index]] = [updated[index], updated[index + 1]];
            this.plugin.settings.inbox.routing.rules = updated;
            await this.plugin.saveSettings();
            this.display();
          })
        )
        .addButton((button) =>
          button.setButtonText("Duplicate").onClick(async () => {
            const clone = this.cloneRoutingRule(rule);
            this.plugin.settings.inbox.routing.rules = [
              ...rules.slice(0, index + 1),
              clone,
              ...rules.slice(index + 1),
            ];
            await this.plugin.saveSettings();
            this.display();
          })
        )
        .addButton((button) =>
          button.setButtonText("Delete").onClick(async () => {
            this.plugin.settings.inbox.routing.rules = rules.filter((_, i) => i !== index);
            await this.plugin.saveSettings();
            this.display();
          })
        );

      this.createSubsection(body, "Match", "All specified conditions must match.");

      this.createListSetting(body, {
        name: "Content types",
        desc: "Match if the incoming content type is in this list",
        value: rule.match.contentTypes || [],
        placeholder: "task\nlink\ntranscript",
        rows: 4,
        onChange: async (value) => {
          rule.match.contentTypes = this.filterContentTypes(value);
          await this.plugin.saveSettings();
        },
      });

      this.createListSetting(body, {
        name: "Content starts with",
        desc: "Case-insensitive prefixes to match",
        value: rule.match.contentStartsWith || [],
        placeholder: "- [ ]\nTODO",
        rows: 4,
        onChange: async (value) => {
          rule.match.contentStartsWith = value;
          await this.plugin.saveSettings();
        },
      });

      this.createListSetting(body, {
        name: "Content includes",
        desc: "Case-insensitive substrings to match",
        value: rule.match.contentIncludes || [],
        placeholder: "agenda\nminutes",
        rows: 4,
        onChange: async (value) => {
          rule.match.contentIncludes = value;
          await this.plugin.saveSettings();
        },
      });

      new Setting(body)
        .setName("Content regex")
        .setDesc("JavaScript regex used to match the content (use flags below for case-insensitive)")
        .addText((text) =>
          text
            .setPlaceholder("invoice|receipt")
            .setValue(rule.match.contentRegex || "")
            .onChange(async (value) => {
              rule.match.contentRegex = value.trim() || undefined;
              await this.plugin.saveSettings();
            })
        );

      new Setting(body)
        .setName("Regex flags")
        .setDesc("Regex flags (e.g., i, m, s). Leave empty for default.")
        .addText((text) =>
          text
            .setPlaceholder("i")
            .setValue(rule.match.regexFlags || "")
            .onChange(async (value) => {
              rule.match.regexFlags = value.trim() || undefined;
              await this.plugin.saveSettings();
            })
        );

      this.addTriStateDropdown(body, {
        name: "Is URL",
        desc: "Match based on whether content is a URL",
        value: rule.match.isUrl,
        onChange: async (value) => {
          rule.match.isUrl = value;
          await this.plugin.saveSettings();
        },
      });

      this.addTriStateDropdown(body, {
        name: "Has task checkbox",
        desc: "Match content that already contains the task prefix",
        value: rule.match.hasTaskCheckbox,
        onChange: async (value) => {
          rule.match.hasTaskCheckbox = value;
          await this.plugin.saveSettings();
        },
      });

      this.addTriStateDropdown(body, {
        name: "Action item",
        desc: "Match if action detection classifies it as a task",
        value: rule.match.actionItem,
        onChange: async (value) => {
          rule.match.actionItem = value;
          await this.plugin.saveSettings();
        },
      });

      this.addTriStateDropdown(body, {
        name: "In meeting",
        desc: "Match based on meeting context",
        value: rule.match.inMeeting,
        onChange: async (value) => {
          rule.match.inMeeting = value;
          await this.plugin.saveSettings();
        },
      });

      new Setting(body)
        .setName("Min length")
        .setDesc("Minimum characters required")
        .addText((text) =>
          text
            .setPlaceholder("0")
            .setValue(rule.match.minLength?.toString() || "")
            .onChange(async (value) => {
              rule.match.minLength = this.parseOptionalNumber(value);
              await this.plugin.saveSettings();
            })
        );

      new Setting(body)
        .setName("Max length")
        .setDesc("Maximum characters allowed")
        .addText((text) =>
          text
            .setPlaceholder("500")
            .setValue(rule.match.maxLength?.toString() || "")
            .onChange(async (value) => {
              rule.match.maxLength = this.parseOptionalNumber(value);
              await this.plugin.saveSettings();
            })
        );

      this.createSubsection(body, "Action", "What happens when the rule matches.");

      new Setting(body)
        .setName("Destination")
        .setDesc("Where the content is routed")
        .addDropdown((dropdown) =>
          dropdown
            .addOption("daily_thoughts", "Daily thoughts")
            .addOption("meeting_followup", "Meeting follow-up")
            .addOption("daily_end", "Daily end")
            .setValue(rule.action.destination)
            .onChange(async (value) => {
              rule.action.destination = value as InboxRouteDestination;
              await this.plugin.saveSettings();
            })
        );

      new Setting(body)
        .setName("Format")
        .setDesc("How the content is formatted")
        .addDropdown((dropdown) =>
          dropdown
            .addOption("auto", "Auto")
            .addOption("task", "Task")
            .addOption("thought", "Thought")
            .setValue(rule.action.format)
            .onChange(async (value) => {
              rule.action.format = value as InboxFormatStyle;
              await this.plugin.saveSettings();
            })
        );

      new Setting(body)
        .setName("Add due date")
        .setDesc("Add a due date when formatting as task")
        .addToggle((toggle) =>
          toggle.setValue(rule.action.addDueDate).onChange(async (value) => {
            rule.action.addDueDate = value;
            await this.plugin.saveSettings();
          })
        );

      new Setting(body)
        .setName("Due date offset")
        .setDesc("Override default due date offset for this rule")
        .addText((text) =>
          text
            .setPlaceholder("1")
            .setValue(rule.action.dueDateOffset?.toString() || "")
            .onChange(async (value) => {
              rule.action.dueDateOffset = this.parseOptionalNumber(value);
              await this.plugin.saveSettings();
            })
        );
    });

    new Setting(containerEl)
      .setName("Add routing rule")
      .setDesc("Add a new rule at the bottom of the list")
      .addButton((button) =>
        button.setButtonText("Add rule").onClick(async () => {
          this.plugin.settings.inbox.routing.rules = [
            ...this.plugin.settings.inbox.routing.rules,
            this.createDefaultRoutingRule(),
          ];
          await this.plugin.saveSettings();
          this.display();
        })
      );

    new Setting(containerEl)
      .setName("Reset routing rules")
      .setDesc("Replace routing rules with defaults")
      .addButton((button) =>
        button.setButtonText("Reset rules").onClick(async () => {
          this.plugin.settings.inbox.routing.rules = this.cloneInboxSettings().routing.rules;
          await this.plugin.saveSettings();
          this.display();
        })
      );
  }

  private renderModels(
    containerEl: HTMLElement,
    options: { includeHeader?: boolean } = {}
  ): void {
    if (options.includeHeader !== false) {
      this.createSection(containerEl, "AI Models", "Configure which models to use.");
    }

    new Setting(containerEl)
      .setName("Filter Model")
      .setDesc(
        "Model for determining if meetings need briefings (fast model recommended). Gemini: gemini-flash-latest. OpenAI: gpt-4o-mini"
      )
      .addText((text) =>
        text
          .setPlaceholder("gemini-flash-latest or gpt-4o-mini")
          .setValue(this.plugin.settings.models.filterModel)
          .onChange(async (value) => {
            this.plugin.settings.models.filterModel = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Briefing Model")
      .setDesc("Model for generating meeting briefings. Gemini: gemini-pro-latest. OpenAI: gpt-4o")
      .addText((text) =>
        text
          .setPlaceholder("gemini-pro-latest or gpt-4o")
          .setValue(this.plugin.settings.models.briefingModel)
          .onChange(async (value) => {
            this.plugin.settings.models.briefingModel = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Person Research Model")
      .setDesc("Model for researching people. Gemini: gemini-pro-latest. OpenAI: gpt-4o")
      .addText((text) =>
        text
          .setPlaceholder("gemini-pro-latest or gpt-4o")
          .setValue(this.plugin.settings.models.personResearchModel)
          .onChange(async (value) => {
            this.plugin.settings.models.personResearchModel = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Organization Research Model")
      .setDesc("Model for researching organizations. Gemini: gemini-pro-latest. OpenAI: gpt-4o")
      .addText((text) =>
        text
          .setPlaceholder("gemini-pro-latest or gpt-4o")
          .setValue(this.plugin.settings.models.orgResearchModel)
          .onChange(async (value) => {
            this.plugin.settings.models.orgResearchModel = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Phone Validation Model")
      .setDesc("Model for validating phone numbers from email signatures. Gemini: gemini-pro-latest. OpenAI: gpt-4o-mini")
      .addText((text) =>
        text
          .setPlaceholder("gemini-pro-latest or gpt-4o-mini")
          .setValue(this.plugin.settings.models.phoneValidationModel)
          .onChange(async (value) => {
            this.plugin.settings.models.phoneValidationModel = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Inbox Routing Model")
      .setDesc("Model for classifying inbox content. Gemini: gemini-flash-latest. OpenAI: gpt-4o-mini")
      .addText((text) =>
        text
          .setPlaceholder("gemini-flash-latest or gpt-4o-mini")
          .setValue(this.plugin.settings.models.inboxRoutingModel)
          .onChange(async (value) => {
            this.plugin.settings.models.inboxRoutingModel = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("O3 Prep Model")
      .setDesc("Model for drafting O3 prep. Gemini: gemini-flash-latest. OpenAI: gpt-4o-mini")
      .addText((text) =>
        text
          .setPlaceholder("gemini-flash-latest or gpt-4o-mini")
          .setValue(this.plugin.settings.models.o3PrepModel)
          .onChange(async (value) => {
            this.plugin.settings.models.o3PrepModel = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Settings Helper Model")
      .setDesc("Model used by the settings helper and prompt assistant")
      .addText((text) =>
        text
          .setPlaceholder("gemini-flash-latest or gpt-4o-mini")
          .setValue(this.plugin.settings.models.settingsHelperModel)
          .onChange(async (value) => {
            this.plugin.settings.models.settingsHelperModel = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Reset Models")
      .setDesc("Reset all models to their default values")
      .addButton((button) =>
        button.setButtonText("Reset All Models").onClick(async () => {
          this.plugin.settings.models = { ...DEFAULT_SETTINGS.models };
          await this.plugin.saveSettings();
          this.display();
        })
      );
  }

  private renderGenerationConfigs(
    containerEl: HTMLElement,
    options: { includeHeader?: boolean } = {}
  ): void {
    if (options.includeHeader !== false) {
      this.createSection(
        containerEl,
        "Generation Config",
        "Control temperature and (optional) reasoning effort per prompt."
      );
    }

    this.createGenerationConfigSetting(
      containerEl,
      "Meeting Filter",
      "YES/NO classifier (keep deterministic).",
      "meetingFilter"
    );

    this.createGenerationConfigSetting(
      containerEl,
      "Meeting Briefing",
      "Short, grounded briefing (avoid long outputs).",
      "meetingBriefing"
    );

    this.createGenerationConfigSetting(
      containerEl,
      "Person Research",
      "Deep research with web search and structured extraction.",
      "personResearch"
    );

    this.createGenerationConfigSetting(
      containerEl,
      "Organization Research",
      "Deep org research with web search.",
      "orgResearch"
    );

    this.createGenerationConfigSetting(
      containerEl,
      "Phone Validation",
      "Deterministic phone number selection / validation.",
      "phoneValidation"
    );

    this.createGenerationConfigSetting(
      containerEl,
      "Inbox Routing",
      "Fast content classification for inbox routing.",
      "inboxRouting"
    );

    this.createGenerationConfigSetting(
      containerEl,
      "Deep Research",
      "Long-form research that may use web search.",
      "research"
    );

    this.createGenerationConfigSetting(
      containerEl,
      "O3 Prep",
      "O3 synthesis output.",
      "o3Prep"
    );

    new Setting(containerEl)
      .setName("Reset Generation Config")
      .setDesc("Reset generation config values to their defaults")
      .addButton((button) =>
        button.setButtonText("Reset Generation Config").onClick(async () => {
          this.plugin.settings.generationConfigs = { ...DEFAULT_SETTINGS.generationConfigs };
          await this.plugin.saveSettings();
          this.display();
        })
      );
  }

  private renderPrompts(
    containerEl: HTMLElement,
    options: { includeHeader?: boolean } = {}
  ): void {
    if (options.includeHeader !== false) {
      this.createSection(containerEl, "Prompts", "Customize the AI prompts used for each workflow.");
    }

    this.createPromptSetting(
      containerEl,
      "Meeting Filter Prompt",
      "Determines if a meeting needs a briefing",
      "meetingFilter"
    );

    this.createPromptSetting(
      containerEl,
      "Meeting Briefing Prompt",
      "Generates the meeting briefing content",
      "meetingBriefing"
    );

    this.createPromptSetting(
      containerEl,
      "Person Research Prompt",
      "Researches people and extracts info",
      "personResearch"
    );

    this.createPromptSetting(
      containerEl,
      "Organization Research Prompt",
      "Researches organizations",
      "orgResearch"
    );

    this.createPromptSetting(
      containerEl,
      "Inbox Routing Prompt",
      "Classifies incoming content for routing",
      "inboxRouting"
    );

    this.createPromptSetting(
      containerEl,
      "Deep Research Prompt",
      "Runs long-form research when triggered",
      "research"
    );

    new Setting(containerEl)
      .setName("Reset Prompts")
      .setDesc("Reset all prompts to their default values")
      .addButton((button) =>
        button.setButtonText("Reset All Prompts").onClick(async () => {
          this.plugin.settings.prompts = { ...DEFAULT_SETTINGS.prompts };
          await this.plugin.saveSettings();
          this.display();
        })
      );
  }

  private renderPerformance(containerEl: HTMLElement): void {
    this.createSection(
      containerEl,
      "Performance",
      "Control parallel processing and rate limiting for API calls."
    );

    new Setting(containerEl)
      .setName("Parallel Briefings")
      .setDesc(
        "Number of meeting briefings to process in parallel (1-5). Higher = faster but may hit rate limits."
      )
      .addSlider((slider) =>
        slider
          .setLimits(1, 5, 1)
          .setValue(this.plugin.settings.parallelBriefings)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.parallelBriefings = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("API Delay (ms)")
      .setDesc("Minimum delay between API call batches in milliseconds.")
      .addSlider((slider) =>
        slider
          .setLimits(100, 2000, 100)
          .setValue(this.plugin.settings.apiDelayMs)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.apiDelayMs = value;
            await this.plugin.saveSettings();
          })
      );
  }

  private renderWebhook(containerEl: HTMLElement): void {
    this.createSection(
      containerEl,
      "Webhook Server",
      "HTTP server for receiving external webhooks (e.g., Amie meeting transcripts via QStash)."
    );

    new Setting(containerEl)
      .setName("Enable Webhook Server")
      .setDesc("Start an HTTP server for receiving webhooks when Obsidian loads")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.webhook.enabled)
          .onChange(async (value) => {
            this.plugin.settings.webhook.enabled = value;
            await this.plugin.saveSettings();
            if (value) {
              new Notice("Webhook server will start on next Obsidian reload");
            } else {
              new Notice("Webhook server will stop on next Obsidian reload");
            }
          })
      );

    new Setting(containerEl)
      .setName("Port")
      .setDesc("HTTP port for the webhook server (default: 3456)")
      .addText((text) =>
        text
          .setPlaceholder("3456")
          .setValue(String(this.plugin.settings.webhook.port))
          .onChange(async (value) => {
            const port = parseInt(value, 10);
            if (!isNaN(port) && port > 0 && port < 65536) {
              this.plugin.settings.webhook.port = port;
              await this.plugin.saveSettings();
            }
          })
      );

    this.addSecretSetting(containerEl, {
      name: "API Key",
      desc: "Secret key for authenticating webhook requests (required)",
      placeholder: "Enter a secure API key",
      value: this.plugin.settings.webhook.apiKey,
      onChange: async (value) => {
        this.plugin.settings.webhook.apiKey = value;
        await this.plugin.saveSettings();
      },
    });

    new Setting(containerEl)
      .setName("Bind Address")
      .setDesc("Network interface to bind to (127.0.0.1 = localhost only, 0.0.0.0 = all interfaces)")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("127.0.0.1", "127.0.0.1 (localhost only)")
          .addOption("0.0.0.0", "0.0.0.0 (all interfaces)")
          .setValue(this.plugin.settings.webhook.bindAddress)
          .onChange(async (value) => {
            this.plugin.settings.webhook.bindAddress = value as "127.0.0.1" | "0.0.0.0";
            await this.plugin.saveSettings();
          })
      );

    const serverStatus = this.plugin.webhookServer?.isRunning?.() ? "Running" : "Stopped";
    const serverPort = this.plugin.settings.webhook.port;
    new Setting(containerEl)
      .setName("Server Status")
      .setDesc(
        `Status: ${serverStatus}${serverStatus === "Running" ? ` on port ${serverPort}` : ""}`
      )
      .addButton((button) =>
        button
          .setButtonText(serverStatus === "Running" ? "Stop Server" : "Start Server")
          .onClick(async () => {
            if (this.plugin.webhookServer?.isRunning?.()) {
              this.plugin.webhookServer.stop();
              new Notice("Webhook server stopped");
            } else {
              if (!this.plugin.settings.webhook.apiKey) {
                new Notice("Please set an API key first");
                return;
              }
              await this.plugin.webhookServer?.start();
              new Notice(`Webhook server started on port ${this.plugin.settings.webhook.port}`);
            }
            this.display();
          })
      );
  }

  private renderLlmCouncil(containerEl: HTMLElement): void {
    this.createSection(
      containerEl,
      "LLM Council",
      "Configure the LLM Council feature for multi-perspective problem solving."
    );

    new Setting(containerEl)
      .setName("Enable LLM Council")
      .setDesc("Enable the LLM Council feature")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.llmCouncil.enabled)
          .onChange(async (value) => {
            this.plugin.settings.llmCouncil.enabled = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Runs Directory")
      .setDesc("Directory where council run outputs are stored")
      .addText((text) =>
        text
          .setPlaceholder("Z_Settings & Tools/llm_council/runs")
          .setValue(this.plugin.settings.llmCouncil.runsPath)
          .onChange(async (value) => {
            this.plugin.settings.llmCouncil.runsPath = value;
            await this.plugin.saveSettings();
          })
      );

    this.createSection(
      containerEl,
      "Models",
      "Use shared models for ideators and executors, then override if needed."
    );

    let ideatorModel = this.plugin.settings.llmCouncil.ideatorModels.feynman || "";
    const ideatorSetting = new Setting(containerEl)
      .setName("Ideator model (all)")
      .setDesc("Apply this model to all ideators");
    ideatorSetting.addText((text) =>
      text
        .setPlaceholder("gemini-pro-latest or gpt-4o")
        .setValue(ideatorModel)
        .onChange((value) => {
          ideatorModel = value.trim();
        })
    );
    ideatorSetting.addButton((button) =>
      button.setButtonText("Apply").onClick(async () => {
        if (!ideatorModel) {
          new Notice("Enter a model name first.");
          return;
        }
        this.plugin.settings.llmCouncil.ideatorModels = {
          feynman: ideatorModel,
          taleb: ideatorModel,
          daVinci: ideatorModel,
          fuller: ideatorModel,
        };
        await this.plugin.saveSettings();
        this.display();
      })
    );

    let executorModel = this.plugin.settings.llmCouncil.executorModels.executor1 || "";
    const executorSetting = new Setting(containerEl)
      .setName("Executor model (all)")
      .setDesc("Apply this model to all executors");
    executorSetting.addText((text) =>
      text
        .setPlaceholder("gpt-4o, claude-3, gemini-pro-latest")
        .setValue(executorModel)
        .onChange((value) => {
          executorModel = value.trim();
        })
    );
    executorSetting.addButton((button) =>
      button.setButtonText("Apply").onClick(async () => {
        if (!executorModel) {
          new Notice("Enter a model name first.");
          return;
        }
        this.plugin.settings.llmCouncil.executorModels = {
          executor1: executorModel,
          executor2: executorModel,
          executor3: executorModel,
        };
        await this.plugin.saveSettings();
        this.display();
      })
    );

    new Setting(containerEl)
      .setName("Judge Model")
      .setDesc("Model for the judge (default: Claude Opus 4.5)")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.llmCouncil.judgeModel)
          .onChange(async (value) => {
            this.plugin.settings.llmCouncil.judgeModel = value;
            await this.plugin.saveSettings();
          })
      );

    const promptSection = this.createDetailsSection(
      containerEl,
      "Prompt files (advanced)",
      "Prompt file paths used by the council."
    );

    new Setting(promptSection)
      .setName("Feynman Ideator Prompt")
      .setDesc("Path to Richard Feynman ideator prompt file")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.llmCouncil.prompts.ideators.feynman)
          .onChange(async (value) => {
            this.plugin.settings.llmCouncil.prompts.ideators.feynman = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(promptSection)
      .setName("Taleb Ideator Prompt")
      .setDesc("Path to Nassim Taleb ideator prompt file")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.llmCouncil.prompts.ideators.taleb)
          .onChange(async (value) => {
            this.plugin.settings.llmCouncil.prompts.ideators.taleb = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(promptSection)
      .setName("da Vinci Ideator Prompt")
      .setDesc("Path to Leonardo da Vinci ideator prompt file")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.llmCouncil.prompts.ideators.daVinci)
          .onChange(async (value) => {
            this.plugin.settings.llmCouncil.prompts.ideators.daVinci = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(promptSection)
      .setName("Fuller Ideator Prompt")
      .setDesc("Path to Buckminster Fuller ideator prompt file")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.llmCouncil.prompts.ideators.fuller)
          .onChange(async (value) => {
            this.plugin.settings.llmCouncil.prompts.ideators.fuller = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(promptSection)
      .setName("Executor Prompt")
      .setDesc("Path to executor prompt file")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.llmCouncil.prompts.executor)
          .onChange(async (value) => {
            this.plugin.settings.llmCouncil.prompts.executor = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(promptSection)
      .setName("Judge Prompt")
      .setDesc("Path to judge prompt file")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.llmCouncil.prompts.judge)
          .onChange(async (value) => {
            this.plugin.settings.llmCouncil.prompts.judge = value;
            await this.plugin.saveSettings();
          })
      );

    const modelDetails = this.createDetailsSection(
      containerEl,
      "Per-person models (advanced)",
      "Override specific ideators or executors."
    );

    new Setting(modelDetails)
      .setName("Feynman Model")
      .setDesc("Model for Richard Feynman ideator")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.llmCouncil.ideatorModels.feynman)
          .onChange(async (value) => {
            this.plugin.settings.llmCouncil.ideatorModels.feynman = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(modelDetails)
      .setName("Taleb Model")
      .setDesc("Model for Nassim Taleb ideator")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.llmCouncil.ideatorModels.taleb)
          .onChange(async (value) => {
            this.plugin.settings.llmCouncil.ideatorModels.taleb = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(modelDetails)
      .setName("da Vinci Model")
      .setDesc("Model for Leonardo da Vinci ideator")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.llmCouncil.ideatorModels.daVinci)
          .onChange(async (value) => {
            this.plugin.settings.llmCouncil.ideatorModels.daVinci = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(modelDetails)
      .setName("Fuller Model")
      .setDesc("Model for Buckminster Fuller ideator")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.llmCouncil.ideatorModels.fuller)
          .onChange(async (value) => {
            this.plugin.settings.llmCouncil.ideatorModels.fuller = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(modelDetails)
      .setName("Executor 1 Model")
      .setDesc("Model for first executor (default: Gemini)")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.llmCouncil.executorModels.executor1)
          .onChange(async (value) => {
            this.plugin.settings.llmCouncil.executorModels.executor1 = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(modelDetails)
      .setName("Executor 2 Model")
      .setDesc("Model for second executor (default: Claude Opus 4.5)")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.llmCouncil.executorModels.executor2)
          .onChange(async (value) => {
            this.plugin.settings.llmCouncil.executorModels.executor2 = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(modelDetails)
      .setName("Executor 3 Model")
      .setDesc("Model for third executor (default: GPT-5.2)")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.llmCouncil.executorModels.executor3)
          .onChange(async (value) => {
            this.plugin.settings.llmCouncil.executorModels.executor3 = value;
            await this.plugin.saveSettings();
          })
      );

    const configSection = this.createDetailsSection(
      containerEl,
      "Generation config (advanced)",
      "Temperature and thinking budget per phase."
    );

    this.createCouncilGenerationConfigSetting(
      configSection,
      "Ideation",
      "Temperature and thinking budget for ideators",
      "ideation"
    );

    this.createCouncilGenerationConfigSetting(
      configSection,
      "Execution",
      "Temperature and thinking budget for executors",
      "execution"
    );

    this.createCouncilGenerationConfigSetting(
      configSection,
      "Judgment",
      "Temperature and thinking budget for judge",
      "judgment"
    );
  }

  private renderDiagnostics(containerEl: HTMLElement): void {
    this.createSection(
      containerEl,
      "Diagnostics",
      "Tools to verify Apps Script access to Google Drive attachments (Docs/Sheets/etc)."
    );

    let driveUrlOrId = "";
    const driveTestSetting = new Setting(containerEl)
      .setName("Test Google Drive access")
      .setDesc("Paste a Google Drive URL or fileId, then click Test access.");

    driveTestSetting.addText((text) =>
      text
        .setPlaceholder("https://docs.google.com/... or fileId")
        .onChange((value) => {
          driveUrlOrId = value;
        })
    );

    driveTestSetting.addButton((button) =>
      button.setButtonText("Test access").onClick(async () => {
        if (!this.plugin.settings.appsScriptUrl) {
          new Notice("Set Apps Script URL first (GetShitDone settings → API & Integration).");
          return;
        }

        const google = new GoogleServices(this.plugin.settings);
        const fileId = google.extractDriveFileId(driveUrlOrId);

        if (!fileId) {
          new Notice("Could not extract a Google Drive fileId from the input.");
          return;
        }

        new Notice("Testing Google Drive access…");

        const text = await google.getDocContent(fileId);
        if (!text) {
          new Notice(`Drive access FAILED (fileId=${fileId}).`);
          return;
        }

        if (text.startsWith("[Error reading doc:")) {
          new Notice(`Drive access FAILED (fileId=${fileId}): ${text}`);
          return;
        }

        const chars = text.length;
        const truncationHint = text.includes("[truncated]")
          ? " (Apps Script truncated output)"
          : "";

        if (text.startsWith("[File type")) {
          new Notice(
            `Drive access OK but not extractable as text (fileId=${fileId}, chars=${chars})${truncationHint}`
          );
          return;
        }

        new Notice(`Drive access OK (fileId=${fileId}, chars=${chars})${truncationHint}`);
      })
    );
  }

  private createSection(containerEl: HTMLElement, title: string, desc?: string): void {
    containerEl.createEl("h2", { text: title });
    if (desc) {
      containerEl.createEl("p", { text: desc, cls: "setting-item-description" });
    }
  }

  private createSubsection(containerEl: HTMLElement, title: string, desc?: string): void {
    containerEl.createEl("h3", { text: title });
    if (desc) {
      containerEl.createEl("p", { text: desc, cls: "setting-item-description" });
    }
  }

  private createDetailsSection(
    containerEl: HTMLElement,
    title: string,
    desc?: string,
    open = false
  ): HTMLElement {
    const details = containerEl.createEl("details", { cls: "gsd-settings-details" });
    details.open = open;
    details.createEl("summary", { text: title });
    const body = details.createDiv({ cls: "gsd-settings-details-body" });
    if (desc) {
      body.createEl("p", { text: desc, cls: "setting-item-description" });
    }
    return body;
  }

  private parseList(value: string): string[] {
    return value
      .split(/\n|,/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  private formatList(value: string[]): string {
    return value.join("\n");
  }

  private createListSetting(
    containerEl: HTMLElement,
    options: {
      name: string;
      desc?: string;
      value: string[];
      placeholder?: string;
      rows?: number;
      helper?: {
        title: string;
        context: string;
        defaultQuestion?: string;
      };
      onChange: (value: string[]) => Promise<void>;
    }
  ): void {
    const setting = new Setting(containerEl).setName(options.name).setDesc(options.desc || "");
    let textArea: TextAreaComponent | null = null;

    setting.addTextArea((text) => {
      textArea = text;
      text
        .setValue(this.formatList(options.value))
        .onChange(async (value) => {
          await options.onChange(this.parseList(value));
        });
      text.inputEl.rows = options.rows ?? 4;
      text.inputEl.style.width = "100%";
      text.inputEl.style.fontFamily = "monospace";
      text.inputEl.style.fontSize = "12px";
      if (options.placeholder) {
        text.setPlaceholder(options.placeholder);
      }
    });

    if (options.helper) {
      setting.addButton((button) =>
        button.setButtonText("Ask AI").onClick(() => {
          if (!textArea) return;
          this.openSettingsHelperModal({
            title: options.helper.title,
            context: options.helper.context,
            currentValue: textArea.getValue(),
            defaultQuestion: options.helper.defaultQuestion,
            model: this.getSettingsHelperModel(),
            aiService: this.plugin.getAIService(),
            onReplace: async (value) => {
              const parsed = this.parseList(value);
              textArea?.setValue(this.formatList(parsed));
              await options.onChange(parsed);
            },
            onAppend: async (value) => {
              const parsed = this.parseList(value);
              const merged = [...this.parseList(textArea?.getValue() || ""), ...parsed];
              textArea?.setValue(this.formatList(merged));
              await options.onChange(merged);
            },
          });
        })
      );
    }
  }

  private addSecretSetting(
    containerEl: HTMLElement,
    options: {
      name: string;
      desc?: string;
      placeholder?: string;
      value: string;
      onChange: (value: string) => Promise<void>;
    }
  ): void {
    const setting = new Setting(containerEl)
      .setName(options.name)
      .setDesc(options.desc || "");

    let textComponent: { inputEl: HTMLInputElement } | null = null;
    let hidden = true;

    setting.addText((text) => {
      textComponent = text;
      text
        .setPlaceholder(options.placeholder || "")
        .setValue(options.value || "")
        .onChange(async (value) => {
          await options.onChange(value);
        });
      text.inputEl.type = "password";
    });

    setting.addExtraButton((button) =>
      button.setIcon("eye").setTooltip("Show/Hide").onClick(() => {
        hidden = !hidden;
        if (textComponent) {
          textComponent.inputEl.type = hidden ? "password" : "text";
        }
      })
    );
  }

  private addTriStateDropdown(
    containerEl: HTMLElement,
    options: {
      name: string;
      desc?: string;
      value?: boolean;
      onChange: (value: boolean | undefined) => Promise<void>;
    }
  ): void {
    new Setting(containerEl)
      .setName(options.name)
      .setDesc(options.desc || "")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("any", "Any")
          .addOption("true", "Yes")
          .addOption("false", "No")
          .setValue(options.value === undefined ? "any" : options.value ? "true" : "false")
          .onChange(async (value) => {
            if (value === "any") {
              await options.onChange(undefined);
            } else {
              await options.onChange(value === "true");
            }
          })
      );
  }

  private formatRuleSummary(rule: InboxRoutingRule): string {
    const status = rule.enabled ? "●" : "○";
    return `${status} ${rule.name || "Untitled rule"}`;
  }

  private filterContentTypes(value: string[]): InboxContentType[] {
    const allowed: InboxContentType[] = [
      "task",
      "thought",
      "link",
      "transcript",
      "screenshot",
      "unknown",
    ];
    return value
      .map((item) => item.toLowerCase() as InboxContentType)
      .filter((item) => allowed.includes(item));
  }

  private parseOptionalNumber(value: string): number | undefined {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const parsed = parseInt(trimmed, 10);
    return Number.isNaN(parsed) ? undefined : parsed;
  }

  private createDefaultRoutingRule(): InboxRoutingRule {
    return {
      id: this.createRuleId(),
      name: "New rule",
      enabled: true,
      match: {},
      action: {
        destination: "daily_thoughts",
        format: "auto",
        addDueDate: true,
      },
    };
  }

  private cloneRoutingRule(rule: InboxRoutingRule): InboxRoutingRule {
    return {
      ...rule,
      id: this.createRuleId(),
      name: `${rule.name || "Rule"} (copy)`,
      match: { ...rule.match },
      action: { ...rule.action },
    };
  }

  private createRuleId(): string {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
    return `rule-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  }

  private getSettingsHelperModel(): string {
    return (
      this.plugin.settings.models.settingsHelperModel ||
      this.plugin.settings.models.inboxRoutingModel ||
      this.plugin.settings.models.briefingModel
    );
  }

  private canUseModel(model: string): boolean {
    const lower = model.toLowerCase();
    if (this.isOpenRouterModel(lower)) {
      return Boolean(this.plugin.settings.openrouterApiKey);
    }
    if (lower.startsWith("claude-")) {
      return Boolean(this.plugin.settings.anthropicApiKey);
    }
    if (lower.startsWith("gpt-") || lower.startsWith("o1-") || lower.startsWith("o3-")) {
      return Boolean(this.plugin.settings.openaiApiKey);
    }
    return Boolean(this.plugin.settings.geminiApiKey);
  }

  private isOpenRouterModel(modelLower: string): boolean {
    if (modelLower.startsWith("openrouter:")) {
      return true;
    }
    if (modelLower.includes("/")) {
      return true;
    }
    if (this.plugin.settings.openrouter?.selectedModels?.length) {
      return this.plugin.settings.openrouter.selectedModels.some(
        (id) => id.toLowerCase() === modelLower
      );
    }
    return false;
  }

  private openSettingsHelperModal(options: Omit<SettingsHelperOptions, "model" | "aiService"> & {
    model?: string;
    aiService?: AIService;
  }): void {
    const model = options.model || this.getSettingsHelperModel();
    const aiService = options.aiService || this.plugin.getAIService();

    if (!model) {
      new Notice("No model configured for the settings helper.");
      return;
    }

    if (!this.canUseModel(model)) {
      new Notice("Missing API key for the selected settings helper model.");
      return;
    }

    new SettingsHelperModal(this.app, {
      title: options.title,
      context: options.context,
      currentValue: options.currentValue,
      defaultQuestion: options.defaultQuestion,
      model,
      aiService,
      onReplace: options.onReplace,
      onAppend: options.onAppend,
    }).open();
  }

  private cloneInboxSettings(): PluginSettings["inbox"] {
    if (typeof structuredClone !== "undefined") {
      return structuredClone(DEFAULT_SETTINGS.inbox);
    }
    return JSON.parse(JSON.stringify(DEFAULT_SETTINGS.inbox)) as PluginSettings["inbox"];
  }

  private createPromptSetting(
    containerEl: HTMLElement,
    name: string,
    desc: string,
    key: keyof PluginSettings["prompts"]
  ): void {
    const setting = new Setting(containerEl)
      .setName(name)
      .setDesc(desc)
      .setClass("gsd-prompt-setting");

    let textArea: TextAreaComponent | null = null;

    setting.addTextArea((text) => {
      textArea = text;
      text
        .setValue(this.plugin.settings.prompts[key])
        .onChange(async (value) => {
          this.plugin.settings.prompts[key] = value;
          await this.plugin.saveSettings();
        });
      text.inputEl.rows = 10;
      text.inputEl.cols = 60;
      text.inputEl.style.width = "100%";
      text.inputEl.style.fontFamily = "monospace";
      text.inputEl.style.fontSize = "12px";
    });

    new Setting(containerEl)
      .setName(`${name} helper`)
      .setDesc("Ask AI to refine or rewrite this prompt")
      .addButton((button) =>
        button.setButtonText("Prompt helper").onClick(() => {
          if (!textArea) return;
          this.openSettingsHelperModal({
            title: `${name} helper`,
            context: `Prompt: ${name}\n${desc}`,
            currentValue: textArea.getValue(),
            defaultQuestion:
              "Improve this prompt for clarity and reliability. Return only the revised prompt.",
            model: this.getSettingsHelperModel(),
            aiService: this.plugin.getAIService(),
            onReplace: async (value) => {
              textArea?.setValue(value);
              this.plugin.settings.prompts[key] = value;
              await this.plugin.saveSettings();
            },
          });
        })
      );
  }

  private createGenerationConfigSetting(
    containerEl: HTMLElement,
    name: string,
    desc: string,
    key: keyof PluginSettings["generationConfigs"]
  ): void {
    const cfg = this.plugin.settings.generationConfigs[key];

    const setting = new Setting(containerEl).setName(name).setDesc(desc);

    setting.addSlider((slider) =>
      slider
        .setLimits(0, 1, 0.05)
        .setValue(cfg.temperature ?? 0.2)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.generationConfigs[key].temperature = value;
          await this.plugin.saveSettings();
        })
    );

    setting.addDropdown((dropdown) =>
      dropdown
        .addOption("", "Off")
        .addOption("low", "Low")
        .addOption("medium", "Medium")
        .addOption("high", "High")
        .setValue(cfg.thinkingBudget == null ? "" : cfg.thinkingBudget)
        .onChange(async (value) => {
          if (!value) {
            this.plugin.settings.generationConfigs[key].thinkingBudget = null;
          } else {
            this.plugin.settings.generationConfigs[key].thinkingBudget = value as
              | "low"
              | "medium"
              | "high";
          }
          await this.plugin.saveSettings();
        })
    );
  }

  private createCouncilGenerationConfigSetting(
    containerEl: HTMLElement,
    name: string,
    desc: string,
    key: keyof PluginSettings["llmCouncil"]["generationConfig"]
  ): void {
    const cfg = this.plugin.settings.llmCouncil.generationConfig[key];

    const setting = new Setting(containerEl).setName(name).setDesc(desc);

    setting.addSlider((slider) =>
      slider
        .setLimits(0, 1, 0.05)
        .setValue(cfg.temperature ?? 0.2)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.llmCouncil.generationConfig[key].temperature = value;
          await this.plugin.saveSettings();
        })
    );

    setting.addDropdown((dropdown) =>
      dropdown
        .addOption("", "Off")
        .addOption("low", "Low")
        .addOption("medium", "Medium")
        .addOption("high", "High")
        .setValue(cfg.thinkingBudget == null ? "" : cfg.thinkingBudget)
        .onChange(async (value) => {
          if (!value) {
            this.plugin.settings.llmCouncil.generationConfig[key].thinkingBudget = null;
          } else {
            this.plugin.settings.llmCouncil.generationConfig[key].thinkingBudget = value as
              | "low"
              | "medium"
              | "high";
          }
          await this.plugin.saveSettings();
        })
    );
  }
}

class SettingsHelperModal extends Modal {
  private options: SettingsHelperOptions;
  private responseText = "";

  constructor(app: App, options: SettingsHelperOptions) {
    super(app);
    this.options = options;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: this.options.title });

    if (this.options.context) {
      contentEl.createEl("p", {
        text: this.options.context,
        cls: "setting-item-description",
      });
    }

    const question = contentEl.createEl("textarea", { cls: "gsd-helper-question" });
    question.rows = 4;
    question.style.width = "100%";
    question.style.fontFamily = "monospace";
    question.style.fontSize = "12px";
    question.value = this.options.defaultQuestion || "";

    const response = contentEl.createEl("textarea", { cls: "gsd-helper-response" });
    response.rows = 8;
    response.style.width = "100%";
    response.style.fontFamily = "monospace";
    response.style.fontSize = "12px";
    response.readOnly = true;

    const actions = new Setting(contentEl);
    actions.addButton((button) =>
      button.setButtonText("Ask AI").setCta().onClick(async () => {
        const questionText = question.value.trim();
        if (!questionText) {
          new Notice("Ask a question first.");
          return;
        }

        response.value = "Thinking...";
        const system =
          "You are a configuration assistant for the GetShitDone plugin. Be concise, practical, and structured.";
        const user = `Setting context:\n${this.options.context}\n\nCurrent value:\n${
          this.options.currentValue || "(empty)"
        }\n\nQuestion:\n${questionText}\n\nReturn plain text only.`;

        const result = await this.options.aiService.callModel(system, user, this.options.model, {
          useSearch: false,
          temperature: 0.2,
          thinkingBudget: "low",
        });

        if (!result) {
          response.value = "(No response from model)";
          return;
        }

        this.responseText = result.trim();
        response.value = this.responseText;
      })
    );

    const apply = new Setting(contentEl);
    if (this.options.onReplace) {
      apply.addButton((button) =>
        button.setButtonText("Replace with response").onClick(async () => {
          if (!this.responseText) {
            new Notice("Ask AI first so there is a response to apply.");
            return;
          }
          await this.options.onReplace?.(this.responseText);
          this.close();
        })
      );
    }

    if (this.options.onAppend) {
      apply.addButton((button) =>
        button.setButtonText("Append response").onClick(async () => {
          if (!this.responseText) {
            new Notice("Ask AI first so there is a response to apply.");
            return;
          }
          await this.options.onAppend?.(this.responseText);
          this.close();
        })
      );
    }
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}
