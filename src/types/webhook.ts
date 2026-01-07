// ============================================================================
// Webhook Types
// ============================================================================

export interface WebhookSettings {
  enabled: boolean;
  port: number;
  apiKey: string;
  bindAddress: "127.0.0.1" | "0.0.0.0";
}

export interface AmieWebhookPayload {
  recordingId: string;
  workspaceId: string;
  userId: string;
  userEmail: string;
  title: string;
  summary: string;
  shortSummary: string;
  mdSummary: string;
  suggestedTitle: string;
  transcript: string;
  recordingLink: string;
  createdAt: string;
  updatedAt: string;
  metadata: {
    providerCalendarEventId: string;
    providerCalendarId: string;
    startAt: string;
    endAt: string;
    title: string;
    description: string;
    guests: Array<{ email: string; displayName: string }>;
  };
}
