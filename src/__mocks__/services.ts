// ============================================================================
// Service Mocks
// ============================================================================
// Factory functions for creating mock services in tests
// ============================================================================

import { vi } from "vitest";
import type { App } from "obsidian";
import type { PluginSettings, CalendarEvent, Attendee } from "../types";
import { DEFAULT_SETTINGS } from "../types";

// ============================================================================
// Mock AIService
// ============================================================================

export interface MockAIService {
  generateWithFallback: ReturnType<typeof vi.fn>;
  streamGenerate: ReturnType<typeof vi.fn>;
  testConnection: ReturnType<typeof vi.fn>;
  updateSettings: ReturnType<typeof vi.fn>;
}

export function createMockAIService(overrides: Partial<MockAIService> = {}): MockAIService {
  return {
    generateWithFallback: vi.fn().mockResolvedValue({ text: "Mock AI response", model: "test-model" }),
    streamGenerate: vi.fn().mockImplementation(async function* () {
      yield "Mock ";
      yield "streaming ";
      yield "response";
    }),
    testConnection: vi.fn().mockResolvedValue({ success: true, model: "test-model" }),
    updateSettings: vi.fn(),
    ...overrides,
  };
}

// ============================================================================
// Mock GoogleServices
// ============================================================================

export interface MockGoogleServices {
  searchGmail: ReturnType<typeof vi.fn>;
  searchDrive: ReturnType<typeof vi.fn>;
  getEvents: ReturnType<typeof vi.fn>;
  findPhoneNumber: ReturnType<typeof vi.fn>;
  summarizeEmails: ReturnType<typeof vi.fn>;
  summarizeDocuments: ReturnType<typeof vi.fn>;
  updateSettings: ReturnType<typeof vi.fn>;
}

export function createMockGoogleServices(overrides: Partial<MockGoogleServices> = {}): MockGoogleServices {
  return {
    searchGmail: vi.fn().mockResolvedValue([]),
    searchDrive: vi.fn().mockResolvedValue([]),
    getEvents: vi.fn().mockResolvedValue([]),
    findPhoneNumber: vi.fn().mockResolvedValue(null),
    summarizeEmails: vi.fn().mockResolvedValue("Email summary"),
    summarizeDocuments: vi.fn().mockResolvedValue("Document summary"),
    updateSettings: vi.fn(),
    ...overrides,
  };
}

// ============================================================================
// Mock CalendarService
// ============================================================================

export interface MockCalendarService {
  parseEvents: ReturnType<typeof vi.fn>;
  formatEventForDisplay: ReturnType<typeof vi.fn>;
}

export function createMockCalendarService(overrides: Partial<MockCalendarService> = {}): MockCalendarService {
  return {
    parseEvents: vi.fn().mockReturnValue([]),
    formatEventForDisplay: vi.fn().mockReturnValue("Formatted event"),
    ...overrides,
  };
}

// ============================================================================
// Mock VaultSearchService
// ============================================================================

export interface MockVaultSearchService {
  findPersonByEmail: ReturnType<typeof vi.fn>;
  findPersonByName: ReturnType<typeof vi.fn>;
  findOrgByDomain: ReturnType<typeof vi.fn>;
  findOrgByName: ReturnType<typeof vi.fn>;
  isResearched: ReturnType<typeof vi.fn>;
  isResearchInProgress: ReturnType<typeof vi.fn>;
  searchNotes: ReturnType<typeof vi.fn>;
  updateSettings: ReturnType<typeof vi.fn>;
}

export function createMockVaultSearchService(overrides: Partial<MockVaultSearchService> = {}): MockVaultSearchService {
  return {
    findPersonByEmail: vi.fn().mockReturnValue(null),
    findPersonByName: vi.fn().mockReturnValue(null),
    findOrgByDomain: vi.fn().mockReturnValue(null),
    findOrgByName: vi.fn().mockReturnValue(null),
    isResearched: vi.fn().mockReturnValue(false),
    isResearchInProgress: vi.fn().mockReturnValue(false),
    searchNotes: vi.fn().mockReturnValue([]),
    updateSettings: vi.fn(),
    ...overrides,
  };
}

// ============================================================================
// Mock IndexService
// ============================================================================

export interface MockIndexService {
  buildIndexes: ReturnType<typeof vi.fn>;
  updateFileIndex: ReturnType<typeof vi.fn>;
  findPersonByEmail: ReturnType<typeof vi.fn>;
  findPersonByName: ReturnType<typeof vi.fn>;
  findOrgByDomain: ReturnType<typeof vi.fn>;
  findOrgByName: ReturnType<typeof vi.fn>;
  findEntitiesInContent: ReturnType<typeof vi.fn>;
  getO3People: ReturnType<typeof vi.fn>;
  getStats: ReturnType<typeof vi.fn>;
  updateSettings: ReturnType<typeof vi.fn>;
}

export function createMockIndexService(overrides: Partial<MockIndexService> = {}): MockIndexService {
  return {
    buildIndexes: vi.fn().mockResolvedValue(undefined),
    updateFileIndex: vi.fn(),
    findPersonByEmail: vi.fn().mockReturnValue(null),
    findPersonByName: vi.fn().mockReturnValue(null),
    findOrgByDomain: vi.fn().mockReturnValue(null),
    findOrgByName: vi.fn().mockReturnValue(null),
    findEntitiesInContent: vi.fn().mockReturnValue([]),
    getO3People: vi.fn().mockReturnValue([]),
    getStats: vi.fn().mockReturnValue({
      peopleByEmail: 0,
      peopleByName: 0,
      o3People: 0,
      orgsByDomain: 0,
      orgsByName: 0,
      personMeetingMappings: 0,
    }),
    updateSettings: vi.fn(),
    ...overrides,
  };
}

// ============================================================================
// Mock Feedback Action
// ============================================================================

export interface MockFeedbackAction {
  addFeedbackForCurrentNote: ReturnType<typeof vi.fn>;
  addFeedback: ReturnType<typeof vi.fn>;
  hasFeedback: ReturnType<typeof vi.fn>;
  updateSettings: ReturnType<typeof vi.fn>;
}

export function createMockFeedbackAction(overrides: Partial<MockFeedbackAction> = {}): MockFeedbackAction {
  return {
    addFeedbackForCurrentNote: vi.fn().mockResolvedValue(undefined),
    addFeedback: vi.fn().mockResolvedValue(undefined),
    hasFeedback: vi.fn().mockReturnValue(true),
    updateSettings: vi.fn(),
    ...overrides,
  };
}

// ============================================================================
// Settings Helpers
// ============================================================================

export function createMockSettings(overrides: Partial<PluginSettings> = {}): PluginSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...overrides,
  };
}

// ============================================================================
// Calendar Event Helpers
// ============================================================================

export function createMockCalendarEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  const now = new Date();
  const later = new Date(now.getTime() + 60 * 60 * 1000);

  return {
    title: "Test Meeting",
    start: now,
    end: later,
    description: "Test meeting description",
    location: "Test Location",
    attendees: [],
    organizer: "organizer@example.com",
    calendarId: "primary",
    eventId: "test-event-id",
    isRecurring: false,
    attachments: [],
    ...overrides,
  };
}

export function createMockAttendee(overrides: Partial<Attendee> = {}): Attendee {
  return {
    email: "attendee@example.com",
    displayName: "Test Attendee",
    responseStatus: "accepted",
    self: false,
    organizer: false,
    ...overrides,
  };
}

// ============================================================================
// App Helper
// ============================================================================

export function createMockApp(): App {
  // Import dynamically to avoid circular deps
  const { App: MockApp } = require("./obsidian");
  return new MockApp();
}
