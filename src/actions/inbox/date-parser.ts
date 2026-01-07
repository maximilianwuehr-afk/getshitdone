// ============================================================================
// Date Parser - Natural language date parsing
// ============================================================================

const moment = (window as any).moment;

// ============================================================================
// Public API
// ============================================================================

/**
 * Parse natural language date phrases and return YYYY-MM-DD format
 * Handles: tomorrow, next week, next Monday, in 3 days, on 2025-12-23, etc.
 */
export function parseNaturalLanguageDate(content: string): string | null {
  const lower = content.toLowerCase();
  const now = moment();

  // "tomorrow" → +1 day
  if (lower.includes("tomorrow")) {
    return now.clone().add(1, "day").format("YYYY-MM-DD");
  }

  // "next week" → +7 days (or next Monday)
  if (lower.includes("next week")) {
    const nextWeek = now.clone().add(7, "days");
    // If today is Monday-Thursday, go to next Monday; otherwise add 7 days
    if (now.day() >= 1 && now.day() <= 4) {
      const daysUntilMonday = (8 - now.day()) % 7 || 7;
      return now.clone().add(daysUntilMonday, "days").format("YYYY-MM-DD");
    }
    return nextWeek.format("YYYY-MM-DD");
  }

  // "next Monday/Tuesday/etc" → next occurrence of that weekday
  const weekdays = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  for (let i = 0; i < weekdays.length; i++) {
    if (lower.includes(`next ${weekdays[i]}`)) {
      const targetDay = i === 0 ? 1 : i + 1; // moment uses 0=Sunday, 1=Monday
      const currentDay = now.day();
      let daysToAdd = targetDay - currentDay;
      if (daysToAdd <= 0) daysToAdd += 7; // Next week
      return now.clone().add(daysToAdd, "days").format("YYYY-MM-DD");
    }
  }

  // "in [N] days" → +N days
  const inDaysMatch = lower.match(/in\s+(\d+)\s+days?/);
  if (inDaysMatch) {
    const days = parseInt(inDaysMatch[1], 10);
    return now.clone().add(days, "days").format("YYYY-MM-DD");
  }

  // "on [date]" → parse specific date formats
  const onDateMatch = lower.match(/on\s+(\d{4}-\d{2}-\d{2})/); // YYYY-MM-DD
  if (onDateMatch) {
    return onDateMatch[1];
  }

  const onDateMatch2 = lower.match(/on\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/); // MM/DD/YYYY
  if (onDateMatch2) {
    const month = parseInt(onDateMatch2[1], 10);
    const day = parseInt(onDateMatch2[2], 10);
    const year = parseInt(onDateMatch2[3], 10);
    return moment(`${year}-${month}-${day}`, "YYYY-M-D").format("YYYY-MM-DD");
  }

  // Default: use settings default
  return null;
}

/**
 * Format a due date string based on offset from today
 */
export function formatDueDate(offsetDays: number): string {
  return moment().add(offsetDays, "days").format("YYYY-MM-DD");
}
