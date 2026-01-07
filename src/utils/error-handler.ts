// ============================================================================
// Error Handler - Unified error handling utilities
// ============================================================================

import { Notice } from "obsidian";

// ============================================================================
// Message Extraction
// ============================================================================

/**
 * Extract a user-friendly error message from an unknown error
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object" && "message" in error) {
    return String(error.message);
  }
  return "An unknown error occurred";
}

/**
 * Extract error details for logging
 */
export function getErrorDetails(error: unknown): {
  message: string;
  stack?: string;
  name?: string;
  [key: string]: unknown;
} {
  const details: {
    message: string;
    stack?: string;
    name?: string;
    [key: string]: unknown;
  } = {
    message: getErrorMessage(error),
  };

  if (error instanceof Error) {
    details.stack = error.stack;
    details.name = error.name;
  }

  // Try to extract additional properties from error objects
  if (error && typeof error === "object") {
    for (const [key, value] of Object.entries(error)) {
      if (key !== "message" && key !== "stack" && key !== "name") {
        details[key] = value;
      }
    }
  }

  return details;
}

/**
 * Log an error with consistent formatting
 */
export function logError(
  context: string,
  error: unknown,
  additionalContext?: Record<string, unknown>
): void {
  const details = getErrorDetails(error);
  const logData = {
    ...details,
    ...additionalContext,
  };

  console.error(`[GSD] ${context}:`, logData);
}

/**
 * Handle an error with logging and optional user notification
 */
export function handleError(
  context: string,
  error: unknown,
  options: {
    showNotice?: boolean;
    noticeMessage?: string;
    additionalContext?: Record<string, unknown>;
    silent?: boolean; // If true, don't log (for expected errors)
  } = {}
): void {
  const {
    showNotice = false,
    noticeMessage,
    additionalContext,
    silent = false,
  } = options;

  if (!silent) {
    logError(context, error, additionalContext);
  }

  if (showNotice) {
    const message = noticeMessage || getErrorMessage(error);
    new Notice(message);
  }
}

/**
 * Handle an error and return a default value
 * Useful for operations where failure is acceptable
 */
export function handleErrorWithDefault<T>(
  context: string,
  error: unknown,
  defaultValue: T,
  options: {
    showNotice?: boolean;
    noticeMessage?: string;
    additionalContext?: Record<string, unknown>;
    silent?: boolean;
  } = {}
): T {
  handleError(context, error, options);
  return defaultValue;
}

/**
 * Wrap an async function with consistent error handling
 */
export function withErrorHandling<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  context: string,
  options: {
    showNotice?: boolean;
    noticeMessage?: string;
    onError?: (error: unknown) => void;
  } = {}
): T {
  return (async (...args: Parameters<T>) => {
    try {
      return await fn(...args);
    } catch (error) {
      handleError(context, error, {
        showNotice: options.showNotice,
        noticeMessage: options.noticeMessage,
      });
      if (options.onError) {
        options.onError(error);
      }
      throw error; // Re-throw to allow caller to handle if needed
    }
  }) as T;
}
