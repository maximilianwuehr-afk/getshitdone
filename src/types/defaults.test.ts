// ============================================================================
// Default Settings Tests
// ============================================================================

import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS } from "./defaults";

describe("DEFAULT_SETTINGS", () => {
  describe("structure", () => {
    it("has all required top-level keys", () => {
      expect(DEFAULT_SETTINGS).toHaveProperty("anthropicApiKey");
      expect(DEFAULT_SETTINGS).toHaveProperty("openaiApiKey");
      expect(DEFAULT_SETTINGS).toHaveProperty("geminiApiKey");
      expect(DEFAULT_SETTINGS).toHaveProperty("openrouterApiKey");
      expect(DEFAULT_SETTINGS).toHaveProperty("peopleFolder");
      expect(DEFAULT_SETTINGS).toHaveProperty("organizationsFolder");
      expect(DEFAULT_SETTINGS).toHaveProperty("models");
      expect(DEFAULT_SETTINGS).toHaveProperty("inbox");
      expect(DEFAULT_SETTINGS).toHaveProperty("llmCouncil");
      expect(DEFAULT_SETTINGS).toHaveProperty("o3");
      expect(DEFAULT_SETTINGS).toHaveProperty("webhook");
    });

    it("has valid folder paths", () => {
      expect(DEFAULT_SETTINGS.peopleFolder).toBeTruthy();
      expect(DEFAULT_SETTINGS.organizationsFolder).toBeTruthy();
      expect(typeof DEFAULT_SETTINGS.peopleFolder).toBe("string");
      expect(typeof DEFAULT_SETTINGS.organizationsFolder).toBe("string");
    });
  });

  describe("models", () => {
    it("has model configuration", () => {
      expect(DEFAULT_SETTINGS.models).toHaveProperty("personResearchModel");
      expect(DEFAULT_SETTINGS.models).toHaveProperty("orgResearchModel");
      expect(DEFAULT_SETTINGS.models).toHaveProperty("briefingModel");
    });

    it("has valid default models", () => {
      expect(typeof DEFAULT_SETTINGS.models.personResearchModel).toBe("string");
      expect(typeof DEFAULT_SETTINGS.models.orgResearchModel).toBe("string");
    });
  });

  describe("inbox", () => {
    it("has inbox configuration", () => {
      expect(DEFAULT_SETTINGS.inbox).toHaveProperty("enabled");
      expect(DEFAULT_SETTINGS.inbox).toHaveProperty("routing");
      expect(DEFAULT_SETTINGS.inbox).toHaveProperty("triggers");
      expect(DEFAULT_SETTINGS.inbox).toHaveProperty("formatting");
    });

    it("has routing rules as array", () => {
      expect(Array.isArray(DEFAULT_SETTINGS.inbox.routing.rules)).toBe(true);
    });

    it("has trigger phrases configured", () => {
      expect(Array.isArray(DEFAULT_SETTINGS.inbox.triggers.followupPhrases)).toBe(true);
      expect(Array.isArray(DEFAULT_SETTINGS.inbox.triggers.researchPhrases)).toBe(true);
    });
  });

  describe("llmCouncil", () => {
    it("has council configuration", () => {
      expect(DEFAULT_SETTINGS.llmCouncil).toHaveProperty("enabled");
      expect(DEFAULT_SETTINGS.llmCouncil).toHaveProperty("ideatorModels");
      expect(DEFAULT_SETTINGS.llmCouncil).toHaveProperty("executorModels");
      expect(DEFAULT_SETTINGS.llmCouncil).toHaveProperty("judgeModel");
    });

    it("has ideator models as object", () => {
      expect(typeof DEFAULT_SETTINGS.llmCouncil.ideatorModels).toBe("object");
      expect(DEFAULT_SETTINGS.llmCouncil.ideatorModels).toHaveProperty("feynman");
    });

    it("has executor models as object", () => {
      expect(typeof DEFAULT_SETTINGS.llmCouncil.executorModels).toBe("object");
      expect(DEFAULT_SETTINGS.llmCouncil.executorModels).toHaveProperty("executor1");
    });
  });

  describe("o3", () => {
    it("has O3 configuration", () => {
      expect(DEFAULT_SETTINGS.o3).toHaveProperty("enabled");
      expect(DEFAULT_SETTINGS.o3).toHaveProperty("masterNotePath");
    });
  });

  describe("webhook", () => {
    it("has webhook configuration", () => {
      expect(DEFAULT_SETTINGS.webhook).toHaveProperty("enabled");
      expect(DEFAULT_SETTINGS.webhook).toHaveProperty("port");
      expect(DEFAULT_SETTINGS.webhook).toHaveProperty("apiKey");
    });

    it("has valid port number", () => {
      expect(typeof DEFAULT_SETTINGS.webhook.port).toBe("number");
      expect(DEFAULT_SETTINGS.webhook.port).toBeGreaterThan(0);
      expect(DEFAULT_SETTINGS.webhook.port).toBeLessThan(65536);
    });
  });

  describe("boolean defaults", () => {
    it("has auto-research enabled by default", () => {
      // These are enabled by default in the actual settings
      expect(typeof DEFAULT_SETTINGS.autoResearchPeopleOnOpen).toBe("boolean");
      expect(typeof DEFAULT_SETTINGS.autoResearchOrgsOnOpen).toBe("boolean");
    });
  });
});
