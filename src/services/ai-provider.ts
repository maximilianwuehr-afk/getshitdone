/**
 * AI Provider Interface
 * Defines the contract for AI model providers (Gemini, OpenAI, etc.)
 */

export interface AICallOptions {
  /**
   * Enable web search (Gemini: Google Search, OpenAI: web_search_options for gpt-4o+, Anthropic: web_search_20250305 tool)
   */
  useSearch?: boolean;
  
  /**
   * Temperature for generation (0.0 - 2.0)
   */
  temperature?: number;
  
  /**
   * Maximum output tokens
   */
  maxOutputTokens?: number;
  
  /**
   * Reasoning effort level (low/medium/high).
   * - For Gemini: Maps to thinkingBudget tokens
   * - For OpenAI o1/o3 models: Maps to reasoning_effort parameter
   * - For Anthropic Opus 4.5: Maps to output_config.effort parameter
   */
  thinkingBudget?: "low" | "medium" | "high" | null;
}

/**
 * AI Provider interface
 * All AI providers must implement this interface
 */
export interface AIProvider {
  /**
   * Call the AI model with system and user prompts
   * @param system System prompt/instructions
   * @param user User prompt/content
   * @param model Model identifier (e.g., "gemini-pro-latest", "gpt-4o")
   * @param options Generation options
   * @returns Generated text or null if failed
   */
  callModel(
    system: string,
    user: string,
    model: string,
    options?: AICallOptions
  ): Promise<string | null>;
}
