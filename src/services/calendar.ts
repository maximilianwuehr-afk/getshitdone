// ============================================================================
// Calendar Service - Wrapper for google-calendar plugin
// ============================================================================

import { App, Notice } from "obsidian";
import type { CalendarEvent } from "../types";
import type { Moment } from "moment";
import { handleErrorWithDefault } from "../utils/error-handler";

// ============================================================================
// CalendarService Class
// ============================================================================

/**
 * Calendar Service - Wrapper for the google-calendar plugin
 * Provides typed access to calendar events
 */
export class CalendarService {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  /**
   * Check if google-calendar plugin is available
   */
  isAvailable(): boolean {
    return !!this.getCalendarPlugin();
  }

  /**
   * Get the google-calendar plugin instance
   */
  private getCalendarPlugin(): any {
    return (this.app as any).plugins?.plugins?.["google-calendar"];
  }

  /**
   * Get events for a date range
   */
  async getEvents(startDate: Moment, endDate: Moment): Promise<CalendarEvent[]> {
    const plugin = this.getCalendarPlugin();
    
    if (!plugin) {
      console.warn("[GSD] Google Calendar plugin not found");
      new Notice("Google Calendar plugin is not installed or enabled");
      return [];
    }

    if (!plugin.api || typeof plugin.api.getEvents !== "function") {
      console.warn("[GSD] Google Calendar plugin API not available");
      new Notice("Google Calendar plugin API not available");
      return [];
    }

    try {
      const events = await plugin.api.getEvents({
        startDate: startDate,
        endDate: endDate,
      });
      return events as CalendarEvent[];
    } catch (error: unknown) {
      return handleErrorWithDefault(
        "Failed to fetch calendar events",
        error,
        [],
        {
          showNotice: true,
          noticeMessage: "Failed to fetch calendar events",
        }
      );
    }
  }

  /**
   * Get today's events
   */
  async getTodayEvents(): Promise<CalendarEvent[]> {
    const moment = (window as any).moment;
    const start = moment().startOf("day");
    const end = moment().endOf("day");
    return this.getEvents(start, end);
  }
}


