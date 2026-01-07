// ============================================================================
// O3 Prep Types
// ============================================================================

export interface O3Settings {
  enabled: boolean;
  masterNotePath: string;
  meetingTitleRegex: string;
  dailyNoteInsert: boolean;
}

export interface O3CoachSettings {
  lookbackDays: number;
  perfReviewFolder: string;
  perfReviewMax: number;
  currentNotesMax: number;
}
