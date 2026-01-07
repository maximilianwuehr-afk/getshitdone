// ============================================================================
// Triggers Tests
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  detectTriggerPhrase,
  escapeRegex,
  getLeadingPhraseMatch,
  stripLeadingPhrase,
  normalizeTriggerContent,
  stripLeadingTriggerPhrase,
  stripTaskPrefix,
  stripDueDateMarkers,
} from "./triggers";
import type { PluginSettings } from "../../types";
import { DEFAULT_SETTINGS } from "../../types";

// ============================================================================
// Helpers
// ============================================================================

function createTestSettings(overrides: Partial<PluginSettings> = {}): PluginSettings {
  return {
    ...DEFAULT_SETTINGS,
    inbox: {
      ...DEFAULT_SETTINGS.inbox,
      triggers: {
        ...DEFAULT_SETTINGS.inbox.triggers,
        researchPhrases: ["research", "look up", "find out about"],
        followupPhrases: ["follow up", "followup", "fu:", "f/u"],
      },
    },
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("escapeRegex", () => {
  it("escapes special regex characters", () => {
    expect(escapeRegex("hello.world")).toBe("hello\\.world");
    expect(escapeRegex("a*b+c?")).toBe("a\\*b\\+c\\?");
    expect(escapeRegex("[test]")).toBe("\\[test\\]");
    expect(escapeRegex("(group)")).toBe("\\(group\\)");
  });

  it("leaves normal characters unchanged", () => {
    expect(escapeRegex("hello world")).toBe("hello world");
    expect(escapeRegex("abc123")).toBe("abc123");
  });
});

describe("getLeadingPhraseMatch", () => {
  it("matches phrase at start of content", () => {
    const phrases = ["follow up", "research"];
    expect(getLeadingPhraseMatch("follow up with John", phrases)).toBe("follow up");
    expect(getLeadingPhraseMatch("research this topic", phrases)).toBe("research");
  });

  it("returns null when no match", () => {
    const phrases = ["follow up", "research"];
    expect(getLeadingPhraseMatch("call John tomorrow", phrases)).toBeNull();
  });

  it("is case insensitive", () => {
    const phrases = ["follow up"];
    expect(getLeadingPhraseMatch("FOLLOW UP with John", phrases)).toBe("FOLLOW UP");
    expect(getLeadingPhraseMatch("Follow Up later", phrases)).toBe("Follow Up");
  });

  it("returns null for empty content", () => {
    const phrases = ["follow up"];
    expect(getLeadingPhraseMatch("", phrases)).toBeNull();
    expect(getLeadingPhraseMatch("   ", phrases)).toBeNull();
  });

  it("returns null for empty phrases", () => {
    expect(getLeadingPhraseMatch("follow up", [])).toBeNull();
  });

  it("prefers longer matches", () => {
    const phrases = ["research", "research about"];
    expect(getLeadingPhraseMatch("research about AI", phrases)).toBe("research about");
  });
});

describe("stripLeadingPhrase", () => {
  it("strips matching phrase from start", () => {
    const phrases = ["follow up", "research"];
    expect(stripLeadingPhrase("follow up with John", phrases)).toBe("with John");
    expect(stripLeadingPhrase("research this topic", phrases)).toBe("this topic");
  });

  it("preserves content when no match", () => {
    const phrases = ["follow up"];
    expect(stripLeadingPhrase("call John", phrases)).toBe("call John");
  });

  it("strips trailing colon when option set", () => {
    const phrases = ["fu"];
    expect(stripLeadingPhrase("fu: call John", phrases, { stripTrailingColon: true })).toBe("call John");
  });

  it("handles colon with spaces", () => {
    const phrases = ["fu"];
    expect(stripLeadingPhrase("fu : call John", phrases, { stripTrailingColon: true })).toBe("call John");
  });
});

describe("normalizeTriggerContent", () => {
  const settings = createTestSettings();

  it("trims whitespace", () => {
    expect(normalizeTriggerContent("  hello  ", settings)).toBe("hello");
  });

  it("removes task prefix", () => {
    expect(normalizeTriggerContent("- [ ] follow up", settings)).toBe("follow up");
  });

  it("removes bullet points", () => {
    expect(normalizeTriggerContent("- follow up", settings)).toBe("follow up");
    expect(normalizeTriggerContent("* follow up", settings)).toBe("follow up");
    expect(normalizeTriggerContent("• follow up", settings)).toBe("follow up");
  });

  it("removes time stamps", () => {
    expect(normalizeTriggerContent("09:36 follow up", settings)).toBe("follow up");
    expect(normalizeTriggerContent("9:36 - follow up", settings)).toBe("follow up");
    expect(normalizeTriggerContent("14:30:45 follow up", settings)).toBe("follow up");
  });

  it("handles combined prefixes", () => {
    expect(normalizeTriggerContent("- [ ] 09:36 follow up", settings)).toBe("follow up");
  });
});

describe("stripLeadingTriggerPhrase", () => {
  const settings = createTestSettings();

  it("normalizes and strips trigger phrase", () => {
    expect(
      stripLeadingTriggerPhrase(
        "- [ ] follow up with John",
        ["follow up"],
        settings
      )
    ).toBe("with John");
  });

  it("handles colon after phrase", () => {
    expect(
      stripLeadingTriggerPhrase(
        "fu: call John",
        ["fu"],
        settings,
        { stripTrailingColon: true }
      )
    ).toBe("call John");
  });
});

describe("stripTaskPrefix", () => {
  const settings = createTestSettings();

  it("strips standard task prefix", () => {
    expect(stripTaskPrefix("- [ ] do the thing", settings)).toBe("do the thing");
  });

  it("handles various checkbox formats", () => {
    expect(stripTaskPrefix("- [  ] do the thing", settings)).toBe("do the thing");
    expect(stripTaskPrefix("-[ ] do the thing", settings)).toBe("do the thing");
  });

  it("preserves non-task content", () => {
    expect(stripTaskPrefix("just text", settings)).toBe("just text");
  });
});

describe("stripDueDateMarkers", () => {
  const settings = createTestSettings();

  it("strips due date with emoji", () => {
    const line = "Task description 📅 2024-01-15";
    expect(stripDueDateMarkers(line, settings)).toBe("Task description");
  });

  it("handles multiple date markers", () => {
    const line = "Task 📅 2024-01-15 more text 📅 2024-02-01";
    const result = stripDueDateMarkers(line, settings);
    expect(result).not.toContain("📅");
    expect(result).not.toContain("2024");
  });

  it("preserves content without dates", () => {
    const line = "Task description without date";
    expect(stripDueDateMarkers(line, settings)).toBe("Task description without date");
  });
});

describe("detectTriggerPhrase", () => {
  const settings = createTestSettings();

  it("detects research trigger", () => {
    expect(detectTriggerPhrase("research AI trends", settings)).toBe("research");
    expect(detectTriggerPhrase("look up market data", settings)).toBe("research");
  });

  it("detects followup trigger", () => {
    expect(detectTriggerPhrase("follow up with John", settings)).toBe("followup");
    expect(detectTriggerPhrase("fu: call client", settings)).toBe("followup");
  });

  it("returns null for no trigger", () => {
    expect(detectTriggerPhrase("buy groceries", settings)).toBeNull();
  });

  it("prioritizes followup over research", () => {
    // If content starts with followup phrase, should return followup
    expect(detectTriggerPhrase("follow up research", settings)).toBe("followup");
  });

  it("handles normalized content", () => {
    // Should normalize before checking
    expect(detectTriggerPhrase("- [ ] follow up with John", settings)).toBe("followup");
    expect(detectTriggerPhrase("09:36 research topic", settings)).toBe("research");
  });
});
