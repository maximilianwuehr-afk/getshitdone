// ============================================================================
// Inbox Types - Local types for inbox module
// ============================================================================

import type { InboxRouteDestination, InboxFormatStyle } from "../../types";

// ============================================================================
// Types
// ============================================================================

export type InboxRouteDecision = {
  destination: InboxRouteDestination;
  format: Exclude<InboxFormatStyle, "auto">;
  addDueDate: boolean;
  dueDateOffset?: number;
  ruleId?: string;
};

export type SummarizeAPI = {
  summarizeUrl: (
    url: string,
    options?: {
      length?: string;
      language?: string;
      model?: string;
      prompt?: string;
      onStream?: (chunk: string) => void;
    }
  ) => Promise<string>;
  isConfigured: () => boolean;
};

// ============================================================================
// Errors
// ============================================================================

export class DailyNoteNotReadyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DailyNoteNotReadyError";
  }
}
