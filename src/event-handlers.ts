// ============================================================================
// Event Handlers - File and workspace event handlers
// ============================================================================

import { TFile } from "obsidian";
import type GetShitDonePlugin from "./main";

// ============================================================================
// Public API
// ============================================================================

/**
 * Register file change handler for index updates
 */
export function registerFileChangeHandler(plugin: GetShitDonePlugin): void {
  // Update index when files are modified
  plugin.registerEvent(
    plugin.app.vault.on("modify", (file) => {
      if (file instanceof TFile) {
        plugin.getIndexService().updateFileIndex(file);
      }
    })
  );

  // Update index when files are created
  plugin.registerEvent(
    plugin.app.vault.on("create", (file) => {
      if (file instanceof TFile) {
        // Delay slightly to let MetadataCache update
        setTimeout(() => plugin.getIndexService().updateFileIndex(file), 100);
      }
    })
  );

  // Rebuild relevant parts when files are deleted
  plugin.registerEvent(
    plugin.app.vault.on("delete", (file) => {
      if (file instanceof TFile) {
        // Could implement removeFromIndex, but for now just log
        console.log(`[GSD] File deleted: ${file.path}`);
      }
    })
  );

  // Update index when files are renamed
  plugin.registerEvent(
    plugin.app.vault.on("rename", (file, oldPath) => {
      if (file instanceof TFile) {
        setTimeout(() => plugin.getIndexService().updateFileIndex(file), 100);
      }
    })
  );
}

/**
 * Register file-open handler for auto-research
 */
export function registerFileOpenHandler(plugin: GetShitDonePlugin): void {
  plugin.registerEvent(
    plugin.app.workspace.on("file-open", async (file) => {
      if (!file) return;

      // People auto-research
      if (
        plugin.settings.autoResearchPeopleOnOpen &&
        file.path.startsWith(plugin.settings.peopleFolder + "/")
      ) {
        await handleAutoResearch(plugin, file, "person");
      }

      // Organization auto-research
      if (
        plugin.settings.autoResearchOrgsOnOpen &&
        file.path.startsWith(plugin.settings.organizationsFolder + "/")
      ) {
        await handleAutoResearch(plugin, file, "org");
      }
    })
  );
}

/**
 * Register URI handler for inbox captures
 * Handles: obsidian://gsd-inbox?content=...&type=...&source=...
 */
export function registerInboxURIHandler(plugin: GetShitDonePlugin): void {
  plugin.registerObsidianProtocolHandler("gsd-inbox", async (params) => {
    console.log("[GSD] Inbox URI handler triggered", params);
    await plugin.getInbox().processInboxItem(params);
  });
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Handle auto-research with duplicate prevention
 */
async function handleAutoResearch(
  plugin: GetShitDonePlugin,
  file: TFile,
  type: "person" | "org"
): Promise<void> {
  // Prevent duplicate research (in-memory check)
  if (plugin.isResearchingFile(file.path)) {
    console.log(`[GSD] Already researching ${file.path}, skipping`);
    return;
  }

  // Check if already researched
  const content = await plugin.app.vault.read(file);
  if (plugin.getVaultSearch().isResearched(content)) {
    return;
  }

  // Check if research is in progress (persistent check via note content)
  if (plugin.getVaultSearch().isResearchInProgress(content)) {
    console.log(`[GSD] Research in progress for ${file.path}, skipping`);
    return;
  }

  // Mark as researching
  plugin.markFileResearching(file.path);

  try {
    if (type === "person") {
      await plugin.getPersonResearch().researchPerson(file.path, { force: false });
    } else {
      await plugin.getOrgResearch().researchOrg(file.path, { force: false });
    }
  } finally {
    plugin.unmarkFileResearching(file.path);
  }
}
