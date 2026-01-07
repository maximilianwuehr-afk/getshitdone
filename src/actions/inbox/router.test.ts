// ============================================================================
// Inbox Router Tests
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  evaluateRoutingRules,
  matchesRule,
  hasTaskCheckbox,
  looksLikeActionItem,
  isURL,
  shouldFormatAsTask,
  buildDefaultDecision,
  resolveFormat,
  hasApiKeyForModel,
} from "./router";
import type { InboxItem, InboxRoutingRule, PluginSettings } from "../../types";
import { DEFAULT_SETTINGS } from "../../types";

// ============================================================================
// Helper Functions
// ============================================================================

function createTestItem(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    content: "Test content",
    source: "manual",
    ...overrides,
  };
}

function createTestSettings(overrides: Partial<PluginSettings> = {}): PluginSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...overrides,
  };
}

function createTestRule(overrides: Partial<InboxRoutingRule> = {}): InboxRoutingRule {
  return {
    id: "test-rule",
    name: "Test Rule",
    enabled: true,
    match: {},
    action: {
      destination: "daily_thoughts",
      format: "task",
      addDueDate: true,
    },
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("evaluateRoutingRules", () => {
  it("returns null when no rules match", () => {
    const item = createTestItem({ content: "hello world" });
    const settings = createTestSettings({
      inbox: {
        ...DEFAULT_SETTINGS.inbox,
        routing: {
          ...DEFAULT_SETTINGS.inbox.routing,
          rules: [
            createTestRule({
              match: { contentIncludes: ["goodbye"] },
            }),
          ],
        },
      },
    });

    const result = evaluateRoutingRules(item, settings);
    expect(result).toBeNull();
  });

  it("returns first matching rule", () => {
    const item = createTestItem({ content: "hello world" });
    const settings = createTestSettings({
      inbox: {
        ...DEFAULT_SETTINGS.inbox,
        routing: {
          ...DEFAULT_SETTINGS.inbox.routing,
          rules: [
            createTestRule({
              name: "First",
              match: { contentIncludes: ["hello"] },
              action: { destination: "daily_thoughts", format: "task", addDueDate: true },
            }),
            createTestRule({
              name: "Second",
              match: { contentIncludes: ["world"] },
              action: { destination: "daily_end", format: "thought", addDueDate: false },
            }),
          ],
        },
      },
    });

    const result = evaluateRoutingRules(item, settings);
    expect(result?.destination).toBe("daily_thoughts");
  });

  it("skips disabled rules", () => {
    const item = createTestItem({ content: "hello world" });
    const settings = createTestSettings({
      inbox: {
        ...DEFAULT_SETTINGS.inbox,
        routing: {
          ...DEFAULT_SETTINGS.inbox.routing,
          rules: [
            createTestRule({
              enabled: false,
              match: { contentIncludes: ["hello"] },
              action: { destination: "daily_thoughts", format: "task", addDueDate: true },
            }),
            createTestRule({
              enabled: true,
              match: { contentIncludes: ["world"] },
              action: { destination: "daily_end", format: "thought", addDueDate: false },
            }),
          ],
        },
      },
    });

    const result = evaluateRoutingRules(item, settings);
    expect(result?.destination).toBe("daily_end");
  });
});

describe("matchesRule", () => {
  const settings = createTestSettings();

  describe("contentIncludes", () => {
    it("matches when content includes value", () => {
      const rule = createTestRule({ match: { contentIncludes: ["hello"] } });
      const item = createTestItem({ content: "say hello world" });
      expect(matchesRule(rule, item, settings)).toBe(true);
    });

    it("does not match when content does not include value", () => {
      const rule = createTestRule({ match: { contentIncludes: ["goodbye"] } });
      const item = createTestItem({ content: "say hello world" });
      expect(matchesRule(rule, item, settings)).toBe(false);
    });

    it("is case insensitive", () => {
      const rule = createTestRule({ match: { contentIncludes: ["HELLO"] } });
      const item = createTestItem({ content: "say hello world" });
      expect(matchesRule(rule, item, settings)).toBe(true);
    });
  });

  describe("contentStartsWith", () => {
    it("matches when content starts with value", () => {
      const rule = createTestRule({ match: { contentStartsWith: ["hello"] } });
      const item = createTestItem({ content: "hello world" });
      expect(matchesRule(rule, item, settings)).toBe(true);
    });

    it("does not match when content does not start with value", () => {
      const rule = createTestRule({ match: { contentStartsWith: ["world"] } });
      const item = createTestItem({ content: "hello world" });
      expect(matchesRule(rule, item, settings)).toBe(false);
    });
  });

  describe("contentRegex", () => {
    it("matches with valid regex", () => {
      const rule = createTestRule({ match: { contentRegex: "\\d{3}-\\d{4}" } });
      const item = createTestItem({ content: "call 555-1234" });
      expect(matchesRule(rule, item, settings)).toBe(true);
    });

    it("does not match when regex does not match", () => {
      const rule = createTestRule({ match: { contentRegex: "\\d{3}-\\d{4}" } });
      const item = createTestItem({ content: "call me" });
      expect(matchesRule(rule, item, settings)).toBe(false);
    });

    it("returns false for invalid regex", () => {
      const rule = createTestRule({ match: { contentRegex: "[invalid" } });
      const item = createTestItem({ content: "anything" });
      expect(matchesRule(rule, item, settings)).toBe(false);
    });
  });

  describe("inMeeting", () => {
    it("matches when in meeting and inMeeting is true", () => {
      const rule = createTestRule({ match: { inMeeting: true } });
      const item = createTestItem({ meetingContext: { summary: "Test meeting" } as any });
      expect(matchesRule(rule, item, settings)).toBe(true);
    });

    it("does not match when not in meeting and inMeeting is true", () => {
      const rule = createTestRule({ match: { inMeeting: true } });
      const item = createTestItem();
      expect(matchesRule(rule, item, settings)).toBe(false);
    });
  });

  describe("isUrl", () => {
    it("matches URLs when isUrl is true", () => {
      const rule = createTestRule({ match: { isUrl: true } });
      const item = createTestItem({ content: "https://example.com" });
      expect(matchesRule(rule, item, settings)).toBe(true);
    });

    it("does not match non-URLs when isUrl is true", () => {
      const rule = createTestRule({ match: { isUrl: true } });
      const item = createTestItem({ content: "just some text" });
      expect(matchesRule(rule, item, settings)).toBe(false);
    });
  });

  describe("length constraints", () => {
    it("matches when content meets minLength", () => {
      const rule = createTestRule({ match: { minLength: 10 } });
      const item = createTestItem({ content: "This is a longer piece of content" });
      expect(matchesRule(rule, item, settings)).toBe(true);
    });

    it("does not match when content is too short", () => {
      const rule = createTestRule({ match: { minLength: 100 } });
      const item = createTestItem({ content: "Short" });
      expect(matchesRule(rule, item, settings)).toBe(false);
    });
  });
});

describe("isURL", () => {
  it("detects http URLs", () => {
    expect(isURL("http://example.com")).toBe(true);
  });

  it("detects https URLs", () => {
    expect(isURL("https://example.com")).toBe(true);
  });

  it("detects www URLs", () => {
    expect(isURL("www.example.com")).toBe(true);
  });

  it("returns false for non-URLs", () => {
    expect(isURL("just some text")).toBe(false);
    expect(isURL("email@example.com")).toBe(false);
  });
});

describe("hasTaskCheckbox", () => {
  const settings = createTestSettings();

  it("detects standard task checkbox", () => {
    expect(hasTaskCheckbox("- [ ] Do something", settings)).toBe(true);
  });

  it("returns false for non-checkbox content", () => {
    expect(hasTaskCheckbox("Just regular text", settings)).toBe(false);
  });

  it("returns false for completed checkboxes", () => {
    expect(hasTaskCheckbox("- [x] Done task", settings)).toBe(false);
  });
});

describe("looksLikeActionItem", () => {
  const settings = createTestSettings();

  it("detects action verbs at start", () => {
    expect(looksLikeActionItem("Call John tomorrow", settings)).toBe(true);
    expect(looksLikeActionItem("Email the team", settings)).toBe(true);
    expect(looksLikeActionItem("Send the report", settings)).toBe(true);
  });

  it("detects action verbs in content", () => {
    expect(looksLikeActionItem("Need to follow up with client", settings)).toBe(true);
    expect(looksLikeActionItem("Remember to check the logs", settings)).toBe(true);
  });

  it("returns false for URLs", () => {
    // URLs should not be detected as action items
    expect(looksLikeActionItem("https://example.com/some/path", settings)).toBe(false);
  });

  it("detects short imperative sentences", () => {
    expect(looksLikeActionItem("Fix the bug", settings)).toBe(true);
  });
});

describe("shouldFormatAsTask", () => {
  const settings = createTestSettings();

  it("returns true for explicit task type", () => {
    const item = createTestItem({ type: "task" });
    expect(shouldFormatAsTask(item, settings)).toBe(true);
  });

  it("returns true for content with task checkbox", () => {
    const item = createTestItem({ content: "- [ ] Task item" });
    expect(shouldFormatAsTask(item, settings)).toBe(true);
  });

  it("returns true for action items", () => {
    const item = createTestItem({ content: "Call John tomorrow" });
    expect(shouldFormatAsTask(item, settings)).toBe(true);
  });
});

describe("hasApiKeyForModel", () => {
  it("returns true for OpenRouter models with API key", () => {
    const settings = createTestSettings({ openrouterApiKey: "test-key" });
    expect(hasApiKeyForModel("openrouter:anthropic/claude-3", settings)).toBe(true);
    expect(hasApiKeyForModel("anthropic/claude-3", settings)).toBe(true);
  });

  it("returns true for Claude models with Anthropic API key", () => {
    const settings = createTestSettings({ anthropicApiKey: "test-key" });
    expect(hasApiKeyForModel("claude-3-opus", settings)).toBe(true);
  });

  it("returns true for GPT models with OpenAI API key", () => {
    const settings = createTestSettings({ openaiApiKey: "test-key" });
    expect(hasApiKeyForModel("gpt-4", settings)).toBe(true);
  });

  it("returns true for Gemini models with Gemini API key", () => {
    const settings = createTestSettings({ geminiApiKey: "test-key" });
    expect(hasApiKeyForModel("gemini-pro", settings)).toBe(true);
  });

  it("returns false when no API key", () => {
    const settings = createTestSettings();
    expect(hasApiKeyForModel("claude-3-opus", settings)).toBe(false);
  });
});

describe("buildDefaultDecision", () => {
  const settings = createTestSettings();

  it("uses default destination", () => {
    const item = createTestItem();
    const decision = buildDefaultDecision(item, settings);
    expect(decision.destination).toBe(settings.inbox.routing.defaultDestination);
  });

  it("resolves format based on content", () => {
    const taskItem = createTestItem({ type: "task" });
    const taskDecision = buildDefaultDecision(taskItem, settings);
    expect(taskDecision.format).toBe("task");
  });
});

describe("resolveFormat", () => {
  const settings = createTestSettings();

  it("returns task when format is task", () => {
    const item = createTestItem();
    expect(resolveFormat("task", item, settings)).toBe("task");
  });

  it("returns thought when format is thought", () => {
    const item = createTestItem();
    expect(resolveFormat("thought", item, settings)).toBe("thought");
  });

  it("auto-detects based on content when format is auto", () => {
    const taskItem = createTestItem({ type: "task" });
    expect(resolveFormat("auto", taskItem, settings)).toBe("task");

    const thoughtItem = createTestItem({ content: "https://example.com" });
    expect(resolveFormat("auto", thoughtItem, settings)).toBe("thought");
  });
});
