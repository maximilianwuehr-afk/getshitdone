import { App, TFile, TFolder, Notice, parseYaml } from "obsidian";
import type {
  PluginSettings,
  LlmCouncilIdea,
  LlmCouncilExecution,
  LlmCouncilJudgment,
  LlmCouncilRunResult,
  LlmCouncilIdeatorPrompts,
  GenerationConfigSettings,
} from "../types";
import { AIService } from "./ai-service";

const moment = (window as any).moment;

/**
 * Pre-process YAML string to quote array items containing special characters
 * This handles cases where models output **bold** markdown or colons in array items
 */
function sanitizeYamlArrayItems(yamlStr: string): string {
  return yamlStr
    // Quote array items that start with ** (bold markdown)
    .replace(/^(\s*-\s+)(\*\*.+)$/gm, (_, prefix, content) => {
      if (content.startsWith('"') || content.startsWith("'")) return prefix + content;
      return `${prefix}"${content.replace(/"/g, '\\"')}"`;
    })
    // Quote ALL unquoted title values (they often contain colons)
    .replace(/^(\s*title:\s*)([^"'\n].*)$/gm, (_, prefix, content) => {
      return `${prefix}"${content.replace(/"/g, '\\"')}"`;
    })
    // Quote ALL unquoted url values if they contain special chars
    .replace(/^(\s*url:\s*)([^"'\n].*)$/gm, (_, prefix, content) => {
      // URLs don't usually need quoting unless they have special YAML chars
      if (content.includes(':') && !content.startsWith('http')) {
        return `${prefix}"${content.replace(/"/g, '\\"')}"`;
      }
      return prefix + content;
    })
    // Quote plain array items containing colons (e.g., "- Title: Description")
    .replace(/^(\s*-\s+)([^"'\-\n][^:\n]*:\s*[^\n]+)$/gm, (_, prefix, content) => {
      if (content.startsWith('"') || content.startsWith("'")) return prefix + content;
      // Skip if it looks like a YAML key (word followed by colon at start)
      if (/^[a-z_]+:\s/.test(content)) return prefix + content;
      return `${prefix}"${content.replace(/"/g, '\\"')}"`;
    });
}

/**
 * Parse YAML frontmatter and markdown body from a response
 * Returns { frontmatter: object, body: string } or null if parsing fails
 */
function parseMarkdownWithFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } | null {
  // Strip markdown code block wrapper if present (some models wrap output in ```markdown)
  let cleanContent = content;
  const codeBlockMatch = content.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)```\s*$/);
  if (codeBlockMatch) {
    cleanContent = codeBlockMatch[1];
  }
  
  // Strip preamble text before frontmatter (some models add intro text before ---)
  if (!cleanContent.startsWith('---')) {
    const frontmatterStart = cleanContent.indexOf('\n---\n');
    if (frontmatterStart !== -1) {
      cleanContent = cleanContent.substring(frontmatterStart + 1); // +1 to skip the leading newline
    } else {
      // Try without newline requirement
      const dashStart = cleanContent.indexOf('---');
      if (dashStart > 0 && dashStart < 500) { // Only strip if --- is within first 500 chars
        cleanContent = cleanContent.substring(dashStart);
      }
    }
  }
  
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/7fa0ee0a-6987-4ecb-8ece-a40a020d7917',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'council-runner.ts:parseMarkdownWithFrontmatter',message:'Input analysis',data:{first50:cleanContent.substring(0,50),startsWithDash:cleanContent.startsWith('---'),hadCodeBlock:!!codeBlockMatch,contentLength:cleanContent.length},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'A,C'})}).catch(()=>{});
  // #endregion
  
  // Find frontmatter delimiters
  const frontmatterMatch = cleanContent.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/7fa0ee0a-6987-4ecb-8ece-a40a020d7917',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'council-runner.ts:parseMarkdownWithFrontmatter',message:'Primary regex result',data:{matched:!!frontmatterMatch},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'A'})}).catch(()=>{});
  // #endregion
  
  if (!frontmatterMatch) {
    // Try without leading newline requirement
    const altMatch = cleanContent.match(/^---\s*([\s\S]*?)---\s*([\s\S]*)$/);
    if (!altMatch) {
      return null;
    }
    try {
      const yamlStr = sanitizeYamlArrayItems(altMatch[1].trim());
      const frontmatter = parseYaml(yamlStr) as Record<string, unknown>;
      return { frontmatter, body: altMatch[2].trim() };
    } catch (e) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/7fa0ee0a-6987-4ecb-8ece-a40a020d7917',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'council-runner.ts:parseMarkdownWithFrontmatter',message:'Alt YAML parse error',data:{error:String(e)},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
      return null;
    }
  }
  
  try {
    const yamlStr = sanitizeYamlArrayItems(frontmatterMatch[1]);
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/7fa0ee0a-6987-4ecb-8ece-a40a020d7917',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'council-runner.ts:parseMarkdownWithFrontmatter',message:'Parsing sanitized YAML',data:{yamlPreview:yamlStr.substring(0,300)},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    const frontmatter = parseYaml(yamlStr) as Record<string, unknown>;
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/7fa0ee0a-6987-4ecb-8ece-a40a020d7917',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'council-runner.ts:parseMarkdownWithFrontmatter',message:'YAML parse success',data:{keys:Object.keys(frontmatter)},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    return { frontmatter, body: frontmatterMatch[2].trim() };
  } catch (e) {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/7fa0ee0a-6987-4ecb-8ece-a40a020d7917',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'council-runner.ts:parseMarkdownWithFrontmatter',message:'Primary YAML parse error, trying fallback',data:{error:String(e)},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    
    // Fallback: Extract key fields via regex when YAML parsing fails
    const rawYaml = frontmatterMatch[1];
    const fallbackFrontmatter: Record<string, unknown> = {};
    
    // Extract simple string fields
    const stringFields = ['persona_id', 'persona', 'thesis'];
    for (const field of stringFields) {
      const match = rawYaml.match(new RegExp(`^${field}:\\s*"?([^"\\n]+)"?`, 'm'));
      if (match) fallbackFrontmatter[field] = match[1].trim().replace(/^"|"$/g, '');
    }
    
    // Extract array fields (risks, anti_plan, falsifiers)
    const arrayFields = ['risks', 'anti_plan', 'falsifiers'];
    for (const field of arrayFields) {
      const fieldMatch = rawYaml.match(new RegExp(`^${field}:\\s*\\n((?:\\s+-\\s+.+\\n?)+)`, 'm'));
      if (fieldMatch) {
        const items = fieldMatch[1].match(/^\s*-\s+(.+)$/gm);
        if (items) {
          fallbackFrontmatter[field] = items.map(item => 
            item.replace(/^\s*-\s+/, '').replace(/^["']|["']$/g, '').trim()
          );
        }
      }
    }
    
    // Extract sources (best effort)
    const sourcesMatch = rawYaml.match(/^sources:\s*\n([\s\S]*?)(?=^[a-z_]+:|$)/m);
    if (sourcesMatch) {
      const urls = sourcesMatch[1].match(/url:\s*(\S+)/g);
      if (urls) {
        fallbackFrontmatter['sources'] = urls.map(u => ({
          url: u.replace(/^url:\s*/, '').trim()
        }));
      }
    }
    
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/7fa0ee0a-6987-4ecb-8ece-a40a020d7917',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'council-runner.ts:parseMarkdownWithFrontmatter',message:'Fallback extraction result',data:{keys:Object.keys(fallbackFrontmatter),hasThesis:!!fallbackFrontmatter.thesis},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'fallback'})}).catch(()=>{});
    // #endregion
    
    // Only return fallback if we got at least the essential fields
    if (fallbackFrontmatter.persona_id && fallbackFrontmatter.thesis) {
      return { frontmatter: fallbackFrontmatter, body: frontmatterMatch[2].trim() };
    }
    
    return null;
  }
}

/**
 * Council Runner Service
 * Handles parallel execution of LLM Council pipeline and file I/O
 */
export class CouncilRunnerService {
  private app: App;
  private settings: PluginSettings;
  private aiService: AIService;

  constructor(app: App, settings: PluginSettings, aiService: AIService) {
    this.app = app;
    this.settings = settings;
    this.aiService = aiService;
  }

  /**
   * Update settings reference
   */
  updateSettings(settings: PluginSettings): void {
    this.settings = settings;
  }

  /**
   * Generate a unique run ID
   */
  generateRunId(): string {
    return moment().format("YYYY-MM-DD_HHmmss");
  }

  /**
   * Create the run directory structure
   */
  async createRunDirectory(runId: string): Promise<string> {
    const basePath = this.settings.llmCouncil.runsPath;
    const runPath = `${basePath}/${runId}`;

    // Create subdirectories
    const dirs = [
      runPath,
      `${runPath}/ideas`,
      `${runPath}/exec`,
      `${runPath}/judge`,
      `${runPath}/logs`,
    ];

    for (const dir of dirs) {
      await this.ensureDirectory(dir);
    }

    return runPath;
  }

  /**
   * Ensure a directory exists, creating it if necessary
   */
  private async ensureDirectory(path: string): Promise<void> {
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (!existing) {
      await this.app.vault.createFolder(path);
    }
  }

  /**
   * Save input to the run directory
   */
  async saveInput(runPath: string, content: string): Promise<string> {
    const inputPath = `${runPath}/input.md`;
    await this.app.vault.create(inputPath, content);
    return inputPath;
  }

  /**
   * Load a prompt file from the vault
   */
  async loadPromptFile(path: string): Promise<string> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      return await this.app.vault.read(file);
    }
    throw new Error(`Prompt file not found: ${path}`);
  }

  /**
   * Load ideator prompt by persona key
   */
  async loadIdeatorPrompt(persona: keyof LlmCouncilIdeatorPrompts): Promise<string> {
    const path = this.settings.llmCouncil.prompts.ideators[persona];
    return this.loadPromptFile(path);
  }

  /**
   * Load executor prompt
   */
  async loadExecutorPrompt(): Promise<string> {
    return this.loadPromptFile(this.settings.llmCouncil.prompts.executor);
  }

  /**
   * Load judge prompt
   */
  async loadJudgePrompt(): Promise<string> {
    return this.loadPromptFile(this.settings.llmCouncil.prompts.judge);
  }

  /**
   * Generate markdown body for an idea (fallback if not preserved from response)
   */
  private generateIdeaMarkdownBody(idea: LlmCouncilIdea): string {
    const lines = ["## Plan", ""];
    idea.plan_steps.forEach((step, i) => {
      lines.push(`### ${i + 1}. ${step.step}`, "");
      if (step.rationale) {
        lines.push(`**Rationale:** ${step.rationale}`, "");
      }
      if (step.mini_artifact) {
        lines.push(`**Mini-artifact:** ${step.mini_artifact}`, "");
      }
    });
    return lines.join("\n");
  }

  /**
   * Run a single ideator
   */
  async runIdeator(
    persona: keyof LlmCouncilIdeatorPrompts,
    runId: string,
    input: string
  ): Promise<LlmCouncilIdea | null> {
    try {
      const promptTemplate = await this.loadIdeatorPrompt(persona);
      const model = this.settings.llmCouncil.ideatorModels[persona];
      const cfg = this.settings.llmCouncil.generationConfig.ideation;

      // Replace placeholder in prompt
      const prompt = promptTemplate.replace("{activenote}", input);

      // Extract system prompt from LLM_COUNCIL:BEGIN section if present
      const systemMatch = prompt.match(/<!-- LLM_COUNCIL:BEGIN -->([\s\S]*?)<!-- LLM_COUNCIL:END -->/);
      const systemPrompt = systemMatch 
        ? systemMatch[1].trim()
        : "You are an ideator in an LLM Council. Output STRICT JSON matching the ideas schema.";
      
      // Use the full prompt as user content, but add run_id instruction
      const userPrompt = `Run ID: ${runId}\n\nINPUT:\n${input}`;

      const response = await this.aiService.callModel(
        systemPrompt,
        userPrompt,
        model,
        {
          useSearch: true,
          temperature: cfg.temperature,
          thinkingBudget: cfg.thinkingBudget ?? undefined,
        }
      );

      if (!response) {
        console.error(`[GSD] Council: Ideator ${persona} returned null response`);
        return null;
      }

      // Parse Markdown with YAML frontmatter
      try {
        const parsed = parseMarkdownWithFrontmatter(response);
        if (!parsed) {
          console.error(`[GSD] Council: Failed to parse ideator ${persona} frontmatter`);
          console.error(`[GSD] Council: Raw response:`, response.substring(0, 500));
          return null;
        }

        const { frontmatter, body } = parsed;
        
        // Build the idea from frontmatter + body
        const idea: LlmCouncilIdea = {
          run_id: runId,
          phase: "ideas",
          persona_id: persona,
          persona: (frontmatter.persona as string) || persona,
          thesis: (frontmatter.thesis as string) || "",
          plan_steps: [], // Will be populated from body
          risks: (frontmatter.risks as string[]) || [],
          anti_plan: (frontmatter.anti_plan as string[]) || [],
          falsifiers: (frontmatter.falsifiers as string[]) || [],
          sources: (frontmatter.sources as Array<{title?: string; url: string}>) || [],
          markdown_body: body, // Store the full markdown body
        };

        // Parse plan steps from the markdown body
        const stepMatches = body.matchAll(/###\s*\d+\.\s*(.+?)(?:\n\n|\n)(?:\*\*Rationale:\*\*\s*(.+?))?(?:\n\n|\n)(?:\*\*Mini-artifact:\*\*\s*([\s\S]*?))?(?=###\s*\d+\.|$)/g);
        for (const match of stepMatches) {
          idea.plan_steps.push({
            step: match[1]?.trim() || "",
            rationale: match[2]?.trim() || "",
            mini_artifact: match[3]?.trim() || "",
          });
        }

        // If no structured steps found, try a simpler parse
        if (idea.plan_steps.length === 0) {
          const simpleSteps = body.match(/###\s*\d+\.\s*(.+)/g);
          if (simpleSteps) {
            idea.plan_steps = simpleSteps.map(s => ({
              step: s.replace(/###\s*\d+\.\s*/, "").trim(),
              rationale: "",
              mini_artifact: "",
            }));
          }
        }

        return idea;
      } catch (parseError) {
        console.error(`[GSD] Council: Failed to parse ideator ${persona} response:`, parseError);
        console.error(`[GSD] Council: Raw response:`, response.substring(0, 500));
        return null;
      }
    } catch (error) {
      console.error(`[GSD] Council: Ideator ${persona} failed:`, error);
      return null;
    }
  }

  /**
   * Run all ideators in parallel
   */
  async runIdeators(
    runId: string,
    runPath: string,
    input: string,
    onProgress?: (completed: number, total: number) => void
  ): Promise<LlmCouncilIdea[]> {
    const personas: (keyof LlmCouncilIdeatorPrompts)[] = [
      "feynman",
      "taleb",
      "daVinci",
      "fuller",
    ];

    let completed = 0;
    const total = personas.length;

    const ideaPromises = personas.map(async (persona) => {
      const idea = await this.runIdeator(persona, runId, input);
      completed++;
      onProgress?.(completed, total);

      // Save to file as Markdown with YAML frontmatter
      if (idea) {
        const ideaPath = `${runPath}/ideas/${persona}.md`;
        const frontmatter = [
          "---",
          `persona_id: ${idea.persona_id}`,
          `persona: "${idea.persona}"`,
          `thesis: "${idea.thesis.replace(/"/g, '\\"')}"`,
          `risks:`,
          ...(idea.risks || []).map(r => `  - "${r.replace(/"/g, '\\"')}"`),
          `anti_plan:`,
          ...(idea.anti_plan || []).map(a => `  - "${a.replace(/"/g, '\\"')}"`),
          `falsifiers:`,
          ...(idea.falsifiers || []).map(f => `  - "${f.replace(/"/g, '\\"')}"`),
          `sources:`,
          ...(idea.sources || []).map(s => `  - title: "${(s.title || "").replace(/"/g, '\\"')}"\n    url: ${s.url}`),
          "---",
          "",
        ].join("\n");
        
        const body = idea.markdown_body || this.generateIdeaMarkdownBody(idea);
        await this.app.vault.create(ideaPath, frontmatter + body);
      }

      return idea;
    });

    const results = await Promise.all(ideaPromises);
    return results.filter((idea): idea is LlmCouncilIdea => idea !== null);
  }

  /**
   * Run a single executor
   */
  async runExecutor(
    executorName: string,
    model: string,
    runId: string,
    input: string,
    ideas: LlmCouncilIdea[]
  ): Promise<LlmCouncilExecution | null> {
    try {
      const promptTemplate = await this.loadExecutorPrompt();
      const cfg = this.settings.llmCouncil.generationConfig.execution;

      // Extract system prompt from LLM_COUNCIL:BEGIN section if present
      const systemMatch = promptTemplate.match(/<!-- LLM_COUNCIL:BEGIN -->([\s\S]*?)<!-- LLM_COUNCIL:END -->/);
      const systemPrompt = systemMatch
        ? systemMatch[1].trim()
        : "You are an executor in an LLM Council. Produce a single, actionable Markdown deliverable.";

      // Build context with input and all ideas (with null safety)
      const ideasContext = ideas
        .map((idea) => {
          const persona = idea.persona || idea.persona_id || "Unknown";
          const personaId = idea.persona_id || "unknown";
          const thesis = idea.thesis || "No thesis provided";
          const planSteps = Array.isArray(idea.plan_steps) 
            ? idea.plan_steps.map((s, i) => `${i + 1}. ${s?.step || "Step"}`).join("\n")
            : "No plan provided";
          const risks = Array.isArray(idea.risks) ? idea.risks.join(", ") : "None specified";
          const falsifiers = Array.isArray(idea.falsifiers) ? idea.falsifiers.join(", ") : "None specified";
          
          return `## ${persona} (${personaId})\n\n**Thesis:** ${thesis}\n\n**Plan:**\n${planSteps}\n\n**Risks:** ${risks}\n\n**Falsifiers:** ${falsifiers}`;
        })
        .join("\n\n---\n\n");

      const userPrompt = `Run ID: ${runId}

## INPUT (Problem to Solve)
${input}

## IDEATOR OUTPUTS
${ideasContext}

---

Now synthesize the above into a single, executable solution. Start your response with "# [Title]" where Title is a snappy, filename-safe title for your solution.`;

      const response = await this.aiService.callModel(
        systemPrompt,
        userPrompt,
        model,
        {
          useSearch: true,
          temperature: cfg.temperature,
          thinkingBudget: cfg.thinkingBudget ?? undefined,
        }
      );

      if (!response) {
        console.error(`[GSD] Council: Executor ${executorName} returned null response`);
        return null;
      }

      // Extract title from response (first # heading)
      const titleMatch = response.match(/^#\s+(.+)$/m);
      const title = titleMatch ? titleMatch[1].trim() : `Execution_${executorName}`;

      // Clean title for filename
      const cleanTitle = title.replace(/[\/\\:*?"<>|]/g, "_").substring(0, 50);

      return {
        executorName,
        model,
        content: response,
        title: cleanTitle,
      };
    } catch (error) {
      console.error(`[GSD] Council: Executor ${executorName} failed:`, error);
      return null;
    }
  }

  /**
   * Run all executors in parallel
   */
  async runExecutors(
    runId: string,
    runPath: string,
    input: string,
    ideas: LlmCouncilIdea[],
    onProgress?: (completed: number, total: number) => void
  ): Promise<LlmCouncilExecution[]> {
    const executors = Object.entries(this.settings.llmCouncil.executorModels);
    let completed = 0;
    const total = executors.length;

    const executorPromises = executors.map(async ([name, model]) => {
      const execution = await this.runExecutor(name, model, runId, input, ideas);
      completed++;
      onProgress?.(completed, total);

      // Save to file
      if (execution) {
        const execPath = `${runPath}/exec/${execution.title}.md`;
        await this.app.vault.create(execPath, execution.content);
      }

      return execution;
    });

    const results = await Promise.all(executorPromises);
    return results.filter((exec): exec is LlmCouncilExecution => exec !== null);
  }

  /**
   * Run the judge
   */
  async runJudge(
    runId: string,
    runPath: string,
    input: string,
    ideas: LlmCouncilIdea[],
    executions: LlmCouncilExecution[]
  ): Promise<LlmCouncilJudgment | null> {
    try {
      const promptTemplate = await this.loadJudgePrompt();
      const model = this.settings.llmCouncil.judgeModel;
      const cfg = this.settings.llmCouncil.generationConfig.judgment;

      // Extract system prompt from LLM_COUNCIL:BEGIN section if present
      const systemMatch = promptTemplate.match(/<!-- LLM_COUNCIL:BEGIN -->([\s\S]*?)<!-- LLM_COUNCIL:END -->/);
      const systemPrompt = systemMatch
        ? systemMatch[1].trim()
        : "You are the Judge in an LLM Council. Output STRICT JSON matching the judge schema.";

      // Build ideas context (with null safety)
      const ideasContext = ideas
        .map((idea) => {
          const persona = idea.persona || idea.persona_id || "Unknown";
          const personaId = idea.persona_id || "unknown";
          const thesis = idea.thesis || "No thesis provided";
          const risks = Array.isArray(idea.risks) ? idea.risks.join(", ") : "None specified";
          const falsifiers = Array.isArray(idea.falsifiers) ? idea.falsifiers.join(", ") : "None specified";
          return `### ${persona} (${personaId})\n**Thesis:** ${thesis}\n**Risks:** ${risks}\n**Falsifiers:** ${falsifiers}`;
        })
        .join("\n\n");

      // Build executions context
      const execContext = executions
        .map((exec) => `### ${exec.executorName} (${exec.model})\n**Title:** ${exec.title}\n\n${exec.content.substring(0, 3000)}${exec.content.length > 3000 ? "\n\n[...truncated...]" : ""}`)
        .join("\n\n---\n\n");

      const userPrompt = `Run ID: ${runId}

## INPUT (Original Problem)
${input}

## IDEATOR OUTPUTS
${ideasContext}

## EXECUTOR DELIVERABLES
${execContext}

---

Score each executor deliverable on a scale of 1-10 using the following rubric:
- clarity: How clear and well-structured is the solution?
- actionability: Can someone start executing this today?
- completeness: Does it address the full scope of the problem?
- creativity: Does it incorporate novel insights from the ideators?
- grounding: Are claims backed by evidence or explicit assumptions?

Use equal weights (0.2 each) for the rubric. Compute weighted_total for each executor.

Output Markdown with YAML frontmatter. Include a synthesis in the body that integrates the best elements.`;

      const response = await this.aiService.callModel(
        systemPrompt,
        userPrompt,
        model,
        {
          useSearch: true,
          temperature: cfg.temperature,
          thinkingBudget: cfg.thinkingBudget ?? undefined,
        }
      );

      if (!response) {
        console.error("[GSD] Council: Judge returned null response");
        return null;
      }

      // Parse Markdown with YAML frontmatter
      try {
        const parsed = parseMarkdownWithFrontmatter(response);
        if (!parsed) {
          console.error("[GSD] Council: Failed to parse judge frontmatter");
          console.error("[GSD] Council: Raw response:", response.substring(0, 500));
          
          // Save raw response for debugging
          try {
            const rawPath = `${runPath}/judge/judge_raw.md`;
            await this.app.vault.create(rawPath, response);
          } catch (e) { /* ignore */ }
          
          return null;
        }

        const { frontmatter, body } = parsed;
        
        // Build judgment from frontmatter + body
        const judgment: LlmCouncilJudgment = {
          run_id: runId,
          phase: "judge",
          rubric_weights: (frontmatter.rubric_weights as Record<string, number>) || {
            clarity: 0.2,
            actionability: 0.2,
            completeness: 0.2,
            creativity: 0.2,
            grounding: 0.2,
          },
          scores: (frontmatter.scores as LlmCouncilJudgment["scores"]) || [],
          winner: (frontmatter.winner as string) || "",
          synthesis: body, // Full markdown body is the synthesis
          next_actions: (frontmatter.next_actions as string[]) || [],
          sources: (frontmatter.sources as Array<{title?: string; url: string}>) || [],
        };

        // Save to file as Markdown
        const judgePath = `${runPath}/judge/judge.md`;
        await this.app.vault.create(judgePath, response);

        return judgment;
      } catch (parseError) {
        console.error("[GSD] Council: Failed to parse judge response:", parseError);
        console.error("[GSD] Council: Raw response:", response.substring(0, 500));
        
        // Save the raw response for debugging
        try {
          const rawPath = `${runPath}/judge/judge_raw.md`;
          await this.app.vault.create(rawPath, response);
          console.log("[GSD] Council: Saved raw judge response to", rawPath);
        } catch (e) {
          // Ignore save errors
        }
        
        return null;
      }
    } catch (error) {
      console.error("[GSD] Council: Judge failed:", error);
      return null;
    }
  }

  /**
   * Generate the output summary file
   */
  async generateOutput(
    runPath: string,
    runId: string,
    ideas: LlmCouncilIdea[],
    executions: LlmCouncilExecution[],
    judgment: LlmCouncilJudgment | null
  ): Promise<string> {
    let output = `# LLM Council Run: ${runId}\n\n`;

    // Executive Summary
    if (judgment) {
      output += `## Executive Summary\n\n`;
      output += `**Winner:** ${judgment.winner}\n\n`;
      output += `${judgment.synthesis}\n\n`;

      // Scores table
      output += `## Scores\n\n`;
      output += `| Executor | Weighted Score | Notes |\n`;
      output += `|----------|---------------|-------|\n`;
      for (const score of judgment.scores) {
        output += `| ${score.executor} | ${score.weighted_total.toFixed(2)} | ${score.notes.substring(0, 100)}... |\n`;
      }
      output += `\n`;

      // Next Actions
      output += `## Next Actions\n\n`;
      for (let i = 0; i < judgment.next_actions.length; i++) {
        output += `${i + 1}. ${judgment.next_actions[i]}\n`;
      }
      output += `\n`;
    }

    // Ideas summary
    output += `## Ideator Summaries\n\n`;
    for (const idea of ideas) {
      output += `### ${idea.persona}\n\n`;
      output += `**Thesis:** ${idea.thesis}\n\n`;
      output += `**File:** [[${runPath}/ideas/${idea.persona_id}.md]]\n\n`;
    }

    // Executions summary
    output += `## Executor Deliverables\n\n`;
    for (const exec of executions) {
      output += `### ${exec.executorName} (${exec.model})\n\n`;
      output += `**Title:** ${exec.title}\n\n`;
      output += `**File:** [[${runPath}/exec/${exec.title}.md]]\n\n`;
    }

    // Judge result
    if (judgment) {
      output += `## Judge Result\n\n`;
      output += `**File:** [[${runPath}/judge/judge.md]]\n\n`;
      output += `**Sources:**\n`;
      for (const source of judgment.sources || []) {
        output += `- ${source.title || source.url}: ${source.url}\n`;
      }
    }

    const outputPath = `${runPath}/output.md`;
    await this.app.vault.create(outputPath, output);
    return outputPath;
  }

  /**
   * Generate the collapsible callout to append to the original note
   */
  generateCallout(
    runId: string,
    runPath: string,
    judgment: LlmCouncilJudgment | null
  ): string {
    const winner = judgment?.winner || "N/A";
    const winnerScore = judgment?.scores?.find(s => s.executor === winner)?.weighted_total || 0;
    const synthesis = judgment?.synthesis || "Council run completed but judgment failed.";
    
    // Truncate synthesis to reasonable length
    const truncatedSynthesis = synthesis.length > 500 
      ? synthesis.substring(0, 500) + "..."
      : synthesis;

    return `
> [!abstract]- LLM Council Results (${runId})
> **Winner:** ${winner} - Score: ${winnerScore.toFixed(1)}/10
> 
> **Executive Summary:** ${truncatedSynthesis}
> 
> **Full Results:** [[${runPath}/output.md|View Complete Analysis]]
`;
  }
}
