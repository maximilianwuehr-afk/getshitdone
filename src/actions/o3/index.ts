// ============================================================================
// O3 Module - Re-exports for convenient imports
// ============================================================================

// Main action class
export { O3PrepAction } from "./o3-prep-action";

// Types
export type { O3SectionData, O3Person, O3MeetingItem, O3DashboardData } from "./types";
export { WEEK_MARKER_PREFIX, PERSON_MARKER_PREFIX } from "./types";

// Context building
export {
  parseO3Sections,
  buildO3Context,
  ensureSection,
  injectTasks,
  getWeekKey,
  buildPersonHeading,
  getPersonKey,
} from "./context-builder";

// Master note operations
export {
  ensureMasterNote,
  ensureFolderExists,
  upsertPersonSection,
  extractPersonSection,
  extractWeekSection,
  replaceWeekSection,
  addTaskToO3Section,
  removeTaskFromO3Section,
  upsertTask,
  removeTask,
  findSectionIndex,
  appendToSection,
} from "./master-note";

// Person loading
export {
  getO3People,
  loadPerson,
  resolvePersonFromAttendee,
  getLastMeetingDate,
  ensureO3MeetingId,
  extractPrimaryEmail,
  extractMeetingDate,
  humanizeEmail,
  isLikelyRoomName,
  filterAttendees,
} from "./person-loader";
