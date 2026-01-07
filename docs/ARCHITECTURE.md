# GetShitDone Architecture

## Overview

GetShitDone is an Obsidian plugin for AI-powered productivity. It provides research automation, meeting briefings, inbox routing, and 1:1 meeting prep.

## Directory Structure

```
src/
├── main.ts              # Plugin entry point, lifecycle
├── commands.ts          # Command registration
├── event-handlers.ts    # File/workspace event handlers
├── prompts.ts           # Auto-generated from prompts/*.md
│
├── types/               # TypeScript interfaces
│   ├── settings.ts      # PluginSettings, ModelSettings
│   ├── inbox.ts         # InboxItem, InboxRoutingRule
│   ├── calendar.ts      # CalendarEvent, Attendee
│   ├── research.ts      # Research result types
│   ├── council.ts       # LLM Council types
│   ├── openrouter.ts    # OpenRouter model types
│   ├── o3.ts            # O3 settings types
│   ├── defaults.ts      # DEFAULT_SETTINGS
│   └── index.ts         # Re-exports
│
├── settings/            # Settings UI tabs
│   ├── settings-tab.ts  # Main SettingTab class
│   ├── general-tab.ts   # General settings
│   ├── api-tab.ts       # API keys, webhook
│   ├── models-tab.ts    # AI model selection
│   ├── daily-tab.ts     # Daily notes config
│   ├── inbox-tab.ts     # Inbox routing rules
│   ├── council-tab.ts   # LLM Council config
│   ├── o3-tab.ts        # O3 prep settings
│   ├── openrouter-tab.ts# OpenRouter model browser
│   ├── helpers.ts       # Shared UI utilities
│   └── index.ts         # Re-exports
│
├── services/            # Core services
│   ├── ai-service.ts    # Unified AI interface
│   ├── ai-provider.ts   # Provider interface
│   ├── anthropic-provider.ts
│   ├── openai-provider.ts
│   ├── gemini-provider.ts
│   ├── openrouter-provider.ts
│   ├── google-services.ts  # Gmail, Drive, Calendar
│   ├── calendar.ts      # Event parsing
│   ├── vault-search.ts  # Vault search with index
│   ├── index-service.ts # People/org indexes
│   ├── council-runner.ts# LLM Council orchestration
│   └── webhook-server.ts# HTTP server for transcripts
│
├── actions/             # Feature actions
│   ├── person-research.ts  # Auto-research people
│   ├── org-research.ts     # Auto-research orgs
│   ├── meeting-briefing.ts # Meeting prep
│   ├── daily-note.ts       # Daily note generation
│   ├── feedback.ts         # Research feedback
│   ├── reference.ts        # URL to note
│   ├── llm-council.ts      # Council orchestration
│   ├── amie-transcript.ts  # Transcript processing
│   ├── o3-coach.ts         # O3 coaching
│   │
│   ├── inbox/           # Inbox module
│   │   ├── inbox-action.ts # Main InboxAction class
│   │   ├── router.ts       # Routing engine
│   │   ├── formatter.ts    # Output formatting
│   │   ├── triggers.ts     # Trigger detection
│   │   ├── entity-detector.ts # Entity extraction
│   │   ├── date-parser.ts  # Natural language dates
│   │   ├── types.ts        # Local types
│   │   └── index.ts        # Re-exports
│   │
│   └── o3/              # O3 prep module
│       ├── o3-prep-action.ts # Main O3PrepAction class
│       ├── context-builder.ts # Context aggregation
│       ├── master-note.ts    # Master note CRUD
│       ├── person-loader.ts  # O3 people loading
│       ├── types.ts          # Local types
│       └── index.ts          # Re-exports
│
├── views/               # Custom Obsidian views
│   └── o3-dashboard.ts  # O3 dashboard view
│
├── utils/               # Utilities
│   ├── deep-merge.ts    # Settings merge
│   └── error-handler.ts # Error handling
│
├── __mocks__/           # Test mocks
│   ├── obsidian.ts      # Obsidian API mock
│   ├── services.ts      # Service factories
│   └── setup.ts         # Global test setup
│
└── prompts/             # Prompt templates (edit these)
    ├── meeting-filter.md
    ├── meeting-briefing.md
    ├── person-research.md
    ├── org-research.md
    ├── inbox-routing.md
    └── research.md
```

## Service Dependency Graph

```
GetShitDonePlugin (main.ts)
│
├── Services (initialized first)
│   ├── AIService ─────────────────┐
│   │   ├── AnthropicProvider      │
│   │   ├── OpenAIProvider         │
│   │   ├── GeminiProvider         │
│   │   └── OpenRouterProvider     │
│   │                              │
│   ├── GoogleServices ◄───────────┘ (requires AIService)
│   │   ├── Gmail search/summarize
│   │   ├── Drive search
│   │   └── Calendar events
│   │
│   ├── CalendarService (standalone)
│   │
│   ├── IndexService ◄──── VaultSearchService
│   │   ├── peopleByEmail index
│   │   ├── peopleByName index
│   │   ├── orgsByDomain index
│   │   └── orgsByName index
│   │
│   └── WebhookServer (standalone)
│
├── Actions (initialized second, depend on services)
│   ├── PersonResearchAction
│   │   └── requires: GoogleServices, AIService, VaultSearch
│   │
│   ├── OrgResearchAction
│   │   └── requires: GoogleServices, AIService, VaultSearch
│   │
│   ├── MeetingBriefingAction
│   │   └── requires: GoogleServices, AIService, VaultSearch
│   │   └── circular: PersonResearchAction (via setter)
│   │
│   ├── DailyNoteAction
│   │   └── requires: CalendarService, VaultSearch, MeetingBriefing
│   │
│   ├── InboxAction
│   │   └── requires: CalendarService, GoogleServices, AIService,
│   │                 VaultSearch, IndexService
│   │
│   ├── O3PrepAction
│   │   └── requires: CalendarService, VaultSearch, IndexService,
│   │                 GoogleServices, AIService
│   │
│   ├── O3CoachAction
│   │   └── requires: VaultSearch, IndexService, GoogleServices, AIService
│   │
│   ├── ReferenceAction
│   │   └── requires: IndexService, AIService
│   │
│   ├── LlmCouncilAction
│   │   └── requires: AIService
│   │
│   ├── FeedbackAction (standalone)
│   │
│   └── AmieTranscriptAction
│       └── requires: CalendarService
│
└── Wiring (circular dependencies via setters)
    ├── MeetingBriefing.setPersonResearch(PersonResearch)
    ├── PersonResearch.setFeedback(Feedback)
    ├── OrgResearch.setFeedback(Feedback)
    └── MeetingBriefing.setFeedback(Feedback)
```

## Circular Dependencies

These are resolved via setter injection after all services/actions are constructed:

| Component | Depends On | Via |
|-----------|------------|-----|
| MeetingBriefingAction | PersonResearchAction | `setPersonResearch()` |
| PersonResearchAction | FeedbackAction | `setFeedback()` |
| OrgResearchAction | FeedbackAction | `setFeedback()` |
| MeetingBriefingAction | FeedbackAction | `setFeedback()` |

Validation occurs in `main.ts:validateDependencies()` after wiring.

## Settings Flow

1. `loadSettings()` - Deep merges saved data with `DEFAULT_SETTINGS`
2. Components receive settings via constructor
3. `saveSettings()` - Persists and notifies all `SettingsAware` subscribers
4. Each subscriber implements `updateSettings(settings: PluginSettings)`

```typescript
interface SettingsAware {
  updateSettings(settings: PluginSettings): void;
}
```

## AI Provider Selection

The `AIService` routes requests to the appropriate provider:

| Model Prefix | Provider |
|--------------|----------|
| `claude-*` | AnthropicProvider |
| `gpt-*`, `o1-*`, `o3-*` | OpenAIProvider |
| `gemini-*` | GeminiProvider |
| `openrouter:*` or contains `/` | OpenRouterProvider |

## Key Patterns

### 1. Backward Compatible Re-exports

When splitting modules, the original file becomes a re-export:

```typescript
// src/actions/inbox.ts (original location)
export * from "./inbox/index";
```

### 2. Section Markers

Files use consistent section markers:

```typescript
// ============================================================================
// Public API
// ============================================================================

// ============================================================================
// Private Helpers
// ============================================================================
```

### 3. Error Handling

Use the error handler utility:

```typescript
import { handleError, handleErrorWithDefault } from "../utils/error-handler";

// Log and optionally show notice
handleError("Context: operation failed", error, { showNotice: true });

// Return default value on error
const result = handleErrorWithDefault("Context", error, defaultValue);
```

### 4. Testing

Tests use the mocked Obsidian API:

```typescript
import { describe, it, expect } from "vitest";
import { createMockSettings, createMockApp } from "../__mocks__/services";

describe("MyFeature", () => {
  it("does something", () => {
    const settings = createMockSettings({ someOption: true });
    // ...
  });
});
```

## File Size Guidelines

Target: No file over 500 lines of code. When approaching this limit:

1. Identify logical groupings (public API, helpers, types)
2. Extract to separate files in a subdirectory
3. Create `index.ts` with re-exports
4. Update original file to re-export from new location

## Commands

All commands registered in `commands.ts`:

| ID | Name | Condition |
|----|------|-----------|
| `research-person` | Research Person | In People folder |
| `research-org` | Research Organization | In Organizations folder |
| `rerun-research` | Re-research (Force) | In People/Orgs folder |
| `find-phone` | Find Phone Number | In People folder |
| `trigger-briefing` | Generate Briefing for Current Line | Always |
| `report-feedback` | Report Research Issue | In People/Orgs/Daily |
| `show-index-stats` | Show Index Statistics | Always |
| `rebuild-index` | Rebuild Search Index | Always |
| `inbox-capture-clipboard` | Inbox: Capture from Clipboard | Always |
| `run-llm-council` | Run LLM Council | Always |
| `open-o3-dashboard` | Open O3 Dashboard | Always |
| `save-reference-clipboard` | Save Reference from Clipboard | Always |
| `tag-and-link` | Tag and Link Selection/Note | Editor |

## Event Handlers

Registered in `event-handlers.ts`:

| Event | Handler | Purpose |
|-------|---------|---------|
| `vault.on("modify")` | Update file index | Keep indexes current |
| `vault.on("create")` | Update file index | Index new files |
| `vault.on("delete")` | Log deletion | (Could add removeFromIndex) |
| `vault.on("rename")` | Update file index | Handle renames |
| `workspace.on("file-open")` | Auto-research | Research people/orgs on open |
| `obsidian://gsd-inbox` | Inbox capture | URI handler for captures |

## Templater API

Exposed via `plugin.api`:

```typescript
// Generate daily note meeting list
await app.plugins.plugins["getshitdone"].api.generateDailyNote(tp);

// Research current person/org note
await app.plugins.plugins["getshitdone"].api.researchPerson(tp);
await app.plugins.plugins["getshitdone"].api.researchOrg(tp);

// Capture to inbox
await app.plugins.plugins["getshitdone"].api.captureToInbox(content, type);

// Run LLM Council
await app.plugins.plugins["getshitdone"].api.runCouncil();

// Save URL as reference
await app.plugins.plugins["getshitdone"].api.saveReference(url);
```
