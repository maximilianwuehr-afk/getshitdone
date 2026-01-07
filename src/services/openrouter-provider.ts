// ============================================================================
// OpenRouter Provider - Multi-model router implementation
// ============================================================================

import { requestUrl, RequestUrlResponse } from "obsidian";
import type { PluginSettings, OpenRouterModel } from "../types";
import type { AIProvider, AICallOptions } from "./ai-provider";
import { handleError, handleErrorWithDefault, getErrorMessage } from "../utils/error-handler";

// ============================================================================
// Types
// ============================================================================

interface OpenRouterChatResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message: string;
  };
}

type OpenRouterAttemptResult = {
  text: string | null;
  retryable: boolean;
};

// ============================================================================
// Constants
// ============================================================================

const AUTO_FREE_MODELS = new Set([
  "openrouter:auto-free",
  "openrouter:auto",
  "openrouter:free",
  "openrouter/free",
]);

/**
 * OpenRouter Provider
 * Implements AIProvider interface for OpenRouter models
 */
export class OpenRouterProvider implements AIProvider {
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
   * Call OpenRouter API for AI-powered research
   */
  async callModel(
    system: string,
    user: string,
    model: string,
    options: AICallOptions = {}
  ): Promise<string | null> {
    if (!this.settings.openrouterApiKey) {
      console.warn("[GSD] No OpenRouter API key configured");
      return null;
    }

    const trimmedModel = model?.trim();
    if (!trimmedModel) {
      console.warn("[GSD] OpenRouter model is empty");
      return null;
    }

    const isAutoFree = AUTO_FREE_MODELS.has(trimmedModel.toLowerCase());
    const candidates = isAutoFree ? this.getAutoFreeCandidates() : [trimmedModel];

    if (!candidates.length) {
      console.warn("[GSD] No OpenRouter models available for auto-free selection");
      return null;
    }

    for (const candidate of candidates) {
      if (!this.isModelSelected(candidate)) {
        continue;
      }
      const attempt = await this.callModelOnce(system, user, candidate, options);
      if (attempt.text) {
        return attempt.text;
      }
      if (!attempt.retryable || !isAutoFree) {
        return null;
      }
    }

    return null;
  }

  private async callModelOnce(
    system: string,
    user: string,
    model: string,
    options: AICallOptions
  ): Promise<OpenRouterAttemptResult> {
    const url = "https://openrouter.ai/api/v1/chat/completions";
    const metadata = this.getModelMetadata(model);

    try {
      const messages: Array<{ role: string; content: string }> = [];
      if (system) {
        messages.push({ role: "system", content: system });
      }
      messages.push({ role: "user", content: user });

      const body: Record<string, any> = {
        model: model,
        messages,
      };

      if (options.temperature != null) {
        body.temperature = Math.max(0.0, Math.min(2.0, options.temperature));
      }

      if (options.maxOutputTokens != null) {
        body.max_tokens = options.maxOutputTokens;
      }

      if (options.thinkingBudget != null && this.supportsParam(metadata, "reasoning")) {
        body.reasoning = { effort: options.thinkingBudget };
      }

      if (options.useSearch) {
        if (!metadata || this.supportsParam(metadata, "tools")) {
          body.tools = [{ type: "web_search" }];
        } else {
          console.warn(`[GSD] OpenRouter model ${model} does not support tools/web_search`);
        }
      }

      let response: RequestUrlResponse;
      try {
        response = await requestUrl({
          url,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.settings.openrouterApiKey}`,
            "HTTP-Referer": "https://obsidian.md",
            "X-Title": "GetShitDone",
          },
          body: JSON.stringify(body),
        }) as RequestUrlResponse;
      } catch (error: unknown) {
        const errorData = error && typeof error === "object" && "json" in error
          ? (error as { json?: { error?: { message?: string }; message?: string } }).json
          : null;
        const errorMessage = errorData?.error?.message || errorData?.message || getErrorMessage(error);

        handleError("OpenRouter API Request", error, {
          additionalContext: { model, url },
        });
        return { text: null, retryable: this.isRetryableError(errorMessage) };
      }

      if (response.status !== 200) {
        const errorData = response.json as { error?: { message?: string }; message?: string } | null;
        const errorMessage = errorData?.error?.message || errorData?.message || `HTTP ${response.status}`;
        handleError("OpenRouter API HTTP Error", new Error(errorMessage), {
          additionalContext: { status: response.status, model },
        });
        return { text: null, retryable: response.status === 429 || this.isRetryableError(errorMessage) };
      }

      const data = response.json as OpenRouterChatResponse;
      if (data.error) {
        handleError("OpenRouter API Response Error", new Error(data.error.message), {
          additionalContext: { model },
        });
        return { text: null, retryable: this.isRetryableError(data.error.message) };
      }

      if (data.choices && data.choices.length > 0) {
        const content = data.choices[0]?.message?.content;
        if (typeof content === "string" && content.length > 0) {
          return { text: content, retryable: false };
        }
      }

      console.warn("[GSD] OpenRouter response had no message content");
      return { text: null, retryable: false };
    } catch (error: unknown) {
      return {
        text: handleErrorWithDefault(
          "OpenRouter API Unexpected Error",
          error,
          null,
          { additionalContext: { model } }
        ),
        retryable: false,
      };
    }
  }

  private getAutoFreeCandidates(): string[] {
    const ranked = this.settings.openrouter?.freeModelRank ?? [];
    if (ranked.length) {
      const rankedFree = ranked.filter((id) => {
        const model = this.getModelMetadata(id);
        return model ? this.isFreeModel(model) : true;
      });
      if (rankedFree.length) {
        return rankedFree;
      }
    }

    const selected = this.settings.openrouter?.selectedModels ?? [];
    const selectedFree = selected.filter((id) => {
      const model = this.getModelMetadata(id);
      return model ? this.isFreeModel(model) : false;
    });
    if (selectedFree.length) {
      return selectedFree;
    }

    const cache = this.settings.openrouter?.modelCache ?? [];
    return cache
      .filter((model) => this.isFreeModel(model))
      .sort((a, b) => b.context_length - a.context_length)
      .map((model) => model.id);
  }

  private getModelMetadata(modelId: string): OpenRouterModel | undefined {
    return this.settings.openrouter?.modelCache?.find((model) => model.id === modelId);
  }

  private supportsParam(model: OpenRouterModel | undefined, param: string): boolean {
    if (!model?.supported_parameters) return false;
    return model.supported_parameters.includes(param);
  }

  private isFreeModel(model: OpenRouterModel): boolean {
    return model.pricing.prompt === 0 && model.pricing.completion === 0;
  }

  private isRetryableError(message: string | null | undefined): boolean {
    if (!message) return false;
    const normalized = message.toLowerCase();
    return normalized.includes("rate limit") || normalized.includes("quota");
  }

  private isModelSelected(modelId: string): boolean {
    const selected = this.settings.openrouter?.selectedModels ?? [];
    const ranked = this.settings.openrouter?.freeModelRank ?? [];
    if (selected.length === 0) return true;
    const lower = modelId.toLowerCase();
    if (selected.some((id) => id.toLowerCase() === lower)) {
      return true;
    }
    return ranked.some((id) => id.toLowerCase() === lower);
  }
}
