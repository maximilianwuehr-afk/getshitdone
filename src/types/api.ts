// ============================================================================
// API Response Types
// ============================================================================

import type { GmailMessage } from "./gmail";

export interface AppsScriptResponse {
  success: boolean;
  emails?: GmailMessage[];
  text?: string;
  error?: string;
}

export interface GeminiResponse {
  candidates?: {
    content?: {
      parts?: { text: string }[];
    };
  }[];
  error?: {
    message: string;
  };
}

// ============================================================================
// Templater Integration
// ============================================================================

export interface TemplaterObject {
  file: {
    path: (relative?: boolean) => string;
    content: string;
  };
}
