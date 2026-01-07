// ============================================================================
// O3 Master Note Tests
// ============================================================================
// Note: Tests verify module exports.
// The actual master note operations depend on Obsidian vault operations.
// ============================================================================

import { describe, it, expect } from "vitest";
import * as masterNote from "./master-note";

describe("master-note module", () => {
  it("exports expected functions", () => {
    expect(typeof masterNote.ensureMasterNote).toBe("function");
    expect(typeof masterNote.ensureFolderExists).toBe("function");
    expect(typeof masterNote.upsertPersonSection).toBe("function");
    expect(typeof masterNote.extractPersonSection).toBe("function");
    expect(typeof masterNote.extractWeekSection).toBe("function");
    expect(typeof masterNote.replaceWeekSection).toBe("function");
    expect(typeof masterNote.addTaskToO3Section).toBe("function");
    expect(typeof masterNote.removeTaskFromO3Section).toBe("function");
    expect(typeof masterNote.upsertTask).toBe("function");
    expect(typeof masterNote.removeTask).toBe("function");
    expect(typeof masterNote.findSectionIndex).toBe("function");
    expect(typeof masterNote.appendToSection).toBe("function");
  });
});
