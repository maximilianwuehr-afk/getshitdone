// ============================================================================
// Router - Inbox routing engine
// ============================================================================

import type {
  PluginSettings,
  InboxItem,
  InboxRoutingRule,
  InboxFormatStyle,
} from "../../types";
import { handleErrorWithDefault } from "../../utils/error-handler";
import { AIService } from "../../services/ai-service";
import type { InboxRouteDecision } from "./types";
import { escapeRegex, stripTaskPrefix } from "./triggers";

// ============================================================================
// Public API
// ============================================================================

/**
 * Deterministic routing - fast, no AI, no file operations
 * Used for immediate capture; AI routing can enhance later if needed.
 */
export async function routeItemDeterministic(
  item: InboxItem,
  settings: PluginSettings
): Promise<InboxRouteDecision> {
  return getRoutingDecision(item, settings, null, { allowAI: false });
}

/**
 * Route an inbox item to its destination
 * Uses deterministic rules first, then AI fallback
 */
export async function routeItem(
  item: InboxItem,
  settings: PluginSettings,
  aiService: AIService
): Promise<InboxRouteDecision> {
  return getRoutingDecision(item, settings, aiService, { allowAI: true });
}

/**
 * Use AI model to classify content
 */
export async function routeWithAI(
  item: InboxItem,
  settings: PluginSettings,
  aiService: AIService
): Promise<InboxRouteDecision | null> {
  const prompt = settings.prompts.inboxRouting
    .replace("{content}", item.content.substring(0, 500))
    .replace("{length}", String(item.content.length))
    .replace("{inMeeting}", item.meetingContext ? "YES" : "NO")
    .replace("{meetingTitle}", item.meetingContext?.summary || "N/A");

  try {
    const cfg = settings.generationConfigs?.inboxRouting;
    const result = await aiService.callModel(
      "You are a content classifier. Respond with exactly one word.",
      prompt,
      settings.models.inboxRoutingModel,
      {
        useSearch: false,
        temperature: cfg?.temperature,
        thinkingBudget: cfg?.thinkingBudget ?? undefined,
      }
    );

    if (!result) return null;

    const classification = result.trim().toUpperCase();
    console.log(`[GSD Inbox] AI classification: ${classification}`);

    switch (classification) {
      case "TASK":
        return {
          destination: item.meetingContext ? "meeting_followup" : "daily_thoughts",
          format: "task",
          addDueDate: true,
        };
      case "MEETING_FOLLOWUP":
        return {
          destination: item.meetingContext ? "meeting_followup" : "daily_thoughts",
          format: "task",
          addDueDate: true,
        };
      case "THOUGHT":
      case "REFERENCE":
        return {
          destination: "daily_thoughts",
          format: "thought",
          addDueDate: false,
        };
      default:
        return null;
    }
  } catch (error: unknown) {
    return handleErrorWithDefault(
      "Inbox: AI routing failed",
      error,
      null
    );
  }
}

// ============================================================================
// Routing Decision Logic
// ============================================================================

export async function getRoutingDecision(
  item: InboxItem,
  settings: PluginSettings,
  aiService: AIService | null,
  options: { allowAI: boolean }
): Promise<InboxRouteDecision> {
  const ruleDecision = evaluateRoutingRules(item, settings);
  if (ruleDecision) {
    return ruleDecision;
  }

  if (options.allowAI && aiService && settings.inbox.routing.aiFallbackEnabled) {
    const model = settings.models.inboxRoutingModel || settings.models.briefingModel;
    if (model && hasApiKeyForModel(model, settings)) {
      const aiDecision = await routeWithAI(item, settings, aiService);
      if (aiDecision) {
        return aiDecision;
      }
    }
  }

  return buildDefaultDecision(item, settings);
}

export function evaluateRoutingRules(
  item: InboxItem,
  settings: PluginSettings
): InboxRouteDecision | null {
  const rules = settings.inbox.routing.rules || [];

  for (const rule of rules) {
    if (!rule || !rule.match || !rule.action) continue;
    if (!rule.enabled) continue;
    if (!matchesRule(rule, item, settings)) continue;

    const format = resolveFormat(rule.action.format, item, settings);
    const addDueDate = format === "task" ? rule.action.addDueDate : false;

    return {
      destination: rule.action.destination,
      format,
      addDueDate,
      dueDateOffset: rule.action.dueDateOffset,
      ruleId: rule.id,
    };
  }

  return null;
}

export function matchesRule(
  rule: InboxRoutingRule,
  item: InboxItem,
  settings: PluginSettings
): boolean {
  const match = rule.match;
  if (!match) return false;
  const content = item.content ?? "";
  const trimmed = content.trim();
  const lower = trimmed.toLowerCase();

  if (match.inMeeting !== undefined) {
    if (match.inMeeting !== Boolean(item.meetingContext)) return false;
  }

  if (match.contentTypes && match.contentTypes.length > 0) {
    if (!match.contentTypes.includes(item.type)) return false;
  }

  if (match.contentStartsWith && match.contentStartsWith.length > 0) {
    const prefixes = match.contentStartsWith
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    if (!prefixes.some((prefix) => lower.startsWith(prefix.toLowerCase()))) {
      return false;
    }
  }

  if (match.contentIncludes && match.contentIncludes.length > 0) {
    const includes = match.contentIncludes
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    if (!includes.some((needle) => lower.includes(needle.toLowerCase()))) {
      return false;
    }
  }

  if (match.contentRegex) {
    const flags = match.regexFlags !== undefined ? match.regexFlags : "i";
    try {
      const regex = new RegExp(match.contentRegex, flags);
      if (!regex.test(trimmed)) return false;
    } catch (error) {
      console.log(`[GSD Inbox] Invalid regex in rule "${rule.name}":`, error);
      return false;
    }
  }

  if (match.isUrl !== undefined) {
    if (match.isUrl !== isURL(trimmed)) return false;
  }

  if (match.hasTaskCheckbox !== undefined) {
    if (match.hasTaskCheckbox !== hasTaskCheckbox(trimmed, settings)) return false;
  }

  if (match.actionItem !== undefined) {
    if (match.actionItem !== looksLikeActionItem(trimmed, settings)) return false;
  }

  if (match.minLength !== undefined && trimmed.length < match.minLength) {
    return false;
  }

  if (match.maxLength !== undefined && trimmed.length > match.maxLength) {
    return false;
  }

  return true;
}

export function resolveFormat(
  format: InboxFormatStyle,
  item: InboxItem,
  settings: PluginSettings
): "task" | "thought" {
  if (format !== "auto") return format;
  return shouldFormatAsTask(item, settings) ? "task" : "thought";
}

export function buildDefaultDecision(
  item: InboxItem,
  settings: PluginSettings
): InboxRouteDecision {
  const format = resolveFormat(settings.inbox.routing.defaultFormat, item, settings);
  const addDueDate =
    format === "task" ? settings.inbox.routing.defaultAddDueDate : false;

  return {
    destination: settings.inbox.routing.defaultDestination,
    format,
    addDueDate,
  };
}

// ============================================================================
// Content Detection Helpers
// ============================================================================

export function shouldFormatAsTask(item: InboxItem, settings: PluginSettings): boolean {
  const isExplicitTask = item.type === "task" || hasTaskCheckbox(item.content, settings);
  const isActionItem = looksLikeActionItem(item.content, settings);
  return isExplicitTask || isActionItem;
}

export function hasApiKeyForModel(model: string, settings: PluginSettings): boolean {
  if (!model) return false;
  const lower = model.toLowerCase();
  if (lower.startsWith("openrouter:") || lower.includes("/")) {
    return Boolean(settings.openrouterApiKey);
  }
  if (lower.startsWith("claude-")) {
    return Boolean(settings.anthropicApiKey);
  }
  if (lower.startsWith("gpt-") || lower.startsWith("o1-") || lower.startsWith("o3-")) {
    return Boolean(settings.openaiApiKey);
  }
  return Boolean(settings.geminiApiKey);
}

export function hasTaskCheckbox(content: string, settings: PluginSettings): boolean {
  const taskPrefix = settings.inbox.formatting.taskPrefix.trim();
  if (!taskPrefix) return /^\s*-\s*\[\s*\]/.test(content);
  return content.trim().startsWith(taskPrefix);
}

/**
 * Check if content looks like an action item
 */
export function looksLikeActionItem(content: string, settings: PluginSettings): boolean {
  const trimmed = content.trim();
  if (!trimmed) return false;

  const actionSettings = settings.inbox.actionDetection;
  if (!actionSettings.enabled) return false;

  const lower = trimmed.toLowerCase();
  const actionVerbs = actionSettings.verbs || [];
  const matchMode = actionSettings.matchMode;

  if (matchMode === "starts_with" || matchMode === "both") {
    for (const verb of actionVerbs) {
      const normalized = verb.trim().toLowerCase();
      if (!normalized) continue;
      if (lower.startsWith(normalized)) {
        console.log(`[GSD Inbox] Action item detected (starts with): "${normalized}"`);
        return true;
      }
    }
  }

  if (matchMode === "contains" || matchMode === "both") {
    for (const verb of actionVerbs) {
      const normalized = verb.trim().toLowerCase();
      if (!normalized) continue;
      if (normalized.includes(" ")) {
        if (lower.includes(normalized)) {
          console.log(`[GSD Inbox] Action item detected (contains phrase): "${normalized}"`);
          return true;
        }
        const escaped = escapeRegex(normalized);
        const regex = new RegExp(`\\b${escaped.replace(/\\s+/g, "\\\\s+")}\\b`, "i");
        if (regex.test(lower)) {
          console.log(`[GSD Inbox] Action item detected (contains regex): "${normalized}"`);
          return true;
        }
      } else {
        const regex = new RegExp(`\\b${escapeRegex(normalized)}\\b`, "i");
        if (regex.test(lower)) {
          console.log(`[GSD Inbox] Action item detected (contains): "${normalized}"`);
          return true;
        }
      }
    }
  }

  if (actionSettings.includeImperativePattern) {
    if (/^[a-z]+\s+(the|a|an|with|to|for)\s+/i.test(trimmed)) {
      console.log(`[GSD Inbox] Action item detected (imperative pattern)`);
      return true;
    }
  }

  if (
    actionSettings.includeShortContent &&
    trimmed.length <= actionSettings.shortContentMaxChars &&
    !isURL(trimmed) &&
    !trimmed.includes("\n")
  ) {
    if (/^[A-Z][^.!?]*[.!?]?$/.test(trimmed) || /^[a-z]/.test(trimmed)) {
      console.log(
        `[GSD Inbox] Action item detected (short content, likely task): "${trimmed.substring(0, 50)}"`
      );
      return true;
    }
  }

  console.log(`[GSD Inbox] Content does NOT look like action item: "${trimmed.substring(0, 50)}"`);
  return false;
}

/**
 * Check if content is a URL
 */
export function isURL(content: string): boolean {
  const trimmed = content.trim();
  return /^https?:\/\//i.test(trimmed) || /^www\./i.test(trimmed);
}

export function formatDestinationLabel(destination: string): string {
  if (destination === "meeting_followup") {
    return "meeting follow-ups";
  }
  if (destination === "daily_end") {
    return "daily end";
  }
  return "daily thoughts";
}
