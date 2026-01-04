import { requestUrl, RequestUrlResponse } from "obsidian";
import type { PluginSettings, GmailMessage, AppsScriptResponse, GeminiResponse } from "../types";
import type { AIService } from "./ai-service";
import { handleErrorWithDefault } from "../utils/error-handler";

/**
 * Google Services - Handles all Google API interactions
 * Provides Gmail search, Google Docs reading, and AI calls (via AIService)
 */
export class GoogleServices {
  private settings: PluginSettings;
  private aiService: AIService | null = null;

  constructor(settings: PluginSettings, aiService?: AIService) {
    this.settings = settings;
    this.aiService = aiService || null;
  }

  /**
   * Update settings reference (called when settings change)
   */
  updateSettings(settings: PluginSettings): void {
    this.settings = settings;
  }

  /**
   * Set AIService reference (called when AIService is initialized)
   */
  setAIService(aiService: AIService): void {
    this.aiService = aiService;
  }

  // ============================================================================
  // AI API (via AIService)
  // ============================================================================

  /**
   * Call AI model for AI-powered research
   * Convenience wrapper that delegates to AIService
   * Maintains backward compatibility with existing callGemini signature
   */
  async callGemini(
    system: string,
    user: string,
    model: string = "gemini-flash-latest",
    useSearch: boolean = true,
    generationConfigOverride?: Record<string, any>
  ): Promise<string | null> {
    // If AIService is available, use it
    if (this.aiService) {
      const options: {
        useSearch?: boolean;
        temperature?: number;
        thinkingBudget?: "low" | "medium" | "high" | null;
      } = {
        useSearch,
      };

      // Extract options from generationConfigOverride
      if (generationConfigOverride) {
        if (generationConfigOverride.temperature != null) {
          options.temperature = generationConfigOverride.temperature;
        }
        if (generationConfigOverride.thinkingBudget != null) {
          options.thinkingBudget = generationConfigOverride.thinkingBudget;
        }
      }

      return this.aiService.callModel(system, user, model, options);
    }

    // Fallback: old implementation for backward compatibility
    // This should not be reached in normal operation after AIService is initialized
    console.warn("[GSD] callGemini called without AIService, using fallback");
    if (!this.settings.geminiApiKey) {
      console.warn("[GSD] No Gemini API key configured");
      return null;
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.settings.geminiApiKey}`;
    const tools = useSearch ? [{ googleSearch: {} }] : [];

    try {
      const generationConfig: Record<string, any> = {
        temperature: 0.2,
        ...(generationConfigOverride || {}),
      };

      // Handle thinkingBudget (supports both old number format and new string format)
      if (generationConfig.thinkingBudget != null && generationConfig.thinkingConfig == null) {
        if (typeof generationConfig.thinkingBudget === "number") {
          // Old format: direct number
          generationConfig.thinkingConfig = { thinkingBudget: generationConfig.thinkingBudget };
          delete generationConfig.thinkingBudget;
        } else if (typeof generationConfig.thinkingBudget === "string") {
          // New format: low/medium/high -> map to tokens
          const tokenMap: Record<"low" | "medium" | "high", number> = {
            low: 512,
            medium: 2048,
            high: 4096,
          };
          const tokenBudget = tokenMap[generationConfig.thinkingBudget as "low" | "medium" | "high"];
          if (tokenBudget) {
            generationConfig.thinkingConfig = { thinkingBudget: tokenBudget };
            delete generationConfig.thinkingBudget;
          }
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
        "Gemini API Error (via GoogleServices)",
        error,
        null
      );
    }
  }

  // ============================================================================
  // Gmail (via Apps Script)
  // ============================================================================

  /**
   * Search Gmail for emails matching a query
   */
  async searchGmail(query: string, maxResults: number = 10): Promise<GmailMessage[]> {
    if (!this.settings.appsScriptUrl) {
      console.warn("[GSD] No Apps Script URL configured");
      return [];
    }

    try {
      const response: RequestUrlResponse = await requestUrl({
        url: this.settings.appsScriptUrl,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "searchGmail",
          query: query,
          maxResults: maxResults,
        }),
      });

      const data = response.json as AppsScriptResponse;
      if (data && data.success && data.emails) {
        return data.emails;
      }
      console.error("[GSD] Gmail search error:", data?.error);
      return [];
    } catch (error: unknown) {
      return handleErrorWithDefault(
        "Gmail search failed",
        error,
        [],
        { additionalContext: { query, maxResults } }
      );
    }
  }

  /**
   * Find email address for a person by searching Gmail
   */
  async findEmailByName(name: string): Promise<string | null> {
    if (!name) return null;

    const emails = await this.searchGmail(`from:${name}`, 5);

    if (emails.length > 0) {
      const emailCounts: Record<string, number> = {};
      for (const email of emails) {
        const from = email.from;
        if (from) {
          const match = from.match(/<([^>]+)>/);
          const addr = match ? match[1] : from;
          emailCounts[addr] = (emailCounts[addr] || 0) + 1;
        }
      }

      let maxCount = 0;
      let bestEmail: string | null = null;
      for (const [addr, count] of Object.entries(emailCounts)) {
        if (count > maxCount) {
          maxCount = count;
          bestEmail = addr;
        }
      }
      return bestEmail;
    }

    return null;
  }

  /**
   * Get communication history with a person
   */
  async getCommunicationHistory(email: string, maxResults: number = 15): Promise<GmailMessage[]> {
    if (!email) return [];

    const [fromEmails, toEmails] = await Promise.all([
      this.searchGmail(`from:${email}`, Math.ceil(maxResults / 2)),
      this.searchGmail(`to:${email}`, Math.ceil(maxResults / 2)),
    ]);

    const allEmails = [...fromEmails, ...toEmails];
    allEmails.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    const seen = new Set<string>();
    const unique: GmailMessage[] = [];
    for (const email of allEmails) {
      const key = email.messageId || `${email.subject}-${email.date}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(email);
      }
    }

    return unique.slice(0, maxResults);
  }

  // ============================================================================
  // Google Drive (via Apps Script)
  // ============================================================================

  /**
   * Extract a Google Drive fileId from a URL or a raw fileId.
   *
   * Supports common patterns:
   * - https://docs.google.com/{document|spreadsheets|presentation}/d/<fileId>/...
   * - https://drive.google.com/file/d/<fileId>/view...
   * - https://drive.google.com/open?id=<fileId>
   * - https://drive.google.com/uc?id=<fileId>
   * - raw fileId
   */
  extractDriveFileId(input: string): string | null {
    if (!input) return null;
    const trimmed = input.trim();
    if (!trimmed) return null;

    // If it's already a plausible raw fileId, accept it.
    // (Drive fileIds are typically 20+ chars of [A-Za-z0-9_-])
    if (/^[a-zA-Z0-9_-]{20,}$/.test(trimmed)) return trimmed;

    const candidates: string[] = [];

    // Common "/d/<id>/" patterns (Docs, Sheets, Slides, sometimes others)
    const dMatch = trimmed.match(/\/d\/([a-zA-Z0-9_-]{10,})/);
    if (dMatch?.[1]) candidates.push(dMatch[1]);

    // Drive file link: /file/d/<id>/
    const fileMatch = trimmed.match(/\/file\/d\/([a-zA-Z0-9_-]{10,})/);
    if (fileMatch?.[1]) candidates.push(fileMatch[1]);

    // Drive folder link: /drive/folders/<id>
    const folderMatch = trimmed.match(/\/folders\/([a-zA-Z0-9_-]{10,})/);
    if (folderMatch?.[1]) candidates.push(folderMatch[1]);

    // Query params like ?id=<id>
    try {
      const url = new URL(trimmed);
      const idParam = url.searchParams.get("id") || url.searchParams.get("fileId");
      if (idParam) candidates.push(idParam);
    } catch {
      // Not a valid URL, ignore.
    }

    for (const candidate of candidates) {
      const clean = candidate.trim();
      if (/^[a-zA-Z0-9_-]{10,}$/.test(clean)) return clean;
    }

    return null;
  }

  /**
   * Read content from a Google Drive file (best-effort) via Apps Script.
   */
  async getDocContent(fileId: string): Promise<string | null> {
    if (!this.settings.appsScriptUrl || !fileId) return null;

    try {
      const response: RequestUrlResponse = await requestUrl({
        url: this.settings.appsScriptUrl,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileId: fileId,
          secret: this.settings.appsScriptSecret,
        }),
      });

      const data = response.json as AppsScriptResponse;
      if (data && data.success) return data.text || null;
      return `[Error reading doc: ${data?.error}]`;
    } catch (error: unknown) {
      return handleErrorWithDefault(
        "Doc read failed",
        error,
        null,
        { additionalContext: { docId } }
      );
    }
  }

  /**
   * Modify a Google Doc via Apps Script (append/prepend/replace modes).
   */
  async modifyDocText(
    fileId: string,
    text: string,
    mode: "append" | "prepend" | "replace" = "append"
  ): Promise<boolean> {
    if (!this.settings.appsScriptUrl || !fileId) return false;

    try {
      const response: RequestUrlResponse = await requestUrl({
        url: this.settings.appsScriptUrl,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "modifyDocText",
          fileId: fileId,
          secret: this.settings.appsScriptSecret,
          text: text,
          mode: mode,
        }),
      });

      const data = response.json as AppsScriptResponse;
      if (data && data.success) return true;
      console.error("[GSD] Doc modify error:", data?.error);
      return false;
    } catch (error: unknown) {
      return handleErrorWithDefault(
        "Doc modify failed",
        error,
        false,
        { additionalContext: { fileId, mode } }
      );
    }
  }

  // ============================================================================
  // Email Domain Utilities
  // ============================================================================

  /**
   * Extract email domain (returns null for personal email domains)
   */
  extractDomainFromEmail(email: string): string | null {
    if (!email) return null;

    const match = email.match(/@([^@]+)$/);
    if (!match) return null;

    const domain = match[1].toLowerCase();

    const personalDomains = [
      "gmail.com",
      "yahoo.com",
      "hotmail.com",
      "outlook.com",
      "icloud.com",
      "me.com",
      "live.com",
      "aol.com",
    ];
    if (personalDomains.includes(domain)) {
      return null;
    }

    return domain;
  }

  /**
   * Extract email domain and infer organization name (legacy fallback)
   */
  extractOrgFromEmail(email: string): { domain: string | null; orgName: string | null } {
    if (!email) return { domain: null, orgName: null };

    const domain = this.extractDomainFromEmail(email);
    if (!domain) return { domain: null, orgName: null };

    // Capitalize first part of domain as fallback name
    const parts = domain.split(".");
    const orgName = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);

    return { domain: domain, orgName: orgName };
  }

  // ============================================================================
  // Phone Number Utilities
  // ============================================================================

  /**
   * Extract contact info (phone, title) from email signatures
   */
  extractContactInfoFromEmails(emails: GmailMessage[]): { phone: string | null; title: string | null } {
    const info = { phone: null as string | null, title: null as string | null };

    for (const email of emails.slice(0, 5)) {
      const body = email.body || email.snippet || "";

      // Phone patterns - require explicit phone/tel/mobile label
      if (!info.phone) {
        const phoneMatch = body.match(
          /(?:phone|tel|mobile|cell|direct|fax)[\s:]+([+]?[\d\s\-().]{10,20})/i
        );
        if (phoneMatch) {
          const candidate = phoneMatch[1].trim();
          if (this.isValidPhoneNumber(candidate, body)) {
            info.phone = candidate;
          }
        }
      }

      // Title patterns (common in signatures)
      if (!info.title) {
        const titlePatterns = [
          /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s*[|,]\s*[A-Z]/m,
          /(?:^|\n)([A-Z][a-z]+(?:\s+(?:of|&|and|[A-Z][a-z]+))*)\s*$/m,
        ];
        for (const pattern of titlePatterns) {
          const match = body.match(pattern);
          if (match && match[1].length < 50) {
            info.title = match[1].trim();
            break;
          }
        }
      }

      if (info.phone && info.title) break;
    }

    return info;
  }

  /**
   * Validate that a number is a real phone number, not a meeting/Zoom code
   */
  isValidPhoneNumber(number: string, context: string): boolean {
    if (!number) return false;

    const digitsOnly = number.replace(/[\s\-().]/g, "");

    const lowerContext = context.toLowerCase();
    const numberIndex = context.indexOf(number);
    const surroundingContext =
      numberIndex >= 0
        ? context
            .substring(
              Math.max(0, numberIndex - 100),
              Math.min(context.length, numberIndex + number.length + 50)
            )
            .toLowerCase()
        : "";

    // Reject if near Zoom/meeting indicators
    const meetingIndicators = [
      "zoom",
      "meeting id",
      "webinar",
      "passcode",
      "conference",
      "dial-in",
      "access code",
    ];
    for (const indicator of meetingIndicators) {
      if (surroundingContext.includes(indicator)) {
        return false;
      }
    }

    // Reject plain 10-11 digit numbers without formatting (likely meeting IDs)
    if (/^\d{10,11}$/.test(digitsOnly) && !/[+\-().\s]/.test(number)) {
      return false;
    }

    // Accept numbers with country code (+)
    if (number.trim().startsWith("+")) {
      return true;
    }

    // Accept numbers with proper formatting
    if (/\(\d{2,4}\)/.test(number) || /\d{2,4}-\d{3,4}-\d{3,4}/.test(number)) {
      return true;
    }

    // Accept if digit count is reasonable and has some formatting
    if (digitsOnly.length >= 10 && digitsOnly.length <= 15 && /[\s\-()]/.test(number)) {
      return true;
    }

    return false;
  }

  /**
   * Find phone number from Gmail signatures using AI validation
   */
  async findPhoneNumber(email: string, personName: string, model: string = "gemini-pro-latest"): Promise<string | null> {
    if (!email) return null;

    // Only search emails FROM this person (their signature)
    const emailsFrom = await this.searchGmail(`from:${email}`, 10);

    if (emailsFrom.length === 0) {
      console.log(`[GSD] No emails found FROM ${email}`);
      return null;
    }

    // Collect phone number candidates
    const candidates: Array<{
      phone: string;
      normalized: string;
      context: string;
      score: number;
    }> = [];

    for (const msg of emailsFrom) {
      const body = msg.body || "";
      const snippet = msg.snippet || "";
      const fullContent = body || snippet;

      if (!fullContent) continue;

      // Focus on signature area (last 1500 chars)
      const signatureArea =
        fullContent.length > 1500 ? fullContent.slice(-1500) : fullContent;

      const phonePatterns = [
        /[+]\d[\d\s\-./()]{8,20}/g,
        /\b0\d[\d\s\-./()]{7,15}/g,
        /\b\d{2,5}[\s\-./]?\d{2,5}[\s\-./]?\d{2,5}[\s\-./]?\d{0,5}\b/g,
      ];

      for (const pattern of phonePatterns) {
        const matches = [...signatureArea.matchAll(pattern)];

        for (const match of matches) {
          const phone = match[0].trim();
          const normalized = phone.replace(/[\s\-./()]/g, "");
          const digitCount = (normalized.match(/\d/g) || []).length;

          if (digitCount >= 8 && digitCount <= 15) {
            const idx = signatureArea.indexOf(match[0]);
            const contextStart = Math.max(0, idx - 150);
            const contextEnd = Math.min(signatureArea.length, idx + match[0].length + 50);
            const context = signatureArea.substring(contextStart, contextEnd);

            let score = 0;
            const contextLower = context.toLowerCase();
            const nameParts = personName.toLowerCase().split(/\s+/);

            // +3 if person's name appears near the phone
            for (const part of nameParts) {
              if (part.length > 2 && contextLower.includes(part)) {
                score += 3;
              }
            }

            // +2 if labeled as mobile
            if (/mobil|cell|handy|m:|mobile/i.test(context)) {
              score += 2;
            }

            // +1 for international format
            if (phone.startsWith("+")) {
              score += 1;
            }

            // -2 if "assistant" or "office" nearby
            if (/assistant|sekretär|office|büro|reception/i.test(context)) {
              score -= 2;
            }

            candidates.push({ phone, normalized, context, score });
          }
        }
      }
    }

    if (candidates.length === 0) {
      return null;
    }

    // Sort by score and deduplicate
    candidates.sort((a, b) => b.score - a.score);

    const seen = new Set<string>();
    const uniqueCandidates = candidates.filter((c) => {
      if (seen.has(c.normalized)) return false;
      seen.add(c.normalized);
      return true;
    });

    // Use Gemini to validate
    const validationPrompt = `Find the PERSONAL phone number of "${personName}" (email: ${email}).

These phone numbers were found in emails SENT BY ${personName}. Which one is their PERSONAL/MOBILE number?

${uniqueCandidates
  .slice(0, 4)
  .map(
    (c, i) => `
CANDIDATE ${i + 1} (score: ${c.score}):
Phone: ${c.phone}
Context: "${c.context.replace(/\n/g, " ").substring(0, 200)}"
`
  )
  .join("\n")}

RULES:
- Pick the number that appears in ${personName}'s OWN signature
- Prefer MOBILE numbers (German mobile: 015x, 016x, 017x, or +49 1...)
- REJECT numbers labeled "assistant", "office", "sekretariat", "büro"
- REJECT numbers that belong to someone else mentioned in context

Respond with ONLY the phone number (e.g., +49 173 3919319) or "NONE" if uncertain.`;

    const result = await this.callGemini(
      "You are identifying personal contact information. Be very careful to return ONLY the person's OWN mobile number.",
      validationPrompt,
      model,
      false,
      (() => {
        const cfg = this.settings.generationConfigs?.phoneValidation;
        if (!cfg) return undefined;
        return {
          temperature: cfg.temperature,
          ...(cfg.thinkingBudget == null ? {} : { thinkingBudget: cfg.thinkingBudget }),
        };
      })()
    );

    let phoneNumber: string | null = null;

    if (result && !result.toUpperCase().includes("NONE")) {
      const phoneMatch = result.match(/[+]?\d[\d\s\-().]{7,}/);
      if (phoneMatch) {
        phoneNumber = phoneMatch[0].trim();
      }
    }

    // Fallback: use high-scoring candidate
    if (!phoneNumber && uniqueCandidates.length > 0 && uniqueCandidates[0].score >= 3) {
      phoneNumber = uniqueCandidates[0].phone;
    }

    return phoneNumber;
  }
}

