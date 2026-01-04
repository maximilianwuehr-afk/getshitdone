import type { PluginSettings } from "../types";
import type { AIProvider, AICallOptions } from "./ai-provider";
import { GeminiProvider } from "./gemini-provider";
import { OpenAIProvider } from "./openai-provider";
import { AnthropicProvider } from "./anthropic-provider";

/**
 * AI Service
 * Factory/router that detects the provider from model name and routes calls appropriately
 */
export class AIService {
  private settings: PluginSettings;
  private geminiProvider: GeminiProvider;
  private openaiProvider: OpenAIProvider;
  private anthropicProvider: AnthropicProvider;

  constructor(settings: PluginSettings) {
    this.settings = settings;
    this.geminiProvider = new GeminiProvider(settings);
    this.openaiProvider = new OpenAIProvider(settings);
    this.anthropicProvider = new AnthropicProvider(settings);
  }

  /**
   * Update settings reference (called when settings change)
   */
  updateSettings(settings: PluginSettings): void {
    this.settings = settings;
    this.geminiProvider.updateSettings(settings);
    this.openaiProvider.updateSettings(settings);
    this.anthropicProvider.updateSettings(settings);
  }

  /**
   * Detect provider from model name
   * @param model Model identifier
   * @returns Provider type: "gemini" | "openai" | "anthropic"
   */
  private detectProvider(model: string): "gemini" | "openai" | "anthropic" {
    const modelLower = model.toLowerCase();
    
    // Anthropic models: claude-*
    if (modelLower.startsWith("claude-")) {
      return "anthropic";
    }
    
    // OpenAI models: gpt-*, o1-*, o3-*
    if (modelLower.startsWith("gpt-") || 
        modelLower.startsWith("o1-") || 
        modelLower.startsWith("o3-")) {
      return "openai";
    }
    
    // Gemini models: anything containing "gemini"
    if (modelLower.includes("gemini")) {
      return "gemini";
    }
    
    // Default to Gemini for backward compatibility
    console.warn(`[GSD] Could not detect provider for model "${model}", defaulting to Gemini`);
    return "gemini";
  }

  /**
   * Get the appropriate provider for a model
   */
  private getProvider(model: string): AIProvider {
    const provider = this.detectProvider(model);
    if (provider === "openai") {
      return this.openaiProvider;
    } else if (provider === "anthropic") {
      return this.anthropicProvider;
    } else {
      return this.geminiProvider;
    }
  }

  /**
   * Call the AI model with system and user prompts
   * Automatically routes to the correct provider based on model name
   * 
   * @param system System prompt/instructions
   * @param user User prompt/content
   * @param model Model identifier (e.g., "gemini-pro-latest", "gpt-4o")
   * @param options Generation options
   * @returns Generated text or null if failed
   */
  async callModel(
    system: string,
    user: string,
    model: string,
    options?: AICallOptions
  ): Promise<string | null> {
    const provider = this.getProvider(model);
    return provider.callModel(system, user, model, options);
  }
}
