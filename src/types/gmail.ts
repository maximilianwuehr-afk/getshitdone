// ============================================================================
// Gmail Types
// ============================================================================

export interface GmailMessage {
  messageId?: string;
  subject: string;
  from: string;
  to?: string;
  date: string;
  snippet?: string;
  body?: string;
}
