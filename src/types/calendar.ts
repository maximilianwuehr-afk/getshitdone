// ============================================================================
// Calendar & Event Types
// ============================================================================

export interface CalendarEvent {
  id: string;
  recurringEventId?: string;
  summary?: string;
  description?: string;
  start: {
    dateTime?: string;
    date?: string;
  };
  end: {
    dateTime?: string;
    date?: string;
  };
  attendees?: Attendee[];
  attachments?: Attachment[];
}

export interface Attendee {
  email: string;
  displayName?: string;
  responseStatus?: "needsAction" | "declined" | "tentative" | "accepted";
  self?: boolean;
}

export interface Attachment {
  title: string;
  fileUrl: string;
  mimeType?: string;
}

export interface BriefingQueueItem {
  event: CalendarEvent;
  anchor: string;
  participants: Attendee[];
  noteTitle: string;
}

export interface MeetingRule {
  match: RegExp | ((e: CalendarEvent) => boolean);
  to?: string | ((e: CalendarEvent) => string);
  folder?: string | ((e: CalendarEvent) => string);
  listParticipants?: number | false;
  title?: string | ((e: CalendarEvent) => string);
}
