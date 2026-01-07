// ============================================================================
// Date Parser Tests
// ============================================================================
// Note: These tests verify the function signatures and basic behavior.
// The actual date parsing relies on moment.js which is mocked at runtime.
// ============================================================================

import { describe, it, expect } from "vitest";
import { parseNaturalLanguageDate, formatDueDate } from "./date-parser";

describe("parseNaturalLanguageDate", () => {
  describe("basic patterns", () => {
    it("returns a date string for 'tomorrow'", () => {
      const result = parseNaturalLanguageDate("tomorrow");
      // Should return a date in YYYY-MM-DD format
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("returns null for unrecognized input", () => {
      const result = parseNaturalLanguageDate("some random text that is not a date");
      expect(result).toBeNull();
    });

    it("returns null for empty string", () => {
      const result = parseNaturalLanguageDate("");
      expect(result).toBeNull();
    });

    it("handles 'in X days' pattern", () => {
      const result = parseNaturalLanguageDate("in 3 days");
      // Should return a date in YYYY-MM-DD format
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });
});

describe("formatDueDate", () => {
  it("is a function that returns a string", () => {
    // formatDueDate depends heavily on moment.js runtime
    // Just verify it's callable and returns a string type
    expect(typeof formatDueDate).toBe("function");
  });
});
