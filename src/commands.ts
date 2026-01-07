// ============================================================================
// Commands - Command registration for GetShitDone plugin
// ============================================================================

import { Editor, MarkdownView, Notice } from "obsidian";
import type GetShitDonePlugin from "./main";
import { O3_DASHBOARD_VIEW } from "./views/o3-dashboard";

// ============================================================================
// Public API
// ============================================================================

/**
 * Register all plugin commands
 */
export function registerCommands(plugin: GetShitDonePlugin): void {
  registerResearchCommands(plugin);
  registerBriefingCommands(plugin);
  registerFeedbackCommands(plugin);
  registerIndexCommands(plugin);
  registerInboxCommands(plugin);
  registerCouncilCommands(plugin);
  registerO3Commands(plugin);
  registerReferenceCommands(plugin);
}

// ============================================================================
// Research Commands
// ============================================================================

function registerResearchCommands(plugin: GetShitDonePlugin): void {
  // Research Person command
  plugin.addCommand({
    id: "research-person",
    name: "Research Person",
    checkCallback: (checking: boolean) => {
      const file = plugin.app.workspace.getActiveFile();
      if (file && file.path.startsWith(plugin.settings.peopleFolder + "/")) {
        if (!checking) {
          plugin.getPersonResearch().researchPerson(file.path, { force: false });
        }
        return true;
      }
      return false;
    },
  });

  // Research Organization command
  plugin.addCommand({
    id: "research-org",
    name: "Research Organization",
    checkCallback: (checking: boolean) => {
      const file = plugin.app.workspace.getActiveFile();
      if (file && file.path.startsWith(plugin.settings.organizationsFolder + "/")) {
        if (!checking) {
          plugin.getOrgResearch().researchOrg(file.path, { force: false });
        }
        return true;
      }
      return false;
    },
  });

  // Re-research (force) command
  plugin.addCommand({
    id: "rerun-research",
    name: "Re-research (Force)",
    checkCallback: (checking: boolean) => {
      const file = plugin.app.workspace.getActiveFile();
      if (!file) return false;

      if (file.path.startsWith(plugin.settings.peopleFolder + "/")) {
        if (!checking) {
          plugin.getPersonResearch().researchPerson(file.path, { force: true });
        }
        return true;
      }

      if (file.path.startsWith(plugin.settings.organizationsFolder + "/")) {
        if (!checking) {
          plugin.getOrgResearch().researchOrg(file.path, { force: true });
        }
        return true;
      }

      return false;
    },
  });

  // Find Phone Number command
  plugin.addCommand({
    id: "find-phone",
    name: "Find Phone Number",
    checkCallback: (checking: boolean) => {
      const file = plugin.app.workspace.getActiveFile();
      if (file && file.path.startsWith(plugin.settings.peopleFolder + "/")) {
        if (!checking) {
          findPhoneNumberForCurrentFile(plugin);
        }
        return true;
      }
      return false;
    },
  });
}

// ============================================================================
// Briefing Commands
// ============================================================================

function registerBriefingCommands(plugin: GetShitDonePlugin): void {
  plugin.addCommand({
    id: "trigger-briefing",
    name: "Generate Briefing for Current Line",
    callback: () => {
      plugin.getMeetingBriefing().triggerBriefingForCurrentLine();
    },
  });
}

// ============================================================================
// Feedback Commands
// ============================================================================

function registerFeedbackCommands(plugin: GetShitDonePlugin): void {
  plugin.addCommand({
    id: "report-feedback",
    name: "Report Research Issue",
    checkCallback: (checking: boolean) => {
      const file = plugin.app.workspace.getActiveFile();
      if (!file) return false;

      const isPeople = file.path.startsWith(plugin.settings.peopleFolder + "/");
      const isOrg = file.path.startsWith(plugin.settings.organizationsFolder + "/");
      const isDaily = file.path.startsWith("Daily notes/");

      if (isPeople || isOrg || isDaily) {
        if (!checking) {
          plugin.getFeedback().addFeedbackForCurrentNote();
        }
        return true;
      }
      return false;
    },
  });
}

// ============================================================================
// Index Commands
// ============================================================================

function registerIndexCommands(plugin: GetShitDonePlugin): void {
  plugin.addCommand({
    id: "show-index-stats",
    name: "Show Index Statistics",
    callback: () => showIndexStats(plugin),
  });

  plugin.addCommand({
    id: "rebuild-index",
    name: "Rebuild Search Index",
    callback: () => rebuildIndex(plugin),
  });
}

// ============================================================================
// Inbox Commands
// ============================================================================

function registerInboxCommands(plugin: GetShitDonePlugin): void {
  plugin.addCommand({
    id: "inbox-capture-clipboard",
    name: "Inbox: Capture from Clipboard",
    callback: () => plugin.getInbox().captureFromClipboard(),
  });
}

// ============================================================================
// Council Commands
// ============================================================================

function registerCouncilCommands(plugin: GetShitDonePlugin): void {
  plugin.addCommand({
    id: "run-llm-council",
    name: "Run LLM Council",
    callback: () => plugin.getLlmCouncil().runCouncil(),
  });
}

// ============================================================================
// O3 Commands
// ============================================================================

function registerO3Commands(plugin: GetShitDonePlugin): void {
  plugin.addCommand({
    id: "open-o3-dashboard",
    name: "Open O3 Dashboard",
    callback: () => activateO3Dashboard(plugin),
  });
}

// ============================================================================
// Reference Commands
// ============================================================================

function registerReferenceCommands(plugin: GetShitDonePlugin): void {
  plugin.addCommand({
    id: "save-reference-clipboard",
    name: "Save Reference from Clipboard",
    callback: () => saveReferenceFromClipboard(plugin),
  });

  plugin.addCommand({
    id: "tag-and-link",
    name: "Tag and Link Selection/Note",
    editorCallback: (editor: Editor, view: MarkdownView) => tagAndLinkContent(plugin, editor, view),
  });
}

// ============================================================================
// Command Helpers
// ============================================================================

async function activateO3Dashboard(plugin: GetShitDonePlugin): Promise<void> {
  const leaf = plugin.app.workspace.getRightLeaf(false);
  await leaf?.setViewState({ type: O3_DASHBOARD_VIEW, active: true });
  if (leaf) {
    plugin.app.workspace.revealLeaf(leaf);
  }
}

async function saveReferenceFromClipboard(plugin: GetShitDonePlugin): Promise<void> {
  try {
    const content = await navigator.clipboard.readText();
    if (!content.trim()) {
      new Notice("Clipboard is empty");
      return;
    }

    const urlMatch = content.trim().match(/^https?:\/\/[^\s]+/);
    if (!urlMatch) {
      new Notice("Clipboard doesn't contain a URL");
      return;
    }

    const url = urlMatch[0];
    await plugin.getReference().processUrl(url);
  } catch (error) {
    console.error("[GSD] Failed to read clipboard:", error);
    new Notice("Failed to read clipboard");
  }
}

async function tagAndLinkContent(
  plugin: GetShitDonePlugin,
  editor: Editor,
  view: MarkdownView
): Promise<void> {
  const selection = editor.getSelection();
  const hasSelection = selection.length > 0;
  const content = hasSelection ? selection : editor.getValue();

  if (!content.trim()) {
    new Notice("No content to tag");
    return;
  }

  new Notice("Analyzing content...");

  try {
    let tags: string[] = [];
    const topicsContent = await plugin.getReference().getTopicsFileContent();

    if (topicsContent && plugin.settings.reference.enabled) {
      const title = view.file?.basename || "Untitled";
      tags = await plugin.getReference().matchTopicsForContent(title, content);
    }

    const entities = plugin.getIndexService().findEntitiesInContent(content);

    const tagStr = tags.filter(t => t !== "uncategorized").map(t => `#${t}`).join(" ");
    const entityLinks = entities.map(e => `[[${e.path.replace(".md", "")}|${e.name}]]`);

    if (hasSelection) {
      let result = selection;
      if (tagStr) {
        result += ` ${tagStr}`;
      }
      if (entityLinks.length > 0) {
        result += `\n\nRelated: ${entityLinks.join(", ")}`;
      }
      editor.replaceSelection(result);
      new Notice(`Added ${tags.length} tags, ${entities.length} entities`);
    } else {
      const cursor = editor.getCursor();
      const currentContent = editor.getValue();

      if (tagStr) {
        const separator = currentContent.endsWith("\n") ? "" : "\n";
        editor.setValue(currentContent + separator + "\n" + tagStr);
        editor.setCursor(cursor);
      }

      if (entityLinks.length > 0) {
        new Notice(`Tags: ${tagStr || "none"}\nEntities: ${entityLinks.join(", ")}`, 8000);
      } else {
        new Notice(`Tags: ${tagStr || "none"}\nNo entities found`, 5000);
      }
    }
  } catch (error) {
    console.error("[GSD] Tag and link failed:", error);
    new Notice("Failed to analyze content");
  }
}

function showIndexStats(plugin: GetShitDonePlugin): void {
  const stats = plugin.getIndexService().getStats();
  const message = `Index Stats:\n• People (email): ${stats.peopleByEmail}\n• People (name): ${stats.peopleByName}\n• O3 people: ${stats.o3People}\n• Orgs (domain): ${stats.orgsByDomain}\n• Orgs (name): ${stats.orgsByName}\n• Person-meeting links: ${stats.personMeetingMappings}`;
  new Notice(message, 8000);
  console.log("[GSD] " + message.replace(/\n/g, " | "));
}

async function rebuildIndex(plugin: GetShitDonePlugin): Promise<void> {
  new Notice("Rebuilding index...");
  await plugin.getIndexService().buildIndexes();
  const stats = plugin.getIndexService().getStats();
  new Notice(`Index rebuilt: ${stats.peopleByEmail} emails, ${stats.orgsByDomain} domains`);
}

async function findPhoneNumberForCurrentFile(plugin: GetShitDonePlugin): Promise<void> {
  const file = plugin.app.workspace.getActiveFile();
  if (!file) {
    new Notice("No active file");
    return;
  }

  const content = await plugin.app.vault.read(file);
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) {
    new Notice("No frontmatter found");
    return;
  }

  const existingPhone = fmMatch[1].match(/^Phone:\s*(.+)$/m);
  if (existingPhone && existingPhone[1].trim() && /[+\d]/.test(existingPhone[1])) {
    new Notice("Phone number already exists");
    return;
  }

  const emailMatch = fmMatch[1].match(/^Email:\s*(.+)$/m);
  const email = emailMatch ? emailMatch[1].trim() : null;

  if (!email) {
    new Notice("No email address found");
    return;
  }

  new Notice(`Searching for ${file.basename}'s phone number...`);

  const phone = await plugin.getGoogleServices().findPhoneNumber(
    email,
    file.basename,
    plugin.settings.models.phoneValidationModel
  );

  if (phone) {
    let newContent = content;
    const fm = fmMatch[1];

    if (/^Phone:\s*$/m.test(fm) || /^Phone:\s*\n/m.test(fm)) {
      const newFm = fm.replace(/^Phone:\s*$/m, `Phone: ${phone}`);
      newContent = content.replace(/^---\n[\s\S]*?\n---/, `---\n${newFm}\n---`);
    } else if (!/^Phone:/m.test(fm)) {
      const newFm = fm + `\nPhone: ${phone}`;
      newContent = content.replace(/^---\n[\s\S]*?\n---/, `---\n${newFm}\n---`);
    }

    await plugin.app.vault.modify(file, newContent);
    new Notice(`Found phone: ${phone}`);
  } else {
    new Notice("Could not find phone number");
  }
}
