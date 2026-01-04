import { App, Notice, TFile } from "obsidian";
import type { CalendarEvent, PluginSettings } from "../types";
import { VaultSearchService } from "../services/vault-search";
import { IndexService } from "../services/index-service";
import { GoogleServices } from "../services/google-services";
import { AIService } from "../services/ai-service";
import type { O3Person } from "./o3-prep";

const moment = (window as any).moment;

export type O3CoachMode = "week" | "person";

export type O3CoachSuggestionType =
  | "followup"
  | "update"
  | "info_request"
  | "blind_spot"
  | "question";

export type O3CoachSuggestion = {
  type: O3CoachSuggestionType;
  text: string;
  person?: string;
  sourceIds?: string[];
};

export type O3CoachSource = {
  id: string;
  title: string;
  kind:
    | "master"
    | "person"
    | "meeting"
    | "daily"
    | "perf"
    | "o3doc";
  path?: string;
  truncated?: boolean;
  content?: string;
};

export type O3CoachResponse = {
  summary: string;
  suggestions: O3CoachSuggestion[];
  questions: string[];
  sources: O3CoachSource[];
  warnings: string[];
  raw: string;
};

type O3CoachRunOptions = {
  mode: O3CoachMode;
  question: string;
  person?: O3Person | null;
  event?: CalendarEvent | null;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  includeSources?: Partial<{
    master: boolean;
    person: boolean;
    meeting: boolean;
    daily: boolean;
    perf: boolean;
    o3doc: boolean;
  }>;
};

const MAX_SOURCE_CHARS = 6000;
const MAX_TOTAL_CHARS = 60000;

export class O3CoachAction {
  private app: App;
  private settings: PluginSettings;
  private vaultSearch: VaultSearchService;
  private indexService: IndexService;
  private googleServices: GoogleServices;
  private aiService: AIService;

  constructor(
    app: App,
    settings: PluginSettings,
    vaultSearch: VaultSearchService,
    indexService: IndexService,
    googleServices: GoogleServices,
    aiService: AIService
  ) {
    this.app = app;
    this.settings = settings;
    this.vaultSearch = vaultSearch;
    this.indexService = indexService;
    this.googleServices = googleServices;
    this.aiService = aiService;
  }

  updateSettings(settings: PluginSettings): void {
    this.settings = settings;
  }

  async runCoach(options: O3CoachRunOptions): Promise<O3CoachResponse | null> {
    const sourcesResult = await this.buildSources(options);
    const { sources, context, warnings } = sourcesResult;

    if (!context.trim()) {
      new Notice("No context available for O3 Coach.");
      return null;
    }

    const systemPrompt = [
      "You are an O3 Coach helping prep 1:1s.",
      "Use only the provided sources. Never invent facts.",
      "Be specific, action-oriented, and cite source IDs for every suggestion.",
      "Include info_request suggestions as explicit questions to ask for updates when relevant.",
      "Return JSON only with this shape:",
      "{",
      '  "summary": string,',
      '  "suggestions": [',
      '    { "type": "followup|update|info_request|blind_spot|question", "text": string, "person"?: string, "sourceIds": string[] }',
      "  ],",
      '  "questions": string[]',
      "}",
      "If context is missing, say so in summary and keep suggestions empty.",
    ].join("\n");

    const history = (options.history || []).slice(-6);
    const historyBlock = history.length
      ? `\nRecent chat:\n${history
          .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
          .join("\n")}\n`
      : "";

    const personLabel = options.person ? options.person.name : "none";
    const modeLabel = options.mode === "person" ? "person" : "week";

    const userPrompt = [
      `Mode: ${modeLabel}`,
      `Person: ${personLabel}`,
      `Question: ${options.question}`,
      historyBlock.trim(),
      warnings.length ? `Warnings:\n- ${warnings.join("\n- ")}` : "",
      "Sources:",
      context,
    ]
      .filter((part) => part && part.trim())
      .join("\n\n");

    const cfg = this.settings.generationConfigs?.o3Prep;
    const response = await this.aiService.callModel(
      systemPrompt,
      userPrompt,
      this.settings.models.o3PrepModel,
      {
        useSearch: false,
        temperature: cfg?.temperature,
        thinkingBudget: cfg?.thinkingBudget ?? undefined,
      }
    );

    if (!response) return null;

    const parsed = this.parseCoachResponse(response);
    return {
      summary: parsed.summary || "",
      suggestions: parsed.suggestions || [],
      questions: parsed.questions || [],
      sources,
      warnings,
      raw: response,
    };
  }

  async resolvePersonByName(name: string): Promise<O3Person | null> {
    if (!name) return null;
    const basename = await this.vaultSearch.findPeopleNoteByName(name);
    if (!basename) return null;
    const path = `${this.settings.peopleFolder}/${basename}.md`;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return null;
    const content = await this.app.vault.read(file);
    const fm = this.vaultSearch.parseFrontmatter<Record<string, any>>(content);
    const o3Doc = (fm.o3_doc || fm.o3Doc || fm.o3doc || "").toString().trim() || null;
    const o3MeetingId = (fm.o3_meeting_id || fm.o3MeetingId || "").toString().trim() || null;

    return {
      name: file.basename,
      filePath: file.path,
      o3Doc,
      o3MeetingId,
      sections: { followUps: [], updates: [], standingTopics: [] },
    };
  }

  private async buildSources(options: O3CoachRunOptions): Promise<{
    sources: O3CoachSource[];
    context: string;
    warnings: string[];
  }> {
    const include = {
      master: options.includeSources?.master ?? true,
      person: options.includeSources?.person ?? true,
      meeting: options.includeSources?.meeting ?? true,
      daily: options.includeSources?.daily ?? true,
      perf: options.includeSources?.perf ?? true,
      o3doc: options.includeSources?.o3doc ?? true,
    };
    const sources: O3CoachSource[] = [];
    const parts: string[] = [];
    const warnings: string[] = [];
    let totalChars = 0;

    const addSource = (
      kind: O3CoachSource["kind"],
      title: string,
      content: string,
      path?: string
    ) => {
      if (!content) return;
      let text = content;
      let truncated = false;
      if (text.length > MAX_SOURCE_CHARS) {
        text = text.slice(0, MAX_SOURCE_CHARS);
        truncated = true;
      }
      if (totalChars + text.length > MAX_TOTAL_CHARS) {
        warnings.push(`Context budget exceeded; skipped ${title}.`);
        return;
      }
      totalChars += text.length;
      const id = `SRC${sources.length + 1}`;
      sources.push({ id, title, kind, path, truncated, content: text });
      parts.push(`[[${id}]] ${title}\n${text}`);
    };

    // Master O3 prep
    if (include.master) {
      const masterPath = this.settings.o3?.masterNotePath;
      if (masterPath) {
        const masterFile = this.app.vault.getAbstractFileByPath(masterPath);
        if (masterFile instanceof TFile) {
          const content = await this.app.vault.read(masterFile);
          addSource("master", "Master O3 Prep", content, masterFile.path);
        } else {
          warnings.push(`Master O3 prep note not found at ${masterPath}`);
        }
      }
    }

    // Person note
    if (include.person && options.person) {
      const personFile = this.app.vault.getAbstractFileByPath(options.person.filePath);
      if (personFile instanceof TFile) {
        const content = await this.app.vault.read(personFile);
        addSource("person", `People Note: ${options.person.name}`, content, personFile.path);
      }
    }

    // O3 Doc (Google Doc)
    if (include.o3doc && options.person?.o3Doc) {
      const fileId = this.googleServices.extractDriveFileId(options.person.o3Doc);
      if (fileId) {
        const docContent = await this.googleServices.getDocContent(fileId);
        if (docContent) {
          addSource("o3doc", `O3 Doc: ${options.person.name}`, docContent);
        }
      }
    }

    // Performance reviews (business-wide)
    if (include.perf) {
      const perfFiles = this.getPerfReviewFiles();
      if (perfFiles.length === 0) {
        warnings.push("No performance reviews found.");
      } else {
        for (const file of perfFiles) {
          const content = await this.app.vault.read(file);
          addSource("perf", `Perf Review: ${file.basename}`, content, file.path);
        }
      }
    }

    // Meetings
    if (include.meeting) {
      const meetingFiles =
        options.mode === "person" && options.person
          ? await this.getMeetingFilesForPerson(options.person.name)
          : this.getMeetingFiles();
      if (meetingFiles.length === 0) {
        warnings.push("No meeting notes found in lookback window.");
      } else {
        for (const file of meetingFiles) {
          const content = await this.app.vault.read(file);
          addSource("meeting", `Meeting Note: ${file.basename}`, content, file.path);
        }
      }
    }

    // Daily notes (current notes)
    if (include.daily) {
      const dailyFiles = this.getDailyNoteFiles();
      if (dailyFiles.length === 0) {
        warnings.push("No daily notes found in lookback window.");
      } else {
        for (const file of dailyFiles) {
          const content = await this.app.vault.read(file);
          addSource("daily", `Daily Note: ${file.basename}`, content, file.path);
        }
      }
    }

    return { sources, context: parts.join("\n\n"), warnings };
  }

  private getPerfReviewFiles(): TFile[] {
    const folder = this.settings.o3Coach?.perfReviewFolder || "";
    const max = this.settings.o3Coach?.perfReviewMax ?? 6;
    const prefix = folder ? `${folder.replace(/\/+$/, "")}/` : "";
    if (!prefix) return [];

    const files = this.app.vault
      .getMarkdownFiles()
      .filter((file) => file.path.startsWith(prefix))
      .filter((file) => /^\\d{4}-\\d{2}-\\d{2}/.test(file.basename));

    files.sort((a, b) => this.sortByFilenameDateDesc(a.basename, b.basename));
    return files.slice(0, max);
  }

  private getMeetingFiles(): TFile[] {
    const folder = this.settings.meetingsFolder || "Meetings";
    const prefix = `${folder.replace(/\/+$/, "")}/`;
    const lookback = this.settings.o3Coach?.lookbackDays ?? 21;
    const max = this.settings.o3Coach?.currentNotesMax ?? 50;

    const files = this.app.vault
      .getMarkdownFiles()
      .filter((file) => file.path.startsWith(prefix))
      .filter((file) => this.isWithinLookback(file, lookback));

    files.sort((a, b) => this.sortByFileDateDesc(a, b));
    return files.slice(0, max);
  }

  private async getMeetingFilesForPerson(name: string): Promise<TFile[]> {
    const lookback = this.settings.o3Coach?.lookbackDays ?? 21;
    const max = this.settings.o3Coach?.currentNotesMax ?? 50;
    const paths = this.indexService.findMeetingsForPerson(name);
    const files: TFile[] = [];
    for (const path of paths) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile && this.isWithinLookback(file, lookback)) {
        files.push(file);
      }
    }
    files.sort((a, b) => this.sortByFileDateDesc(a, b));
    return files.slice(0, max);
  }

  private getDailyNoteFiles(): TFile[] {
    const lookback = this.settings.o3Coach?.lookbackDays ?? 21;
    const max = this.settings.o3Coach?.currentNotesMax ?? 50;
    const files: TFile[] = [];

    for (let i = 0; i < lookback; i += 1) {
      const date = moment().subtract(i, "days").format("YYYY-MM-DD");
      const possible = [
        `Daily notes/${date}.md`,
        `daily notes/${date}.md`,
        `Daily Notes/${date}.md`,
        `${date}.md`,
      ];
      for (const path of possible) {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
          files.push(file);
          break;
        }
      }
      if (files.length >= max) break;
    }

    return files;
  }

  private parseCoachResponse(raw: string): {
    summary: string;
    suggestions: O3CoachSuggestion[];
    questions: string[];
  } {
    try {
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      const jsonString = start >= 0 && end >= 0 ? raw.slice(start, end + 1) : raw;
      const parsed = JSON.parse(jsonString);
      return {
        summary: parsed.summary || "",
        suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
        questions: Array.isArray(parsed.questions) ? parsed.questions : [],
      };
    } catch {
      return { summary: raw.trim(), suggestions: [], questions: [] };
    }
  }

  private isWithinLookback(file: TFile, lookbackDays: number): boolean {
    const fileDate = this.getFileDate(file);
    if (fileDate) {
      return moment().diff(fileDate, "days") <= lookbackDays;
    }
    return moment().diff(moment(file.stat.mtime), "days") <= lookbackDays;
  }

  private getFileDate(file: TFile): string | null {
    const match = file.basename.match(/\\d{4}-\\d{2}-\\d{2}/);
    if (match) return match[0];
    return null;
  }

  private sortByFileDateDesc(a: TFile, b: TFile): number {
    const ad = this.getSortableDate(a);
    const bd = this.getSortableDate(b);
    return bd.localeCompare(ad);
  }

  private getSortableDate(file: TFile): string {
    const nameDate = this.getFileDate(file);
    if (nameDate) return nameDate;
    return moment(file.stat.mtime).format("YYYY-MM-DD");
  }

  private sortByFilenameDateDesc(a: string, b: string): number {
    const am = a.match(/\\d{4}-\\d{2}-\\d{2}/);
    const bm = b.match(/\\d{4}-\\d{2}-\\d{2}/);
    const ad = am ? am[0] : "";
    const bd = bm ? bm[0] : "";
    return bd.localeCompare(ad);
  }
}
