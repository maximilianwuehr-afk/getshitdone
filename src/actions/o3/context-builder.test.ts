// ============================================================================
// O3 Context Builder Tests
// ============================================================================
// Note: Tests verify module exports and basic type checking.
// The actual O3 logic heavily depends on Obsidian runtime.
// ============================================================================

import { describe, it, expect } from "vitest";
import * as contextBuilder from "./context-builder";
import { WEEK_MARKER_PREFIX, PERSON_MARKER_PREFIX } from "./types";

describe("context-builder module", () => {
  it("exports expected functions", () => {
    expect(typeof contextBuilder.parseO3Sections).toBe("function");
    expect(typeof contextBuilder.buildO3Context).toBe("function");
    expect(typeof contextBuilder.ensureSection).toBe("function");
    expect(typeof contextBuilder.injectTasks).toBe("function");
    expect(typeof contextBuilder.getWeekKey).toBe("function");
    expect(typeof contextBuilder.buildPersonHeading).toBe("function");
    expect(typeof contextBuilder.getPersonKey).toBe("function");
  });
});

describe("types module", () => {
  it("exports marker constants", () => {
    expect(typeof WEEK_MARKER_PREFIX).toBe("string");
    expect(typeof PERSON_MARKER_PREFIX).toBe("string");
    expect(WEEK_MARKER_PREFIX.length).toBeGreaterThan(0);
    expect(PERSON_MARKER_PREFIX.length).toBeGreaterThan(0);
  });
});
