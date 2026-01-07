// ============================================================================
// OpenRouter Benchmarks - Fetching Arena and OpenLLM scores
// ============================================================================

import { requestUrl, RequestUrlResponse } from "obsidian";
import type { OpenRouterModel } from "../types";

// ============================================================================
// Types
// ============================================================================

export interface BenchmarkState {
  openLlmOrgIndex: Map<string, Map<string, string>>;
  openLlmLastRequestAt: number;
  openLlmBackoffUntil: number;
}

export interface BenchmarkScores {
  arenaScores: Record<string, number>;
  openLlmScores: Record<string, number>;
  openLlmFetched: Record<string, string>;
  lastFetched: string | null;
}

// ============================================================================
// Arena Scores
// ============================================================================

export async function fetchArenaScores(): Promise<Map<string, number>> {
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
          const candidates = [model, markup ? stripHtmlTags(markup) : null]
            .filter((value): value is string => Boolean(value));
          candidates.forEach((candidate) => {
            getArenaKeyVariants(candidate).forEach((key) => {
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

export function matchArenaScore(
  model: OpenRouterModel,
  arenaMap: Map<string, number>
): number | null {
  const candidates = [
    model.name,
    model.id,
    model.id.split("/").pop() ?? model.id,
    model.canonical_slug ?? "",
    model.hugging_face_id ?? "",
  ].filter(Boolean);

  for (const candidate of candidates) {
    const keys = getArenaKeyVariants(candidate);
    for (const key of keys) {
      const score = arenaMap.get(key);
      if (score != null) {
        return score;
      }
    }
  }
  return null;
}

// ============================================================================
// OpenLLM Scores
// ============================================================================

export async function fetchOpenLlmScore(
  model: OpenRouterModel,
  state: BenchmarkState
): Promise<{ score: number | null; fetched: boolean }> {
  if (state.openLlmBackoffUntil && Date.now() < state.openLlmBackoffUntil) {
    return { score: null, fetched: false };
  }

  const candidates = Array.from(new Set(
    [model.hugging_face_id, model.canonical_slug, model.id]
      .filter((value): value is string => {
        if (!value) return false;
        return value.includes("/");
      })
  ));
  if (candidates.length === 0) {
    return { score: null, fetched: true };
  }

  for (const candidate of candidates) {
    if (state.openLlmBackoffUntil && Date.now() < state.openLlmBackoffUntil) {
      return { score: null, fetched: false };
    }
    const directFiles = await fetchOpenLlmResultFiles(state, candidate);
    if (state.openLlmBackoffUntil && Date.now() < state.openLlmBackoffUntil) {
      return { score: null, fetched: false };
    }
    const files = directFiles?.length ? directFiles : null;
    const resolved = files ? null : await resolveOpenLlmPath(state, candidate);
    if (state.openLlmBackoffUntil && Date.now() < state.openLlmBackoffUntil) {
      return { score: null, fetched: false };
    }
    const resolvedFiles = !files && resolved ? await fetchOpenLlmResultFiles(state, resolved) : null;
    if (state.openLlmBackoffUntil && Date.now() < state.openLlmBackoffUntil) {
      return { score: null, fetched: false };
    }
    const resultFiles = files ?? resolvedFiles ?? [];

    if (!resultFiles.length) continue;

    const latestPath = resultFiles.sort().at(-1);
    if (!latestPath) continue;

    const resultResponse = await requestOpenLlm(
      state,
      {
        url: `https://huggingface.co/datasets/open-llm-leaderboard/results/resolve/main/${encodePath(latestPath)}`,
        method: "GET",
      },
      "results"
    );

    if (!resultResponse || resultResponse.status !== 200) {
      if (state.openLlmBackoffUntil && Date.now() < state.openLlmBackoffUntil) {
        return { score: null, fetched: false };
      }
      continue;
    }

    const data = resultResponse.json as { results?: Record<string, Record<string, unknown>> };
    const leaderboard = data?.results?.leaderboard ?? {};
    const accNorm = leaderboard["acc_norm,none"];
    const acc = leaderboard["acc,none"];
    const value = typeof accNorm === "number" ? accNorm : typeof acc === "number" ? acc : null;
    if (value == null) continue;

    return { score: Math.round(value * 1000) / 10, fetched: true };
  }

  return { score: null, fetched: true };
}

// ============================================================================
// Helpers
// ============================================================================

export function normalizeBenchmarkKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function stripHtmlTags(value: string): string {
  return value.replace(/<[^>]*>/g, "");
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function rateLimitOpenLlm(state: BenchmarkState): Promise<void> {
  const now = Date.now();
  const minDelayMs = 700;
  const waitFor = Math.max(0, state.openLlmLastRequestAt + minDelayMs - now);
  if (waitFor > 0) {
    await sleep(waitFor);
  }
  state.openLlmLastRequestAt = Date.now();
}

async function requestOpenLlm(
  state: BenchmarkState,
  options: { url: string; method: "GET" },
  label: string
): Promise<RequestUrlResponse | null> {
  if (state.openLlmBackoffUntil && Date.now() < state.openLlmBackoffUntil) {
    return null;
  }

  const maxRetries = 2;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      await rateLimitOpenLlm(state);
      const response = await requestUrl(options) as RequestUrlResponse;
      if (response.status === 429) {
        state.openLlmBackoffUntil = Date.now() + 60_000;
        await sleep(2000 * (attempt + 1));
        continue;
      }
      return response;
    } catch (error) {
      const status = (error as { status?: number }).status;
      const message = error instanceof Error ? error.message : String(error);
      if (status === 429 || message.includes("status 429")) {
        state.openLlmBackoffUntil = Date.now() + 60_000;
        await sleep(2000 * (attempt + 1));
        continue;
      }
      console.warn(`[GSD] Failed to fetch Open LLM benchmark (${label})`, error);
      return null;
    }
  }

  return null;
}

function getArenaKeyVariants(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) return [];

  const variants = new Set<string>();
  const base = normalizeBenchmarkKey(trimmed);
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

async function fetchOpenLlmResultFiles(
  state: BenchmarkState,
  path: string
): Promise<string[] | null> {
  const treeResponse = await requestOpenLlm(
    state,
    {
      url: `https://huggingface.co/api/datasets/open-llm-leaderboard/results/tree/main/${encodePath(path)}`,
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
    .filter((entry): entry is string => {
      if (!entry) return false;
      return entry.includes("results_") && entry.endsWith(".json");
    });
}

async function getOpenLlmOrgIndex(
  state: BenchmarkState,
  org: string
): Promise<Map<string, string> | null> {
  if (state.openLlmOrgIndex.has(org)) {
    return state.openLlmOrgIndex.get(org) ?? null;
  }

  const response = await requestOpenLlm(
    state,
    {
      url: `https://huggingface.co/api/datasets/open-llm-leaderboard/results/tree/main/${encodePath(org)}`,
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
    index.set(normalizeBenchmarkKey(leaf), path);
  });

  state.openLlmOrgIndex.set(org, index);
  return index;
}

async function resolveOpenLlmPath(
  state: BenchmarkState,
  candidateId: string
): Promise<string | null> {
  if (!candidateId.includes("/")) return null;

  const [org, ...rest] = candidateId.split("/");
  const repo = rest.join("/");
  const index = await getOpenLlmOrgIndex(state, org);
  if (!index) return null;

  const directKey = normalizeBenchmarkKey(repo);
  if (index.has(directKey)) {
    return index.get(directKey) ?? null;
  }

  const withoutMeta = repo.replace(/^meta[-_]/i, "");
  if (withoutMeta !== repo) {
    const altKey = normalizeBenchmarkKey(withoutMeta);
    if (index.has(altKey)) {
      return index.get(altKey) ?? null;
    }
  }

  return null;
}

function encodePath(path: string): string {
  return path.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}
