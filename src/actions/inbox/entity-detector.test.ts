// ============================================================================
// Entity Detector Tests
// ============================================================================
// Note: Tests verify module exports and basic function signatures.
// Entity detection relies on IndexService for actual lookups.
// ============================================================================

import { describe, it, expect } from "vitest";
import * as entityDetector from "./entity-detector";

describe("entity-detector module", () => {
  it("exports expected functions", () => {
    expect(typeof entityDetector.extractEntities).toBe("function");
    expect(typeof entityDetector.detectEntityMentions).toBe("function");
    expect(typeof entityDetector.formatWithEntityLinks).toBe("function");
  });
});

describe("formatWithEntityLinks", () => {
  it("returns content when no entities provided", () => {
    const content = "Simple task without entities";
    const entities: any[] = [];
    const settings = { inbox: { formatting: { entityLinkFormat: "wikilink" } } } as any;
    const result = entityDetector.formatWithEntityLinks(content, entities, settings);

    expect(result).toBe(content);
  });
});
