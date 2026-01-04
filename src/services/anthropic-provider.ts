import { requestUrl, RequestUrlResponse } from "obsidian";
import type { PluginSettings } from "../types";
import type { AIProvider, AICallOptions } from "./ai-provider";
import { handleErrorWithDefault, handleError, getErrorMessage } from "../utils/error-handler";

/**
 * Anthropic API Response Types
 */
interface AnthropicResponse {
  id?: string;
  type?: string;
  role?: string;
  content: Array<{
    type: string;
    text?: string;
  }>;
  model?: string;
  stop_reason?: string;
  stop_sequence?: string | null;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
  error?: {
    type: string;
    message: string;
  };
}

/**
 * Anthropic Provider
 * Implements AIProvider interface for Anthropic Claude models
 */
export class AnthropicProvider implements AIProvider {
  private settings: PluginSettings;

  constructor(settings: PluginSettings) {
    this.settings = settings;
  }

  /**
   * Update settings reference (called when settings change)
   */
  updateSettings(settings: PluginSettings): void {
    this.settings = settings;
  }

  /**
   * Call Anthropic API for AI-powered research
   */
  async callModel(
    system: string,
    user: string,
    model: string = "claude-sonnet-4-5-20250929",
    options: AICallOptions = {}
  ): Promise<string | null> {
    if (!this.settings.anthropicApiKey) {
      console.warn("[GSD] No Anthropic API key configured");
      return null;
    }

    const url = "https://api.anthropic.com/v1/messages";

    try {
      // Build headers
      const headers: Record<string, string> = {
        "x-api-key": this.settings.anthropicApiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      };

      // Build request body
      const body: Record<string, any> = {
        model: model,
        max_tokens: options.maxOutputTokens ?? 4096,
        messages: [
          {
            role: "user",
            content: user,
          },
        ],
      };

      // Add temperature if provided (Anthropic supports 0.0-1.0)
      if (options.temperature != null) {
        body.temperature = Math.max(0.0, Math.min(1.0, options.temperature));
      }

      // Add system prompt as separate field (Anthropic uses system field, not system role)
      if (system) {
        body.system = system;
      }

      // Add web search tool if requested
      if (options.useSearch) {
        body.tools = [
          {
            type: "web_search_20250305",
            name: "web_search",
            max_uses: 5,
          },
        ];
      }

      // Add effort parameter for Opus 4.5 models only
      // Check if model name contains "claude-opus-4-5"
      const isOpus45 = model.toLowerCase().includes("claude-opus-4-5");
      if (isOpus45 && options.thinkingBudget != null) {
        body.output_config = {
          effort: options.thinkingBudget,
        };
        // Add beta header for effort parameter
        headers["anthropic-beta"] = "effort-2025-11-24";
      }

      let response: RequestUrlResponse;
      try {
        response = await requestUrl({
          url: url,
          method: "POST",
          headers: headers,
          body: JSON.stringify(body),
        }) as RequestUrlResponse;
      } catch (error: unknown) {
        // Try to extract error message from Obsidian's requestUrl error format
        const errorData = error && typeof error === "object" && "json" in error
          ? (error as { json?: { error?: { message?: string }; message?: string } }).json
          : null;
        const errorMessage = errorData?.error?.message || errorData?.message || getErrorMessage(error);
        
        handleError("Anthropic API Request", error, {
          additionalContext: { model, url },
        });
        return null;
      }

      // Check for HTTP errors
      if (response.status !== 200) {
        const errorData = response.json as { error?: { message?: string; type?: string }; message?: string } | null;
        const errorMessage = errorData?.error?.message || errorData?.message || `HTTP ${response.status}`;
        
        handleError("Anthropic API HTTP Error", new Error(errorMessage), {
          additionalContext: { status: response.status, model },
        });
        return null;
      }

      const data = response.json as AnthropicResponse;
      if (data.error) {
        handleError("Anthropic API Response Error", new Error(data.error.message), {
          additionalContext: { model, errorType: data.error.type },
        });
        return null;
      }

      // Extract text from content array
      // Anthropic returns content as an array of blocks, each with type and text
      if (data.content && Array.isArray(data.content)) {
        const textBlocks = data.content
          .filter((block) => block.type === "text" && block.text)
          .map((block) => block.text as string);
        
        if (textBlocks.length > 0) {
          return textBlocks.join("");
        }
      }

      console.warn("[GSD] Anthropic Response has no recognized text content");
      return null;
    } catch (error: unknown) {
      return handleErrorWithDefault(
        "Anthropic API Unexpected Error",
        error,
        null,
        { additionalContext: { model } }
      );
    }
  }
}
