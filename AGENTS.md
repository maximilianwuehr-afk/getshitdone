# AGENTS.md

Instructions for AI coding assistants working on the GetShitDone Obsidian plugin.

## Project Overview

GetShitDone is an Obsidian plugin that provides AI-powered research, meeting preparation, and content management. It integrates with multiple AI providers (Gemini, OpenAI, Anthropic, OpenRouter) and external services (Gmail, Google Calendar, Google Docs).

## Architecture Patterns

### Action Pattern
Actions in `src/actions/` are feature handlers that:
- Accept dependencies via constructor (App, Settings, Services)
- Implement `updateSettings(settings: PluginSettings)` for reactive updates
- Return results or modify vault files directly
- Use services for reusable functionality

Example structure:
```typescript
export class MyAction {
  constructor(
    app: App,
    settings: PluginSettings,
    aiService: AIService,
    // ... other dependencies
  ) {}

  updateSettings(settings: PluginSettings): void {
    this.settings = settings;
  }

  async doSomething(): Promise<Result> {
    // Implementation
  }
}
```

### Provider Pattern
AI providers in `src/services/*-provider.ts` implement the `AIProvider` interface:
```typescript
interface AIProvider {
  callModel(
    system: string,
    user: string,
    model: string,
    options?: AICallOptions
  ): Promise<string | null>;
}
```

Providers handle:
- API authentication and requests
- Feature mapping (web search, reasoning effort)
- Error handling with retry logic
- Model-specific parameter translation

### Service Pattern
Services provide shared functionality:
- `AIService`: Routes to correct provider based on model name
- `IndexService`: In-memory indexes for fast lookups
- `VaultSearchService`: Vault queries and frontmatter parsing
- `GoogleServices`: Gmail/Docs via Apps Script proxy

### Settings-Aware Components
All major components implement `SettingsAware`:
```typescript
interface SettingsAware {
  updateSettings(settings: PluginSettings): void;
}
```

The main plugin maintains a registry and broadcasts settings changes.

## Key Files

| File | Purpose |
|------|---------|
| `src/main.ts` | Plugin entry point, command registration, service wiring |
| `src/settings.ts` | Settings UI with tabbed interface |
| `src/types.ts` | All TypeScript types and interfaces |
| `src/services/ai-service.ts` | Central AI routing logic |
| `src/services/ai-provider.ts` | AIProvider interface definition |

## Coding Conventions

### Error Handling
Always use the standardized error handler:
```typescript
import { handleError, handleErrorWithDefault } from "../utils/error-handler";

try {
  // operation
} catch (error: unknown) {
  handleError("Context: What failed", error, {
    showNotice: true,  // Show user notification
    noticeMessage: "User-friendly message",
    additionalContext: { key: "value" },
    silent: false,  // Set true to suppress console output
  });
}
```

### Frontmatter Parsing
Use VaultSearchService for frontmatter operations:
```typescript
const fm = this.vaultSearch.parseFrontmatter<Record<string, any>>(content);
const updated = this.vaultSearch.updateFrontmatterInContent(content, "key", "value");
```

### AI Calls
Use AIService for all AI operations:
```typescript
const response = await this.aiService.callModel(
  systemPrompt,
  userPrompt,
  this.settings.models.someModel,
  {
    useSearch: true,      // Enable web search
    temperature: 0.7,
    thinkingBudget: 1000, // For reasoning models
  }
);
```

### Logging
Use the `[GSD]` prefix for console logs:
```typescript
console.log("[GSD] Message here");
console.warn("[GSD] Warning message");
console.error("[GSD] Error message");
```

## Adding New Features

### New Action
1. Create `src/actions/my-action.ts`
2. Implement constructor with dependencies
3. Implement `updateSettings()` method
4. Add to `main.ts`:
   - Import and instantiate in `onload()`
   - Add to `settingsSubscribers` array
5. Register commands if needed

### New AI Provider
1. Create `src/services/my-provider.ts` implementing `AIProvider`
2. Add to `AIService`:
   - Import and instantiate
   - Add to `updateSettings()`
   - Update `detectProvider()` with model patterns
   - Update `getProvider()` method
3. Add API key to `types.ts` (PluginSettings) and `settings.ts`

### New Command
Register in `main.ts` `registerCommands()`:
```typescript
this.addCommand({
  id: "my-command-id",
  name: "My Command Name",
  callback: () => this.myAction.doSomething(),
  // OR use checkCallback for conditional availability
});
```

### New Setting
1. Add to `PluginSettings` interface in `types.ts`
2. Add default value to `DEFAULT_SETTINGS` in `types.ts`
3. Add UI in `settings.ts` under appropriate tab

## Testing Changes

1. Run `npm run build` to compile
2. Copy `main.js` and `manifest.json` to test vault
3. Reload Obsidian or the plugin
4. Check console for `[GSD]` logs

## Common Gotchas

### Circular Dependencies
The plugin uses setter injection for circular deps:
```typescript
this.meetingBriefing.setPersonResearch(this.personResearch);
```

### File Operations
Always check file existence before operations:
```typescript
const file = this.app.vault.getAbstractFileByPath(path);
if (!(file instanceof TFile)) return;
```

### Settings Deep Merge
New settings fields must have defaults in `DEFAULT_SETTINGS`. The plugin uses deep merge to preserve existing user settings.

### OpenRouter Model Detection
Models containing `/` (e.g., `meta-llama/llama-3-70b`) are routed to OpenRouter. Use `openrouter:auto-free` for automatic free model fallback.

### Index Invalidation
The IndexService updates on file create/modify/rename/delete events. Manual rebuild available via command.

## Prompt Development

Prompts are in `prompts/*.md` and compiled to `src/prompts.ts`:

1. Edit markdown file in `prompts/`
2. Run `npm run generate-prompts` or `npm run build`
3. Import from `../prompts` in TypeScript

Prompt files support:
- Markdown formatting (converted to string)
- Variables via template interpolation in code

## Dependencies

- **obsidian**: ^1.4.0 - Obsidian API types
- **typescript**: ^5.3.0 - Type safety
- **esbuild**: ^0.19.0 - Fast bundling
- **tslib**: ^2.8.1 - TypeScript runtime helpers

## External Integrations

### Google Apps Script
Required for Gmail/Docs access. Expects endpoints:
- `searchEmails`: Search Gmail
- `getDocContent`: Read Google Doc
- `modifyDocText`: Write to Google Doc

### Google Calendar Plugin
Uses the Obsidian Google Calendar plugin API for event data.

### Summarize Plugin
Optional integration for URL summarization in ReferenceAction.
