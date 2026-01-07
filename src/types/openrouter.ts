// ============================================================================
// OpenRouter Types
// ============================================================================

export interface OpenRouterModelPricing {
  prompt: number;
  completion: number;
  request?: number;
  image?: number;
  web_search?: number;
  internal_reasoning?: number;
}

export interface OpenRouterModelArchitecture {
  modality?: string;
  input_modalities?: string[];
  output_modalities?: string[];
  tokenizer?: string;
  instruct_type?: string | null;
}

export interface OpenRouterModel {
  id: string;
  canonical_slug?: string;
  hugging_face_id?: string;
  name: string;
  description?: string;
  context_length: number;
  pricing: OpenRouterModelPricing;
  supported_parameters?: string[];
  per_request_limits?: Record<string, unknown> | null;
  architecture?: OpenRouterModelArchitecture;
}

export interface OpenRouterSettings {
  modelCache: OpenRouterModel[];
  lastFetched: string | null;
  selectedModels: string[];
  freeModelRank: string[];
  benchmarks: {
    arenaScores: Record<string, number>;
    openLlmScores: Record<string, number>;
    openLlmFetched: Record<string, string>;
    lastFetched: string | null;
  };
}
