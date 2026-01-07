// ============================================================================
// OpenRouter Tab - Model browser, benchmarks, and ranking
// ============================================================================

import { Notice, requestUrl, RequestUrlResponse } from "obsidian";
import type GetShitDonePlugin from "../main";
import type { OpenRouterModel } from "../types";
import { createSection } from "./helpers";
import {
  fetchArenaScores,
  matchArenaScore,
  fetchOpenLlmScore,
  type BenchmarkState,
} from "./openrouter-benchmarks";

// ============================================================================
// Types
// ============================================================================

export type OpenRouterSortKey = "name" | "provider" | "context" | "cost" | "arena" | "openllm" | "value";

export interface OpenRouterTabState extends BenchmarkState {
  search: string;
  providerFilter: string;
  freeOnly: boolean;
  selectedOnly: boolean;
  sort: OpenRouterSortKey;
  sortDirection: "asc" | "desc";
  searchFocus: { start: number; end: number } | null;
}

export function createOpenRouterTabState(): OpenRouterTabState {
  return {
    search: "",
    providerFilter: "all",
    freeOnly: false,
    selectedOnly: false,
    sort: "name",
    sortDirection: "asc",
    searchFocus: null,
    openLlmOrgIndex: new Map(),
    openLlmLastRequestAt: 0,
    openLlmBackoffUntil: 0,
  };
}

// ============================================================================
// Public API
// ============================================================================

export async function renderOpenRouterTab(
  containerEl: HTMLElement,
  plugin: GetShitDonePlugin,
  state: OpenRouterTabState,
  onRefresh: () => void
): Promise<void> {
  containerEl.createEl("p", {
    text: "Browse and select OpenRouter models, then use their IDs in your workflow model fields.",
    cls: "setting-item-description",
  });

  if (!plugin.settings.openrouterApiKey) {
    containerEl.createEl("p", {
      text: "Add an OpenRouter API key in the API & Integration tab to enable requests.",
      cls: "setting-item-description",
    });
  }

  renderToolbar(containerEl, plugin, state, onRefresh);

  const models = plugin.settings.openrouter.modelCache;
  if (!models.length) {
    containerEl.createEl("p", {
      text: "No models cached yet. Click \"Refresh models\" to load the latest list.",
      cls: "setting-item-description",
    });
    return;
  }

  renderFilters(containerEl, plugin, state, models, onRefresh);
  renderModelTable(containerEl, plugin, state, onRefresh);
  renderOpenRouterFreeRank(containerEl, plugin, models, onRefresh);
}

// ============================================================================
// UI Components
// ============================================================================

function renderToolbar(
  containerEl: HTMLElement,
  plugin: GetShitDonePlugin,
  state: OpenRouterTabState,
  onRefresh: () => void
): void {
  const header = containerEl.createDiv({ cls: "gsd-openrouter-toolbar" });

  const refreshButton = header.createEl("button", { text: "Refresh models" });
  refreshButton.addEventListener("click", async () => {
    refreshButton.setAttr("disabled", "true");
    await fetchOpenRouterModels(plugin, true);
    onRefresh();
  });

  const benchButton = header.createEl("button", { text: "Fetch benchmarks (visible)" });
  benchButton.addEventListener("click", async () => {
    benchButton.setAttr("disabled", "true");
    const visibleModels = getOpenRouterVisibleModels(plugin, state);
    await fetchOpenRouterBenchmarks(plugin, state, visibleModels);
    onRefresh();
  });

  const benchSelectedButton = header.createEl("button", { text: "Fetch benchmarks (selected)" });
  benchSelectedButton.addEventListener("click", async () => {
    benchSelectedButton.setAttr("disabled", "true");
    const selectedModels = getOpenRouterSelectedModels(plugin);
    if (!selectedModels.length) {
      new Notice("No OpenRouter models selected.");
      benchSelectedButton.removeAttribute("disabled");
      return;
    }
    await fetchOpenRouterBenchmarks(plugin, state, selectedModels);
    onRefresh();
  });

  const lastFetched = plugin.settings.openrouter.lastFetched;
  const lastFetchedText = lastFetched
    ? `Last sync: ${new Date(lastFetched).toLocaleString()}`
    : "No model cache yet";
  header.createEl("span", { text: lastFetchedText, cls: "gsd-openrouter-meta" });

  const benchFetched = plugin.settings.openrouter.benchmarks?.lastFetched ?? null;
  const benchFetchedText = benchFetched
    ? `Benchmarks: ${new Date(benchFetched).toLocaleString()}`
    : "Benchmarks: not fetched";
  header.createEl("span", { text: benchFetchedText, cls: "gsd-openrouter-meta" });
}

function renderFilters(
  containerEl: HTMLElement,
  plugin: GetShitDonePlugin,
  state: OpenRouterTabState,
  models: OpenRouterModel[],
  onRefresh: () => void
): void {
  const providers = Array.from(
    new Set(models.map((model) => getOpenRouterProvider(model)))
  ).sort((a, b) => a.localeCompare(b));
  if (state.providerFilter !== "all" && !providers.includes(state.providerFilter)) {
    state.providerFilter = "all";
  }

  const filters = containerEl.createDiv({ cls: "gsd-openrouter-toolbar" });

  const searchInput = filters.createEl("input", {
    type: "text",
    placeholder: "Search models...",
  });
  searchInput.value = state.search;
  searchInput.addEventListener("input", () => {
    state.search = searchInput.value;
    state.searchFocus = {
      start: searchInput.selectionStart ?? state.search.length,
      end: searchInput.selectionEnd ?? state.search.length,
    };
    onRefresh();
  });
  if (state.searchFocus) {
    const { start, end } = state.searchFocus;
    state.searchFocus = null;
    searchInput.focus();
    try {
      searchInput.setSelectionRange(start, end);
    } catch {
      // Ignore selection errors
    }
  }

  const providerSelect = filters.createEl("select");
  providerSelect.createEl("option", { text: "All providers", value: "all" });
  providers.forEach((provider) => {
    providerSelect.createEl("option", { text: provider, value: provider });
  });
  providerSelect.value = state.providerFilter;
  providerSelect.addEventListener("change", () => {
    state.providerFilter = providerSelect.value;
    onRefresh();
  });

  const freeToggleLabel = filters.createEl("label");
  const freeToggle = freeToggleLabel.createEl("input", { type: "checkbox" });
  freeToggle.checked = state.freeOnly;
  freeToggle.addEventListener("change", () => {
    state.freeOnly = freeToggle.checked;
    onRefresh();
  });
  freeToggleLabel.appendText(" Free only");

  const selectedToggleLabel = filters.createEl("label");
  const selectedToggle = selectedToggleLabel.createEl("input", { type: "checkbox" });
  selectedToggle.checked = state.selectedOnly;
  selectedToggle.addEventListener("change", () => {
    state.selectedOnly = selectedToggle.checked;
    onRefresh();
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
  sortSelect.value = state.sort;
  sortSelect.addEventListener("change", () => {
    state.sort = sortSelect.value as OpenRouterSortKey;
    onRefresh();
  });

  const sortDirectionButton = filters.createEl("button", {
    text: state.sortDirection === "asc" ? "Asc" : "Desc",
  });
  sortDirectionButton.addEventListener("click", () => {
    state.sortDirection = state.sortDirection === "asc" ? "desc" : "asc";
    onRefresh();
  });
}

function renderModelTable(
  containerEl: HTMLElement,
  plugin: GetShitDonePlugin,
  state: OpenRouterTabState,
  onRefresh: () => void
): void {
  const models = plugin.settings.openrouter.modelCache;
  const selectedSet = new Set(
    plugin.settings.openrouter.selectedModels.map((id) => id.toLowerCase())
  );
  const filtered = getOpenRouterVisibleModels(plugin, state);

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
    const row = tbody.createEl("tr", { cls: isSelected ? "is-selected" : undefined });

    const selectCell = row.createEl("td");
    const selectBox = selectCell.createEl("input", { type: "checkbox" });
    selectBox.checked = isSelected;
    selectBox.addEventListener("change", async () => {
      toggleOpenRouterSelection(plugin, model.id, selectBox.checked);
      await plugin.saveSettings();
      onRefresh();
    });

    const modelCell = row.createEl("td");
    const metaWrap = modelCell.createDiv({ cls: "gsd-openrouter-table-meta" });
    metaWrap.createDiv({ text: model.name || model.id, cls: "gsd-openrouter-row-title" });
    metaWrap.createDiv({ text: model.id, cls: "gsd-openrouter-row-id" });

    row.createEl("td", { text: getOpenRouterProvider(model) });
    row.createEl("td", { text: `${model.context_length.toLocaleString()} tokens` });
    row.createEl("td", { text: formatOpenRouterPricing(model) });
    row.createEl("td", { text: formatOpenRouterBenchmark(plugin, model) });
    row.createEl("td", { text: formatOpenRouterValue(plugin, model) });
    row.createEl("td", { text: model.supported_parameters?.includes("tools") ? "Yes" : "No" });

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

    if (isOpenRouterFreeModel(model)) {
      const rankButton = actions.createEl("button", { text: "Rank" });
      rankButton.addEventListener("click", async () => {
        toggleOpenRouterSelection(plugin, model.id, true);
        addFreeRankModel(plugin, model.id);
        await plugin.saveSettings();
        onRefresh();
      });
    }
  });
}

function renderOpenRouterFreeRank(
  containerEl: HTMLElement,
  plugin: GetShitDonePlugin,
  models: OpenRouterModel[],
  onRefresh: () => void
): void {
  createSection(
    containerEl,
    "Free model fallback (auto-free)",
    "Set the priority order for free OpenRouter models. Use model ID \"openrouter:auto-free\" to always pick the highest-ranked model that is not rate limited."
  );

  const modelsById = new Map(models.map((model) => [model.id, model]));

  const actions = containerEl.createDiv({ cls: "gsd-openrouter-toolbar" });
  const seedButton = actions.createEl("button", { text: "Seed from selected free models" });
  seedButton.addEventListener("click", async () => {
    const selectedFree = plugin.settings.openrouter.selectedModels.filter((id) => {
      const model = modelsById.get(id);
      return model ? isOpenRouterFreeModel(model) : false;
    });
    plugin.settings.openrouter.freeModelRank = Array.from(new Set(selectedFree));
    await plugin.saveSettings();
    onRefresh();
  });

  const clearButton = actions.createEl("button", { text: "Clear ranking" });
  clearButton.addEventListener("click", async () => {
    plugin.settings.openrouter.freeModelRank = [];
    await plugin.saveSettings();
    onRefresh();
  });

  const rankList = containerEl.createDiv({ cls: "gsd-openrouter-rank-list" });
  let dragId: string | null = null;

  const renderList = () => {
    rankList.empty();
    const ranked = plugin.settings.openrouter.freeModelRank;
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
        plugin.settings.openrouter.freeModelRank = plugin.settings.openrouter.freeModelRank.filter(
          (id) => id !== modelId
        );
        await plugin.saveSettings();
        renderList();
      });

      row.addEventListener("dragstart", () => { dragId = modelId; row.addClass("is-dragging"); });
      row.addEventListener("dragend", () => { dragId = null; row.removeClass("is-dragging"); });
      row.addEventListener("dragover", (e) => { e.preventDefault(); row.addClass("is-drop-target"); });
      row.addEventListener("dragleave", () => { row.removeClass("is-drop-target"); });
      row.addEventListener("drop", async (e) => {
        e.preventDefault();
        row.removeClass("is-drop-target");
        if (!dragId || dragId === modelId) return;

        const current = [...plugin.settings.openrouter.freeModelRank];
        const fromIndex = current.indexOf(dragId);
        const toIndex = current.indexOf(modelId);
        if (fromIndex === -1 || toIndex === -1) return;

        current.splice(fromIndex, 1);
        current.splice(toIndex, 0, dragId);
        plugin.settings.openrouter.freeModelRank = current;
        await plugin.saveSettings();
        renderList();
      });
    });
  };

  renderList();
}

// ============================================================================
// Model Fetching
// ============================================================================

export async function fetchOpenRouterModels(
  plugin: GetShitDonePlugin,
  force: boolean
): Promise<OpenRouterModel[]> {
  if (!force && plugin.settings.openrouter.modelCache.length > 0) {
    return plugin.settings.openrouter.modelCache;
  }

  try {
    const response = await requestUrl({
      url: "https://openrouter.ai/api/v1/models",
      method: "GET",
      headers: { "Content-Type": "application/json" },
    }) as RequestUrlResponse;

    if (response.status !== 200) {
      new Notice(`OpenRouter models request failed (HTTP ${response.status}).`);
      return plugin.settings.openrouter.modelCache;
    }

    const payload = response.json as { data?: Array<Record<string, unknown>> };
    if (!payload?.data || !Array.isArray(payload.data)) {
      new Notice("OpenRouter returned an unexpected payload.");
      return plugin.settings.openrouter.modelCache;
    }

    const normalized = payload.data
      .map((raw) => normalizeOpenRouterModel(raw))
      .filter((model): model is OpenRouterModel => Boolean(model));

    plugin.settings.openrouter.modelCache = normalized;
    plugin.settings.openrouter.lastFetched = new Date().toISOString();
    await plugin.saveSettings();
    return normalized;
  } catch (error) {
    console.warn("[GSD] Failed to fetch OpenRouter models", error);
    new Notice("Failed to fetch OpenRouter models.");
    return plugin.settings.openrouter.modelCache;
  }
}

function normalizeOpenRouterModel(raw: Record<string, unknown>): OpenRouterModel | null {
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
    supported_parameters: Array.isArray(raw.supported_parameters) ? (raw.supported_parameters as string[]) : [],
    per_request_limits: raw.per_request_limits as Record<string, unknown> | null,
    architecture: raw.architecture as OpenRouterModel["architecture"],
  };
}

// ============================================================================
// Model Helpers
// ============================================================================

function getOpenRouterProvider(model: OpenRouterModel): string {
  if (!model.id.includes("/")) return "unknown";
  return model.id.split("/")[0];
}

function getOpenRouterVisibleModels(plugin: GetShitDonePlugin, state: OpenRouterTabState): OpenRouterModel[] {
  const models = plugin.settings.openrouter.modelCache;
  const selectedSet = new Set(plugin.settings.openrouter.selectedModels.map((id) => id.toLowerCase()));
  const searchTerm = state.search.trim().toLowerCase();
  const bench = plugin.settings.openrouter.benchmarks ?? { arenaScores: {}, openLlmScores: {}, openLlmFetched: {}, lastFetched: null };

  const filtered = models.filter((model) => {
    if (state.providerFilter !== "all" && getOpenRouterProvider(model) !== state.providerFilter) return false;
    if (state.freeOnly && !isOpenRouterFreeModel(model)) return false;
    if (state.selectedOnly && !selectedSet.has(model.id.toLowerCase())) return false;
    if (searchTerm && !`${model.name} ${model.id} ${model.description ?? ""}`.toLowerCase().includes(searchTerm)) return false;
    return true;
  });

  const direction = state.sortDirection === "asc" ? 1 : -1;
  const compareNumber = (a: number | null | undefined, b: number | null | undefined): number => {
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    return (a - b) * direction;
  };
  const compareString = (a: string, b: string): number => a.localeCompare(b) * direction;

  return filtered.sort((a, b) => {
    let result = 0;
    switch (state.sort) {
      case "provider": result = compareString(getOpenRouterProvider(a), getOpenRouterProvider(b)); break;
      case "context": result = compareNumber(a.context_length, b.context_length); break;
      case "cost": result = compareNumber(a.pricing.prompt + a.pricing.completion, b.pricing.prompt + b.pricing.completion); break;
      case "arena": result = compareNumber(bench.arenaScores[a.id], bench.arenaScores[b.id]); break;
      case "openllm": result = compareNumber(bench.openLlmScores[a.id], bench.openLlmScores[b.id]); break;
      case "value": result = compareNumber(getOpenRouterValueScore(plugin, a, bench), getOpenRouterValueScore(plugin, b, bench)); break;
      default: result = compareString(a.name || a.id, b.name || b.id); break;
    }
    return result !== 0 ? result : a.id.localeCompare(b.id) * direction;
  });
}

function getOpenRouterSelectedModels(plugin: GetShitDonePlugin): OpenRouterModel[] {
  const selectedSet = new Set(plugin.settings.openrouter.selectedModels.map((id) => id.toLowerCase()));
  return plugin.settings.openrouter.modelCache.filter((model) => selectedSet.has(model.id.toLowerCase()));
}

function isOpenRouterFreeModel(model: OpenRouterModel): boolean {
  return model.pricing.prompt === 0 && model.pricing.completion === 0;
}

function formatOpenRouterPricing(model: OpenRouterModel): string {
  if (isOpenRouterFreeModel(model)) return "Free";
  const formatCost = (value: number) => `$${value.toFixed(3)}`;
  const prompt = model.pricing.prompt * 1_000_000;
  const completion = model.pricing.completion * 1_000_000;
  let text = `${formatCost(prompt)}/1M in · ${formatCost(completion)}/1M out`;
  if (model.pricing.request && model.pricing.request > 0) text += ` · ${formatCost(model.pricing.request)}/request`;
  return text;
}

function formatOpenRouterBenchmark(plugin: GetShitDonePlugin, model: OpenRouterModel): string {
  const bench = plugin.settings.openrouter.benchmarks ?? { arenaScores: {}, openLlmScores: {}, openLlmFetched: {}, lastFetched: null };
  const parts: string[] = [];
  if (bench.arenaScores[model.id] != null) parts.push(`Arena ${Math.round(bench.arenaScores[model.id])}`);
  if (bench.openLlmScores[model.id] != null) parts.push(`OpenLLM ${bench.openLlmScores[model.id].toFixed(1)}%`);
  return parts.length > 0 ? parts.join(" · ") : "N/A";
}

function getOpenRouterValueScore(
  plugin: GetShitDonePlugin,
  model: OpenRouterModel,
  bench = plugin.settings.openrouter.benchmarks ?? { arenaScores: {}, openLlmScores: {}, openLlmFetched: {}, lastFetched: null }
): number | null {
  const score = bench.openLlmScores[model.id] ?? bench.arenaScores[model.id];
  if (score == null) return null;
  const costPerToken = model.pricing.prompt + model.pricing.completion;
  if (costPerToken <= 0) return Number.POSITIVE_INFINITY;
  const costPer1M = costPerToken * 1_000_000;
  if (!Number.isFinite(costPer1M) || costPer1M <= 0) return null;
  return score / costPer1M;
}

function formatOpenRouterValue(plugin: GetShitDonePlugin, model: OpenRouterModel): string {
  const value = getOpenRouterValueScore(plugin, model);
  if (value == null) return isOpenRouterFreeModel(model) ? "Free" : "N/A";
  if (!Number.isFinite(value)) return "∞";
  return `${value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2)} score/$1M`;
}

// ============================================================================
// Benchmark Fetching
// ============================================================================

async function fetchOpenRouterBenchmarks(
  plugin: GetShitDonePlugin,
  state: OpenRouterTabState,
  models: OpenRouterModel[]
): Promise<void> {
  if (!models.length) {
    new Notice("No models to benchmark.");
    return;
  }

  const arenaMap = await fetchArenaScores();
  const arenaScores = { ...plugin.settings.openrouter.benchmarks.arenaScores };
  const openLlmScores = { ...plugin.settings.openrouter.benchmarks.openLlmScores };
  const openLlmFetched = { ...(plugin.settings.openrouter.benchmarks.openLlmFetched ?? {}) };
  const fallbackFetched = plugin.settings.openrouter.benchmarks.lastFetched;

  Object.keys(openLlmScores).forEach((id) => {
    if (!openLlmFetched[id]) openLlmFetched[id] = fallbackFetched ?? new Date().toISOString();
  });

  models.forEach((model) => {
    const arenaScore = matchArenaScore(model, arenaMap);
    if (arenaScore != null) arenaScores[model.id] = arenaScore;
  });

  for (const model of models) {
    if (state.openLlmBackoffUntil && Date.now() < state.openLlmBackoffUntil) {
      new Notice("Open LLM benchmark rate limited; try again later.");
      break;
    }
    if (openLlmFetched[model.id] || openLlmScores[model.id] != null) {
      if (!openLlmFetched[model.id]) openLlmFetched[model.id] = new Date().toISOString();
      continue;
    }
    const { score, fetched } = await fetchOpenLlmScore(model, state);
    if (fetched) openLlmFetched[model.id] = new Date().toISOString();
    if (score != null) openLlmScores[model.id] = score;
  }

  plugin.settings.openrouter.benchmarks = { arenaScores, openLlmScores, openLlmFetched, lastFetched: new Date().toISOString() };
  await plugin.saveSettings();
  new Notice("Benchmarks updated.");
}

// ============================================================================
// Selection & Ranking
// ============================================================================

function toggleOpenRouterSelection(plugin: GetShitDonePlugin, modelId: string, selected: boolean): void {
  const existing = plugin.settings.openrouter.selectedModels;
  const lowered = modelId.toLowerCase();
  if (selected) {
    if (!existing.some((id) => id.toLowerCase() === lowered)) {
      plugin.settings.openrouter.selectedModels = [...existing, modelId];
    }
  } else {
    plugin.settings.openrouter.selectedModels = existing.filter((id) => id.toLowerCase() !== lowered);
  }
}

function addFreeRankModel(plugin: GetShitDonePlugin, modelId: string): void {
  const rank = plugin.settings.openrouter.freeModelRank;
  if (!rank.includes(modelId)) plugin.settings.openrouter.freeModelRank = [...rank, modelId];
}
