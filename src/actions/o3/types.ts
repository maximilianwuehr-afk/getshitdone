// ============================================================================
// O3 Types - Types and constants for O3 prep module
// ============================================================================

import type { CalendarEvent } from "../../types";

// ============================================================================
// Types
// ============================================================================

export type O3SectionData = {
  followUps: string[];
  updates: string[];
  standingTopics: string[];
};

export type O3Person = {
  name: string;
  filePath: string;
  email?: string | null;
  o3Doc?: string | null;
  o3MeetingId?: string | null;
  sections: O3SectionData;
  lastMeetingDate?: string | null;
};

export type O3MeetingItem = {
  person: O3Person;
  event: CalendarEvent;
  meetingTime: string;
  lastMeetingDate?: string | null;
};

export type O3DashboardData = {
  weekStart: string;
  weekEnd: string;
  meetings: O3MeetingItem[];
  o3WithoutMeeting: O3Person[];
};

// ============================================================================
// Constants
// ============================================================================

export const WEEK_MARKER_PREFIX = "<!-- GSD:O3-WEEK:";
export const PERSON_MARKER_PREFIX = "<!-- GSD:O3-PERSON:";
