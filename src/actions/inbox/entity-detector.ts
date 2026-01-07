// ============================================================================
// Entity Detector - Extract and link people/organizations
// ============================================================================

import { App, TFile, Modal, Setting } from "obsidian";
import type { PluginSettings, InboxItem } from "../../types";
import { IndexService } from "../../services/index-service";
import type { InboxRouteDecision } from "./types";

const moment = (window as any).moment;

// ============================================================================
// Public API
// ============================================================================

/**
 * Extract people and organizations mentioned in content
 * Returns array of { type: "person" | "org", name: string, path: string }
 *
 * Uses IndexService for O(n) lookup where n = words in content (not files in vault)
 */
export async function extractEntities(
  content: string,
  indexService: IndexService
): Promise<Array<{ type: "person" | "org"; name: string; path: string }>> {
  try {
    return indexService.findEntitiesInContent(content);
  } catch (error: unknown) {
    console.log("[GSD Inbox] Entity extraction failed:", error);
    return [];
  }
}

/**
 * Detect entity mentions for smart suggestions
 * Similar to extractEntities but returns simplified format
 */
export async function detectEntityMentions(
  content: string,
  indexService: IndexService
): Promise<Array<{ type: "person" | "org"; name: string; notePath: string }>> {
  const entities = await extractEntities(content, indexService);
  return entities.map(e => ({
    type: e.type,
    name: e.name,
    notePath: e.path.replace(".md", ""), // Remove .md extension for wikilinks
  }));
}

/**
 * Format content with entity wikilinks
 */
export function formatWithEntityLinks(
  content: string,
  entities: Array<{ type: "person" | "org"; name: string; path: string }>,
  settings: PluginSettings
): string {
  let formatted = content;

  // Sort by length (longest first) to avoid partial matches
  const sortedEntities = [...entities].sort((a, b) => b.name.length - a.name.length);

  for (const entity of sortedEntities) {
    const folder = entity.type === "person" ? settings.peopleFolder : settings.organizationsFolder;
    const wikilink = `[[${folder}/${entity.name}|${entity.name}]]`;

    // Replace name with wikilink (case-insensitive, whole word)
    const regex = new RegExp(`\\b${entity.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    formatted = formatted.replace(regex, wikilink);
  }

  return formatted;
}

// ============================================================================
// Smart Suggestion Modal
// ============================================================================

/**
 * Smart Suggestion Modal
 * Shows detected entities and allows user to add information to their notes
 */
export class SmartSuggestionModal extends Modal {
  private item: InboxItem;
  private suggestions: Array<{ type: "person" | "org"; name: string; notePath: string }>;
  private selectedEntities: Set<string> = new Set();
  private onComplete: (selected: Array<{ type: "person" | "org"; name: string; notePath: string }>, shouldAdd: boolean) => Promise<void>;

  constructor(
    app: App,
    item: InboxItem,
    suggestions: Array<{ type: "person" | "org"; name: string; notePath: string }>,
    onComplete: (selected: Array<{ type: "person" | "org"; name: string; notePath: string }>, shouldAdd: boolean) => Promise<void>
  ) {
    super(app);
    this.item = item;
    this.suggestions = suggestions;
    this.onComplete = onComplete;

    // Select all by default
    suggestions.forEach(s => this.selectedEntities.add(s.notePath));
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "Smart Suggestion" });
    contentEl.createEl("p", {
      text: "I detected mentions of people or organizations in your note. Would you like to add this information to their notes?"
    });

    contentEl.createEl("p", {
      text: `Content: "${this.item.content.substring(0, 100)}${this.item.content.length > 100 ? "..." : ""}"`,
      cls: "gsd-suggestion-content"
    });

    contentEl.createEl("h3", { text: "Detected entities:" });

    // Create checkboxes for each entity
    this.suggestions.forEach(suggestion => {
      new Setting(contentEl)
        .setName(suggestion.name)
        .setDesc(`${suggestion.type === "person" ? "Person" : "Organization"} note: [[${suggestion.notePath}]]`)
        .addToggle(toggle => {
          toggle.setValue(this.selectedEntities.has(suggestion.notePath))
            .onChange(value => {
              if (value) {
                this.selectedEntities.add(suggestion.notePath);
              } else {
                this.selectedEntities.delete(suggestion.notePath);
              }
            });
        });
    });

    // Buttons
    new Setting(contentEl)
      .addButton(button => {
        button.setButtonText("Add to Notes")
          .setCta()
          .onClick(async () => {
            const selected = this.suggestions.filter(s => this.selectedEntities.has(s.notePath));
            this.close();
            await this.onComplete(selected, true);
          });
      })
      .addButton(button => {
        button.setButtonText("Skip")
          .onClick(async () => {
            this.close();
            await this.onComplete([], false);
          });
      });
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}

/**
 * Show smart suggestion modal for adding info to entity notes
 */
export async function showSmartSuggestion(
  app: App,
  item: InboxItem,
  suggestions: Array<{ type: "person" | "org"; name: string; notePath: string }>,
  onRoute: () => Promise<{ decision: InboxRouteDecision; item: InboxItem }>,
  onAppend: (item: InboxItem, decision: InboxRouteDecision) => Promise<void>
): Promise<void> {
  const modal = new SmartSuggestionModal(
    app,
    item,
    suggestions,
    async (selectedEntities, shouldAdd) => {
      if (!shouldAdd) {
        // User declined - proceed with normal routing
        const { decision, item: updatedItem } = await onRoute();
        updatedItem.destination = decision.destination;
        await onAppend(updatedItem, decision);
        return;
      }

      // Add info to selected entity notes
      for (const entity of selectedEntities) {
        const file = app.vault.getAbstractFileByPath(`${entity.notePath}.md`);
        if (file && file instanceof TFile) {
          const content = await app.vault.read(file);
          const timestamp = moment().format("YYYY-MM-DD HH:mm");
          const infoToAdd = `\n- ${timestamp} ${item.content}`;
          await app.vault.modify(file, content + infoToAdd);
        }
      }

      // Note: Original implementation showed notice here
      // new Notice(`Added information to ${selectedEntities.length} note(s)`);
    }
  );

  modal.open();
}
