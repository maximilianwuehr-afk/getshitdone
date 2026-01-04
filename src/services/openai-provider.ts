import { requestUrl, RequestUrlResponse } from "obsidian";
import type { PluginSettings } from "../types";
import type { AIProvider, AICallOptions } from "./ai-provider";
import { handleError, handleErrorWithDefault, getErrorMessage } from "../utils/error-handler";

/**
 * OpenAI Responses API Response Types
 */
interface ResponsesAPIResponse {
  id?: string;
  object?: string;
  created_at?: number;
  status?: string;
  background?: boolean;
  output?: Array<{
    id?: string;
    type?: string;
    status?: string;
    content?: Array<{
      type?: string;
      text?: string;
      annotations?: any[];
      logprobs?: any[];
    }>;
    role?: string;
    action?: any;
  }>;
  error?: {
    message: string;
  };
}

/**
 * OpenAI Provider
 * Implements AIProvider interface for OpenAI models
 */
export class OpenAIProvider implements AIProvider {
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
   * Call OpenAI API for AI-powered research
   */
  async callModel(
    system: string,
    user: string,
    model: string = "gpt-5",
    options: AICallOptions = {}
  ): Promise<string | null> {
    if (!this.settings.openaiApiKey) {
      console.warn("[GSD] No OpenAI API key configured");
      return null;
    }

    const url = "https://api.openai.com/v1/responses";

    try {
      // Combine system and user prompts into input (input should be a string, not an object)
      const input = system ? `${system}\n\n${user}` : user;

      // Request body format per OpenAI Responses API documentation
      // Use minimal request first to test if endpoint works
      const body: Record<string, any> = {
        model: model,
        input: input, // input is a string, not an object
      };

      // Add optional parameters conditionally
      // Note: Some combinations may cause timeouts, so we add them carefully
      
      // Add text options (verbosity) - only for GPT-5 models
      if (model.startsWith("gpt-5")) {
        body.text = {
          verbosity: "low",
        };
      }

      // Set reasoning with effort property (only if provided and for GPT-5)
      // Skip reasoning if web search is enabled to avoid conflicts
      if (model.startsWith("gpt-5") && options.thinkingBudget != null && !options.useSearch) {
        body.reasoning = {
          effort: options.thinkingBudget,
        };
      }

      // Enable web search using tools (only if requested)
      if (options.useSearch) {
        body.tools = [{ type: "web_search" }];
      }

      let response: RequestUrlResponse;
      try {
        response = await requestUrl({
          url: url,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.settings.openaiApiKey}`,
          },
          body: JSON.stringify(body),
        }) as RequestUrlResponse;
      } catch (error: unknown) {
        // Try to extract error message from Obsidian's requestUrl error format
        const errorData = error && typeof error === "object" && "json" in error
          ? (error as { json?: { error?: { message?: string }; message?: string } }).json
          : null;
        const errorMessage = errorData?.error?.message || errorData?.message || getErrorMessage(error);
        
        handleError("OpenAI API Request", error, {
          additionalContext: { model, url },
        });
        return null;
      }

      // Check for HTTP errors
      if (response.status !== 200) {
        const errorData = response.json as { error?: { message?: string }; message?: string } | null;
        const errorMessage = errorData?.error?.message || errorData?.message || `HTTP ${response.status}`;
        
        handleError("OpenAI API HTTP Error", new Error(errorMessage), {
          additionalContext: { status: response.status, model },
        });
        return null;
      }

      const data = response.json as ResponsesAPIResponse;
      if (data.error) {
        handleError("OpenAI API Response Error", new Error(data.error.message), {
          additionalContext: { model },
        });
        return null;
      }

      // Check if status is completed
      if (data.status && data.status !== "completed") {
        console.warn(`[GSD] Response status is "${data.status}", not "completed"`);
      }

      // Parse Responses API format: output is an array
      // Find the message item and extract text from content array
      if (data.output && Array.isArray(data.output)) {
        // Find the message item (type: "message")
        const messageItem = data.output.find(item => item.type === "message");
        if (messageItem && messageItem.content && Array.isArray(messageItem.content)) {
          // Find the output_text content item
          const textContent = messageItem.content.find(
            content => content.type === "output_text" && content.text
          );
          if (textContent && textContent.text) {
            return textContent.text;
          }
        }
      }

      // Fallback: try old formats for backward compatibility
      const dataAny = data as any;
      if (typeof dataAny.output_text === "string") {
        return dataAny.output_text;
      }

      console.warn("[GSD] OpenAI Response has no recognized output field");
      return null;
    } catch (error: unknown) {
      return handleErrorWithDefault(
        "OpenAI API Unexpected Error",
        error,
        null,
        { additionalContext: { model } }
      );
    }
  }
}
