// ============================================================================
// Test Setup - Global mocks and configuration
// ============================================================================

import { vi } from "vitest";

// ============================================================================
// Mock window object (for browser APIs used in Obsidian)
// ============================================================================

// @ts-ignore - Creating window mock for node environment
global.window = {
  moment: createMockMoment(),
} as unknown as Window & typeof globalThis;

// @ts-ignore
global.document = {
  createElement: (tag: string) => ({
    tagName: tag,
    appendChild: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    setAttribute: () => {},
    getAttribute: () => "",
    style: {},
    classList: {
      add: () => {},
      remove: () => {},
      toggle: () => {},
      contains: () => false,
    },
  }),
  createTextNode: (text: string) => ({ textContent: text }),
  createDocumentFragment: () => ({
    appendChild: () => {},
  }),
};

// ============================================================================
// Mock moment.js
// ============================================================================

function createMockMoment() {
  const mockMomentInstance = {
    format: vi.fn((fmt?: string) => {
      const date = mockMomentInstance._date;
      if (!fmt) return date.toISOString();

      // Handle common format patterns
      if (fmt === "YYYY-MM-DD") {
        return date.toISOString().split("T")[0];
      }
      if (fmt === "YYYY-[W]ww") {
        const year = date.getFullYear();
        const week = getWeekNumber(date);
        return `${year}-W${String(week).padStart(2, "0")}`;
      }
      if (fmt === "HH:mm") {
        return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
      }
      return date.toISOString();
    }),
    add: vi.fn((amount: number, unit: string) => {
      const newDate = new Date(mockMomentInstance._date);
      if (unit === "days" || unit === "d") {
        newDate.setDate(newDate.getDate() + amount);
      } else if (unit === "weeks" || unit === "w") {
        newDate.setDate(newDate.getDate() + amount * 7);
      } else if (unit === "months" || unit === "M") {
        newDate.setMonth(newDate.getMonth() + amount);
      }
      mockMomentInstance._date = newDate;
      return mockMomentInstance;
    }),
    subtract: vi.fn((amount: number, unit: string) => {
      return mockMomentInstance.add(-amount, unit);
    }),
    startOf: vi.fn((unit: string) => {
      const date = new Date(mockMomentInstance._date);
      if (unit === "day") {
        date.setHours(0, 0, 0, 0);
      } else if (unit === "week") {
        const day = date.getDay();
        date.setDate(date.getDate() - day);
        date.setHours(0, 0, 0, 0);
      } else if (unit === "month") {
        date.setDate(1);
        date.setHours(0, 0, 0, 0);
      }
      mockMomentInstance._date = date;
      return mockMomentInstance;
    }),
    endOf: vi.fn((unit: string) => {
      const date = new Date(mockMomentInstance._date);
      if (unit === "day") {
        date.setHours(23, 59, 59, 999);
      } else if (unit === "week") {
        const day = date.getDay();
        date.setDate(date.getDate() + (6 - day));
        date.setHours(23, 59, 59, 999);
      } else if (unit === "month") {
        date.setMonth(date.getMonth() + 1, 0);
        date.setHours(23, 59, 59, 999);
      }
      mockMomentInstance._date = date;
      return mockMomentInstance;
    }),
    isSame: vi.fn((other: any, unit?: string) => {
      const a = mockMomentInstance._date;
      const b = other?._date || new Date(other);
      if (unit === "day") {
        return a.toDateString() === b.toDateString();
      }
      return a.getTime() === b.getTime();
    }),
    isBefore: vi.fn((other: any) => {
      const b = other?._date || new Date(other);
      return mockMomentInstance._date < b;
    }),
    isAfter: vi.fn((other: any) => {
      const b = other?._date || new Date(other);
      return mockMomentInstance._date > b;
    }),
    toDate: vi.fn(() => mockMomentInstance._date),
    clone: vi.fn(() => {
      const cloned = createMockMomentInstance(new Date(mockMomentInstance._date));
      return cloned;
    }),
    _date: new Date(),
  };

  function createMockMomentInstance(date?: Date | string) {
    const instance = { ...mockMomentInstance };
    instance._date = date ? new Date(date) : new Date();
    instance.add = vi.fn((amount: number, unit: string) => {
      const newDate = new Date(instance._date);
      if (unit === "days" || unit === "d") {
        newDate.setDate(newDate.getDate() + amount);
      } else if (unit === "weeks" || unit === "w") {
        newDate.setDate(newDate.getDate() + amount * 7);
      }
      instance._date = newDate;
      return instance;
    });
    instance.format = vi.fn((fmt?: string) => {
      const d = instance._date;
      if (!fmt) return d.toISOString();
      if (fmt === "YYYY-MM-DD") {
        return d.toISOString().split("T")[0];
      }
      if (fmt === "YYYY-[W]ww") {
        const year = d.getFullYear();
        const week = getWeekNumber(d);
        return `${year}-W${String(week).padStart(2, "0")}`;
      }
      return d.toISOString();
    });
    return instance;
  }

  const moment = (input?: Date | string) => createMockMomentInstance(input ? new Date(input) : undefined);
  moment.duration = vi.fn();
  moment.utc = vi.fn((input?: Date | string) => createMockMomentInstance(input ? new Date(input) : undefined));

  return moment;
}

function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

// ============================================================================
// Mock navigator (for clipboard API)
// ============================================================================

Object.defineProperty(global, "navigator", {
  value: {
    clipboard: {
      readText: vi.fn().mockResolvedValue(""),
      writeText: vi.fn().mockResolvedValue(undefined),
    },
  },
  writable: true,
  configurable: true,
});

// ============================================================================
// Mock fetch
// ============================================================================

// @ts-ignore
global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve({}),
  text: () => Promise.resolve(""),
});

// ============================================================================
// Console helpers for cleaner test output
// ============================================================================

// Suppress console.log in tests (uncomment if needed)
// vi.spyOn(console, "log").mockImplementation(() => {});
