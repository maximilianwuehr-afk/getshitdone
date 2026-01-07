// ============================================================================
// Webhook Server - HTTP server for Amie transcripts and external webhooks
// ============================================================================

import * as http from "http";
import { Notice } from "obsidian";
import type { PluginSettings, AmieWebhookPayload } from "../types";
import type { AmieTranscriptAction } from "../actions/amie-transcript";

// ============================================================================
// WebhookServer Class
// ============================================================================

/**
 * HTTP webhook server for receiving external requests.
 * Handles Amie meeting transcript webhooks via QStash.
 */
export class WebhookServer {
  private server: http.Server | null = null;
  private settings: PluginSettings;
  private amieTranscript: AmieTranscriptAction;
  private processedMessageIds: Set<string> = new Set();
  private readonly MESSAGE_ID_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

  constructor(settings: PluginSettings, amieTranscript: AmieTranscriptAction) {
    this.settings = settings;
    this.amieTranscript = amieTranscript;
  }

  /**
   * Update settings reference (called when settings change)
   */
  updateSettings(settings: PluginSettings): void {
    this.settings = settings;
  }

  /**
   * Check if the server is currently running
   */
  isRunning(): boolean {
    return this.server !== null && this.server.listening;
  }

  /**
   * Start the HTTP server
   */
  async start(): Promise<void> {
    if (this.isRunning()) {
      console.log("[WebhookServer] Server already running");
      return;
    }

    if (!this.settings.webhook.apiKey) {
      console.error("[WebhookServer] Cannot start: API key not configured");
      new Notice("Webhook server: API key required");
      return;
    }

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this.handleRequest(req, res));

      this.server.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
          console.error(`[WebhookServer] Port ${this.settings.webhook.port} is already in use`);
          new Notice(`Webhook server: Port ${this.settings.webhook.port} in use`);
        } else {
          console.error("[WebhookServer] Server error:", err);
        }
        reject(err);
      });

      this.server.listen(
        this.settings.webhook.port,
        this.settings.webhook.bindAddress,
        () => {
          console.log(
            `[WebhookServer] Started on ${this.settings.webhook.bindAddress}:${this.settings.webhook.port}`
          );
          resolve();
        }
      );
    });
  }

  /**
   * Stop the HTTP server
   */
  stop(): void {
    if (this.server) {
      this.server.close(() => {
        console.log("[WebhookServer] Server stopped");
      });
      this.server = null;
    }
  }

  /**
   * Handle incoming HTTP requests
   */
  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    // Set CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    // Handle preflight
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    const path = url.pathname;

    // Route handling
    if (path === "/webhook/amie" && req.method === "POST") {
      await this.handleAmieWebhook(req, res);
    } else if (path === "/health" && req.method === "GET") {
      this.sendJson(res, 200, { status: "ok", timestamp: new Date().toISOString() });
    } else {
      this.sendJson(res, 404, { error: "Not found" });
    }
  }

  /**
   * Handle Amie webhook POST request
   */
  private async handleAmieWebhook(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    // Validate API key
    const authHeader = req.headers.authorization;
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    const queryApiKey = url.searchParams.get("api_key");

    const providedKey = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7)
      : queryApiKey;

    if (!providedKey || providedKey !== this.settings.webhook.apiKey) {
      this.sendJson(res, 401, { error: "Unauthorized" });
      return;
    }

    // Check for QStash deduplication
    const messageId = req.headers["upstash-message-id"] as string | undefined;
    if (messageId && this.processedMessageIds.has(messageId)) {
      console.log(`[WebhookServer] Duplicate message ignored: ${messageId}`);
      this.sendJson(res, 200, { status: "duplicate", messageId });
      return;
    }

    // Parse request body
    let body: AmieWebhookPayload;
    try {
      const rawBody = await this.readBody(req);
      body = JSON.parse(rawBody);
    } catch (err) {
      console.error("[WebhookServer] Invalid JSON body:", err);
      this.sendJson(res, 400, { error: "Invalid JSON body" });
      return;
    }

    // Validate required fields
    if (!body.metadata?.providerCalendarEventId || !body.transcript) {
      this.sendJson(res, 400, { error: "Missing required fields: metadata.providerCalendarEventId, transcript" });
      return;
    }

    // Track message ID for deduplication
    if (messageId) {
      this.processedMessageIds.add(messageId);
      // Clean up old message IDs after TTL
      setTimeout(() => {
        this.processedMessageIds.delete(messageId);
      }, this.MESSAGE_ID_TTL_MS);
    }

    // Process the transcript
    try {
      console.log(`[WebhookServer] Processing Amie webhook for event: ${body.metadata.providerCalendarEventId}`);
      const result = await this.amieTranscript.processTranscript(body);

      this.sendJson(res, 200, {
        status: "success",
        messageId,
        notePath: result.notePath,
        action: result.action,
      });
    } catch (err) {
      console.error("[WebhookServer] Error processing transcript:", err);
      this.sendJson(res, 500, { error: "Failed to process transcript" });
    }
  }

  /**
   * Read request body as string
   */
  private readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      req.on("error", reject);
    });
  }

  /**
   * Send JSON response
   */
  private sendJson(res: http.ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  }
}
