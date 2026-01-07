// ============================================================================
// Deep Merge Tests
// ============================================================================

import { describe, it, expect } from "vitest";
import { deepMerge } from "./deep-merge";

describe("deepMerge", () => {
  describe("basic merging", () => {
    it("returns copy of target when source is null", () => {
      const target = { a: 1, b: 2 };
      const result = deepMerge(target, null);
      expect(result).toEqual({ a: 1, b: 2 });
      expect(result).not.toBe(target); // Should be a new object
    });

    it("returns copy of target when source is undefined", () => {
      const target = { a: 1, b: 2 };
      const result = deepMerge(target, undefined);
      expect(result).toEqual({ a: 1, b: 2 });
    });

    it("merges flat objects", () => {
      const target = { a: 1, b: 2, c: 3 };
      const source = { b: 20, d: 4 };
      const result = deepMerge(target, source);

      expect(result).toEqual({ a: 1, b: 20, c: 3, d: 4 });
    });

    it("preserves target values not in source", () => {
      const target = { a: 1, b: 2 };
      const source = { b: 20 };
      const result = deepMerge(target, source);

      expect(result).toEqual({ a: 1, b: 20 });
    });
  });

  describe("nested object merging", () => {
    it("recursively merges nested objects", () => {
      const target = {
        level1: {
          a: 1,
          b: 2,
        },
      };
      const source = {
        level1: {
          b: 20,
          c: 3,
        },
      };
      const result = deepMerge(target, source);

      expect(result).toEqual({
        level1: {
          a: 1,
          b: 20,
          c: 3,
        },
      });
    });

    it("handles deeply nested objects", () => {
      const target = {
        l1: {
          l2: {
            l3: {
              a: 1,
              b: 2,
            },
          },
        },
      };
      const source = {
        l1: {
          l2: {
            l3: {
              b: 20,
            },
          },
        },
      };
      const result = deepMerge(target, source);

      expect(result.l1.l2.l3.a).toBe(1);
      expect(result.l1.l2.l3.b).toBe(20);
    });

    it("adds new nested properties", () => {
      const target = {
        existing: { a: 1 },
      };
      const source = {
        existing: { b: 2 },
        newProp: { c: 3 },
      };
      const result = deepMerge(target, source);

      expect(result).toEqual({
        existing: { a: 1, b: 2 },
        newProp: { c: 3 },
      });
    });
  });

  describe("array handling", () => {
    it("replaces arrays entirely (does not merge)", () => {
      const target = { items: [1, 2, 3] };
      const source = { items: [4, 5] };
      const result = deepMerge(target, source);

      expect(result.items).toEqual([4, 5]);
    });

    it("allows empty array to replace populated array", () => {
      const target = { items: [1, 2, 3] };
      const source = { items: [] };
      const result = deepMerge(target, source);

      expect(result.items).toEqual([]);
    });

    it("handles arrays of objects", () => {
      const target = { rules: [{ id: 1 }, { id: 2 }] };
      const source = { rules: [{ id: 3 }] };
      const result = deepMerge(target, source);

      expect(result.rules).toEqual([{ id: 3 }]);
    });
  });

  describe("null and undefined values", () => {
    it("skips undefined source values", () => {
      const target = { a: 1, b: 2 };
      const source = { a: undefined };
      const result = deepMerge(target, source);

      expect(result.a).toBe(1); // Should keep target value
    });

    it("allows null source values to override", () => {
      const target = { a: 1, b: { nested: true } };
      const source = { b: null };
      const result = deepMerge(target, source as any);

      expect(result.b).toBeNull();
    });
  });

  describe("type preservation", () => {
    it("preserves strings", () => {
      const target = { name: "default" };
      const source = { name: "custom" };
      const result = deepMerge(target, source);

      expect(result.name).toBe("custom");
      expect(typeof result.name).toBe("string");
    });

    it("preserves numbers", () => {
      const target = { count: 0 };
      const source = { count: 42 };
      const result = deepMerge(target, source);

      expect(result.count).toBe(42);
      expect(typeof result.count).toBe("number");
    });

    it("preserves booleans", () => {
      const target = { enabled: false };
      const source = { enabled: true };
      const result = deepMerge(target, source);

      expect(result.enabled).toBe(true);
      expect(typeof result.enabled).toBe("boolean");
    });
  });

  describe("settings-like objects", () => {
    it("merges settings with partial overrides", () => {
      const defaultSettings = {
        api: {
          key: "",
          timeout: 5000,
        },
        features: {
          enabled: true,
          autoSave: false,
        },
        theme: "light",
      };

      const userSettings = {
        api: {
          key: "user-key",
        },
        features: {
          autoSave: true,
        },
      };

      const result = deepMerge(defaultSettings, userSettings);

      expect(result).toEqual({
        api: {
          key: "user-key",
          timeout: 5000, // Preserved from default
        },
        features: {
          enabled: true, // Preserved from default
          autoSave: true, // Overridden by user
        },
        theme: "light", // Preserved from default
      });
    });
  });

  describe("immutability", () => {
    it("does not modify target object", () => {
      const target = { a: 1, nested: { b: 2 } };
      const original = JSON.parse(JSON.stringify(target));

      deepMerge(target, { a: 10, nested: { b: 20 } });

      expect(target).toEqual(original);
    });

    it("does not modify source object", () => {
      const source = { a: 10, nested: { b: 20 } };
      const original = JSON.parse(JSON.stringify(source));

      deepMerge({ a: 1, nested: { b: 2 } }, source);

      expect(source).toEqual(original);
    });
  });
});
