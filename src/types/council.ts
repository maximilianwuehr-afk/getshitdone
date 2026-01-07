// ============================================================================
// LLM Council Types
// ============================================================================

import type { GenerationConfigSettings } from "./settings";

export interface LlmCouncilIdeatorPrompts {
  feynman: string;
  taleb: string;
  daVinci: string;
  fuller: string;
}

export interface LlmCouncilIdeatorModels {
  feynman: string;
  taleb: string;
  daVinci: string;
  fuller: string;
}

export interface LlmCouncilExecutorModels {
  executor1: string;
  executor2: string;
  executor3: string;
}

export interface LlmCouncilPrompts {
  ideators: LlmCouncilIdeatorPrompts;
  executor: string;
  judge: string;
}

export interface LlmCouncilGenerationConfigs {
  ideation: GenerationConfigSettings;
  execution: GenerationConfigSettings;
  judgment: GenerationConfigSettings;
}

export interface LlmCouncilSettings {
  enabled: boolean;
  runsPath: string;
  prompts: LlmCouncilPrompts;
  ideatorModels: LlmCouncilIdeatorModels;
  executorModels: LlmCouncilExecutorModels;
  judgeModel: string;
  generationConfig: LlmCouncilGenerationConfigs;
}

// ============================================================================
// LLM Council Result Types
// ============================================================================

export interface LlmCouncilIdea {
  run_id: string;
  phase: "ideas";
  persona_id: string;
  persona: string;
  thesis: string;
  plan_steps: Array<{
    step: string;
    rationale: string;
    mini_artifact: string;
  }>;
  risks: string[];
  anti_plan: string[];
  falsifiers: string[];
  sources: Array<{
    title?: string;
    url: string;
  }>;
  markdown_body?: string;
}

export interface LlmCouncilExecution {
  executorName: string;
  model: string;
  content: string;
  title: string;
}

export interface LlmCouncilJudgeScore {
  executor: string;
  raw_scores: Record<string, number>;
  weighted_total: number;
  notes: string;
}

export interface LlmCouncilJudgment {
  run_id: string;
  phase: "judge";
  rubric_weights: Record<string, number>;
  scores: LlmCouncilJudgeScore[];
  winner: string;
  synthesis: string;
  next_actions: string[];
  sources: Array<{
    title?: string;
    url: string;
  }>;
}

export interface LlmCouncilRunResult {
  runId: string;
  inputPath: string;
  ideas: LlmCouncilIdea[];
  executions: LlmCouncilExecution[];
  judgment: LlmCouncilJudgment | null;
  outputPath: string;
}
