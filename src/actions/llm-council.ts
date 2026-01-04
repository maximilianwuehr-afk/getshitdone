import { App, TFile, Notice } from "obsidian";
import type {
  PluginSettings,
  LlmCouncilRunResult,
} from "../types";
import { AIService } from "../services/ai-service";
import { CouncilRunnerService } from "../services/council-runner";
import { handleError } from "../utils/error-handler";

/**
 * LLM Council Action
 * Orchestrates the full council pipeline: Ideators → Executors → Judge
 */
export class LlmCouncilAction {
  private app: App;
  private settings: PluginSettings;
  private aiService: AIService;
  private runner: CouncilRunnerService;
  private inFlight: Set<string> = new Set();

  constructor(
    app: App,
    settings: PluginSettings,
    aiService: AIService
  ) {
    this.app = app;
    this.settings = settings;
    this.aiService = aiService;
    this.runner = new CouncilRunnerService(app, settings, aiService);
  }

  /**
   * Update settings reference
   */
  updateSettings(settings: PluginSettings): void {
    this.settings = settings;
    this.runner.updateSettings(settings);
  }

  /**
   * Run the LLM Council on the current active note
   */
  async runCouncil(): Promise<LlmCouncilRunResult | null> {
    // Check if enabled
    if (!this.settings.llmCouncil.enabled) {
      new Notice("LLM Council is disabled in settings");
      return null;
    }

    // Get active file
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice("No active file to run council on");
      return null;
    }

    // Prevent duplicate runs on same file
    if (this.inFlight.has(file.path)) {
      new Notice("Council already running on this file");
      return null;
    }

    this.inFlight.add(file.path);

    try {
      return await this.executeCouncil(file);
    } finally {
      this.inFlight.delete(file.path);
    }
  }

  /**
   * Execute the full council pipeline
   */
  private async executeCouncil(file: TFile): Promise<LlmCouncilRunResult | null> {
    const runId = this.runner.generateRunId();
    
    new Notice(`🧠 LLM Council starting (${runId})...`);
    console.log(`[GSD] Council: Starting run ${runId} for ${file.path}`);

    try {
      // Step 1: Initialize run directory
      const runPath = await this.runner.createRunDirectory(runId);
      console.log(`[GSD] Council: Created run directory at ${runPath}`);

      // Step 2: Read and save input
      const input = await this.app.vault.read(file);
      const inputPath = await this.runner.saveInput(runPath, input);
      console.log(`[GSD] Council: Saved input to ${inputPath}`);

      // Step 3: Run ideators in parallel
      new Notice("🧠 Running ideators (0/5)...");
      const ideas = await this.runner.runIdeators(
        runId,
        runPath,
        input,
        (completed, total) => {
          new Notice(`🧠 Running ideators (${completed}/${total})...`);
        }
      );
      
      if (ideas.length === 0) {
        new Notice("❌ All ideators failed. Check console for details.");
        console.error("[GSD] Council: All ideators failed");
        return null;
      }

      new Notice(`✅ Ideation complete (${ideas.length}/5 succeeded)`);
      console.log(`[GSD] Council: Ideation complete with ${ideas.length} ideas`);

      // Step 4: Run executors in parallel
      new Notice("⚡ Running executors (0/3)...");
      const executions = await this.runner.runExecutors(
        runId,
        runPath,
        input,
        ideas,
        (completed, total) => {
          new Notice(`⚡ Running executors (${completed}/${total})...`);
        }
      );

      if (executions.length === 0) {
        new Notice("❌ All executors failed. Check console for details.");
        console.error("[GSD] Council: All executors failed");
        return null;
      }

      new Notice(`✅ Execution complete (${executions.length}/3 succeeded)`);
      console.log(`[GSD] Council: Execution complete with ${executions.length} deliverables`);

      // Step 5: Run judge
      new Notice("⚖️ Running judge...");
      const judgment = await this.runner.runJudge(
        runId,
        runPath,
        input,
        ideas,
        executions
      );

      if (judgment) {
        new Notice("✅ Judgment complete");
        console.log(`[GSD] Council: Judge selected winner: ${judgment.winner}`);
      } else {
        new Notice("⚠️ Judge failed, but results are still available");
        console.warn("[GSD] Council: Judge failed");
      }

      // Step 6: Generate output summary
      const outputPath = await this.runner.generateOutput(
        runPath,
        runId,
        ideas,
        executions,
        judgment
      );
      console.log(`[GSD] Council: Output saved to ${outputPath}`);

      // Step 7: Append callout to original note
      const callout = this.runner.generateCallout(runId, runPath, judgment);
      await this.appendToNote(file, callout);

      const result: LlmCouncilRunResult = {
        runId,
        inputPath,
        ideas,
        executions,
        judgment,
        outputPath,
      };

      new Notice(`🎉 LLM Council complete! Winner: ${judgment?.winner || "N/A"}`);
      console.log(`[GSD] Council: Run ${runId} complete`);

      return result;
    } catch (error) {
      handleError("LLM Council failed", error, {
        showNotice: true,
        noticeMessage: "LLM Council failed - check console for details",
        additionalContext: { runId, file: file.path },
      });
      return null;
    }
  }

  /**
   * Append content to the end of a note
   */
  private async appendToNote(file: TFile, content: string): Promise<void> {
    const currentContent = await this.app.vault.read(file);
    const newContent = currentContent + "\n" + content;
    await this.app.vault.modify(file, newContent);
  }
}
