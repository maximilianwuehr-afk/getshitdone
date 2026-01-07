// ============================================================================
// Gemini Provider - Google Gemini AI model implementation
// ============================================================================

import { requestUrl, RequestUrlResponse } from "obsidian";
import type { PluginSettings, GeminiResponse } from "../types";
import type { AIProvider, AICallOptions } from "./ai-provider";
import { handleErrorWithDefault } from "../utils/error-handler";

// ============================================================================
// GeminiProvider Class
// ============================================================================

/**
 * Gemini Provider
 * Implements AIProvider interface for Google Gemini models
 */
export class GeminiProvider implements AIProvider {
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
   * Call Gemini API for AI-powered research
   */
  async callModel(
    system: string,
    user: string,
    model: string = "gemini-flash-latest",
    options: AICallOptions = {}
  ): Promise<string | null> {
    if (!this.settings.geminiApiKey) {
      console.warn("[GSD] No Gemini API key configured");
      return null;
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.settings.geminiApiKey}`;
    const tools = options.useSearch ? [{ googleSearch: {} }] : [];

    try {
      // Default generation config
      const generationConfig: Record<string, any> = {
        temperature: options.temperature ?? 0.2,
        ...(options.maxOutputTokens ? { maxOutputTokens: options.maxOutputTokens } : {}),
      };

      // Map reasoning effort level to thinkingBudget tokens
      // (Only supported by some Gemini models; unsupported configs will error at runtime.)
      if (options.thinkingBudget != null) {
        const tokenMap: Record<"low" | "medium" | "high", number> = {
          low: 512,
          medium: 2048,
          high: 4096,
        };
        const tokenBudget = tokenMap[options.thinkingBudget];
        if (tokenBudget) {
          generationConfig.thinkingConfig = { thinkingBudget: tokenBudget };
        }
      }

      const response: RequestUrlResponse = await requestUrl({
        url: url,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: system + "\n\nUser Input:\n" + user }] }],
          tools: tools,
          generationConfig,
        }),
      });

      const data = response.json as GeminiResponse;
      if (
        data.candidates &&
        data.candidates.length > 0 &&
        data.candidates[0].content &&
        data.candidates[0].content.parts
      ) {
        return data.candidates[0].content.parts.map((p) => p.text).join("");
      }
      return null;
    } catch (error: unknown) {
      return handleErrorWithDefault(
        "Gemini API Error",
        error,
        null,
        { additionalContext: { model } }
      );
    }
  }
}
