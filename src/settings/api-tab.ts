// ============================================================================
// API Tab - Keys, endpoints, webhook, and diagnostics
// ============================================================================

import { Setting, Notice } from "obsidian";
import type GetShitDonePlugin from "../main";
import { GoogleServices } from "../services/google-services";
import { createSection, addSecretSetting } from "./helpers";

// ============================================================================
// Public API
// ============================================================================

export function renderApiTab(
  containerEl: HTMLElement,
  plugin: GetShitDonePlugin
): void {
  containerEl.createEl("p", {
    text: "Keys, endpoints, and external service connections.",
    cls: "setting-item-description",
  });

  renderApiConfig(containerEl, plugin);
  renderWebhook(containerEl, plugin);
  renderDiagnostics(containerEl, plugin);
}

// ============================================================================
// Private Helpers
// ============================================================================

function renderApiConfig(containerEl: HTMLElement, plugin: GetShitDonePlugin): void {
  createSection(
    containerEl,
    "API Providers",
    "Keys for Gemini, OpenAI, Anthropic, and OpenRouter."
  );

  const statusLine = [
    plugin.settings.geminiApiKey ? "Gemini ✓" : "Gemini ✕",
    plugin.settings.openaiApiKey ? "OpenAI ✓" : "OpenAI ✕",
    plugin.settings.anthropicApiKey ? "Anthropic ✓" : "Anthropic ✕",
    plugin.settings.openrouterApiKey ? "OpenRouter ✓" : "OpenRouter ✕",
  ].join(" · ");
  containerEl.createEl("p", {
    text: `Configured: ${statusLine}`,
    cls: "setting-item-description",
  });

  addSecretSetting(containerEl, {
    name: "Gemini API Key",
    desc: "API key for Google Gemini",
    placeholder: "AI... or your Gemini key",
    value: plugin.settings.geminiApiKey,
    onChange: async (value) => {
      plugin.settings.geminiApiKey = value;
      await plugin.saveSettings();
    },
  });

  addSecretSetting(containerEl, {
    name: "OpenAI API Key",
    desc: "API key for OpenAI (optional, for GPT models)",
    placeholder: "sk-...",
    value: plugin.settings.openaiApiKey,
    onChange: async (value) => {
      plugin.settings.openaiApiKey = value;
      await plugin.saveSettings();
    },
  });

  addSecretSetting(containerEl, {
    name: "OpenRouter API Key",
    desc: "API key for OpenRouter (optional, for router models)",
    placeholder: "sk-or-...",
    value: plugin.settings.openrouterApiKey,
    onChange: async (value) => {
      plugin.settings.openrouterApiKey = value;
      await plugin.saveSettings();
    },
  });

  addSecretSetting(containerEl, {
    name: "Anthropic API Key",
    desc: "API key for Anthropic (optional, for Claude models)",
    placeholder: "sk-ant-...",
    value: plugin.settings.anthropicApiKey,
    onChange: async (value) => {
      plugin.settings.anthropicApiKey = value;
      await plugin.saveSettings();
    },
  });

  createSection(
    containerEl,
    "Google Apps Script",
    "Gmail/Docs access for meeting briefs and research."
  );

  new Setting(containerEl)
    .setName("Apps Script URL")
    .setDesc("URL for the Google Apps Script that handles Gmail/Docs access")
    .addText((text) =>
      text
        .setPlaceholder("https://script.google.com/...")
        .setValue(plugin.settings.appsScriptUrl)
        .onChange(async (value) => {
          plugin.settings.appsScriptUrl = value;
          await plugin.saveSettings();
        })
    );

  addSecretSetting(containerEl, {
    name: "Apps Script Secret",
    desc: "Secret token for authenticating with the Apps Script",
    placeholder: "Enter secret",
    value: plugin.settings.appsScriptSecret,
    onChange: async (value) => {
      plugin.settings.appsScriptSecret = value;
      await plugin.saveSettings();
    },
  });
}

function renderWebhook(containerEl: HTMLElement, plugin: GetShitDonePlugin): void {
  createSection(
    containerEl,
    "Webhook Server",
    "HTTP server for receiving external webhooks (e.g., Amie meeting transcripts via QStash)."
  );

  new Setting(containerEl)
    .setName("Enable Webhook Server")
    .setDesc("Start an HTTP server for receiving webhooks when Obsidian loads")
    .addToggle((toggle) =>
      toggle
        .setValue(plugin.settings.webhook.enabled)
        .onChange(async (value) => {
          plugin.settings.webhook.enabled = value;
          await plugin.saveSettings();
          if (value) {
            new Notice("Webhook server will start on next Obsidian reload");
          } else {
            new Notice("Webhook server will stop on next Obsidian reload");
          }
        })
    );

  new Setting(containerEl)
    .setName("Port")
    .setDesc("HTTP port for the webhook server (default: 3456)")
    .addText((text) =>
      text
        .setPlaceholder("3456")
        .setValue(String(plugin.settings.webhook.port))
        .onChange(async (value) => {
          const port = parseInt(value, 10);
          if (!isNaN(port) && port > 0 && port < 65536) {
            plugin.settings.webhook.port = port;
            await plugin.saveSettings();
          }
        })
    );

  addSecretSetting(containerEl, {
    name: "API Key",
    desc: "Secret key for authenticating webhook requests (required)",
    placeholder: "Enter a secure API key",
    value: plugin.settings.webhook.apiKey,
    onChange: async (value) => {
      plugin.settings.webhook.apiKey = value;
      await plugin.saveSettings();
    },
  });

  new Setting(containerEl)
    .setName("Bind Address")
    .setDesc("Network interface to bind to (127.0.0.1 = localhost only, 0.0.0.0 = all interfaces)")
    .addDropdown((dropdown) =>
      dropdown
        .addOption("127.0.0.1", "127.0.0.1 (localhost only)")
        .addOption("0.0.0.0", "0.0.0.0 (all interfaces)")
        .setValue(plugin.settings.webhook.bindAddress)
        .onChange(async (value) => {
          plugin.settings.webhook.bindAddress = value as "127.0.0.1" | "0.0.0.0";
          await plugin.saveSettings();
        })
    );

  const serverStatus = plugin.webhookServer?.isRunning?.() ? "Running" : "Stopped";
  const serverPort = plugin.settings.webhook.port;
  new Setting(containerEl)
    .setName("Server Status")
    .setDesc(
      `Status: ${serverStatus}${serverStatus === "Running" ? ` on port ${serverPort}` : ""}`
    )
    .addButton((button) =>
      button
        .setButtonText(serverStatus === "Running" ? "Stop Server" : "Start Server")
        .onClick(async () => {
          if (plugin.webhookServer?.isRunning?.()) {
            plugin.webhookServer.stop();
            new Notice("Webhook server stopped");
          } else {
            if (!plugin.settings.webhook.apiKey) {
              new Notice("Please set an API key first");
              return;
            }
            await plugin.webhookServer?.start();
            new Notice(`Webhook server started on port ${plugin.settings.webhook.port}`);
          }
          // Trigger re-render
          plugin.settingTab?.display();
        })
    );
}

function renderDiagnostics(containerEl: HTMLElement, plugin: GetShitDonePlugin): void {
  createSection(
    containerEl,
    "Diagnostics",
    "Tools to verify Apps Script access to Google Drive attachments (Docs/Sheets/etc)."
  );

  let driveUrlOrId = "";
  const driveTestSetting = new Setting(containerEl)
    .setName("Test Google Drive access")
    .setDesc("Paste a Google Drive URL or fileId, then click Test access.");

  driveTestSetting.addText((text) =>
    text
      .setPlaceholder("https://docs.google.com/... or fileId")
      .onChange((value) => {
        driveUrlOrId = value;
      })
  );

  driveTestSetting.addButton((button) =>
    button.setButtonText("Test access").onClick(async () => {
      if (!plugin.settings.appsScriptUrl) {
        new Notice("Set Apps Script URL first (GetShitDone settings → API & Integration).");
        return;
      }

      const aiService = plugin.getAIService();
      const google = new GoogleServices(plugin.settings, aiService);
      const fileId = google.extractDriveFileId(driveUrlOrId);

      if (!fileId) {
        new Notice("Could not extract a Google Drive fileId from the input.");
        return;
      }

      new Notice("Testing Google Drive access…");

      const text = await google.getDocContent(fileId);
      if (!text) {
        new Notice(`Drive access FAILED (fileId=${fileId}).`);
        return;
      }

      if (text.startsWith("[Error reading doc:")) {
        new Notice(`Drive access FAILED (fileId=${fileId}): ${text}`);
        return;
      }

      const chars = text.length;
      const truncationHint = text.includes("[truncated]")
        ? " (Apps Script truncated output)"
        : "";

      if (text.startsWith("[File type")) {
        new Notice(
          `Drive access OK but not extractable as text (fileId=${fileId}, chars=${chars})${truncationHint}`
        );
        return;
      }

      new Notice(`Drive access OK (fileId=${fileId}, chars=${chars})${truncationHint}`);
    })
  );
}
