// ============================================================================
// Feedback Types
// ============================================================================

export interface FeedbackEntry {
  id: string;
  timestamp: string;
  type: "briefing" | "person" | "org";
  notePath: string;
  issue: string;
  originalContent?: string;
}

export interface FeedbackStore {
  entries: FeedbackEntry[];
  lastUpdated: string;
}
