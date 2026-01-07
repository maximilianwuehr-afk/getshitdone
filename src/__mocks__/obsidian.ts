// ============================================================================
// Obsidian API Mocks
// ============================================================================
// Mock implementations of Obsidian API for testing
// ============================================================================

import { vi } from "vitest";

// ============================================================================
// Core Classes
// ============================================================================

export class TFile {
  path: string;
  name: string;
  basename: string;
  extension: string;
  stat: { mtime: number; ctime: number; size: number };
  vault: Vault;

  constructor(path: string) {
    this.path = path;
    this.name = path.split("/").pop() || "";
    this.extension = this.name.split(".").pop() || "";
    this.basename = this.name.replace(`.${this.extension}`, "");
    this.stat = { mtime: Date.now(), ctime: Date.now(), size: 0 };
    this.vault = null as unknown as Vault;
  }
}

export class TFolder {
  path: string;
  name: string;
  children: (TFile | TFolder)[] = [];

  constructor(path: string) {
    this.path = path;
    this.name = path.split("/").pop() || "";
  }
}

export abstract class TAbstractFile {
  path: string;
  name: string;
  vault: Vault;

  constructor(path: string) {
    this.path = path;
    this.name = path.split("/").pop() || "";
    this.vault = null as unknown as Vault;
  }
}

// ============================================================================
// Vault
// ============================================================================

export class Vault {
  private files: Map<string, string> = new Map();
  private fileObjects: Map<string, TFile> = new Map();

  async read(file: TFile): Promise<string> {
    return this.files.get(file.path) || "";
  }

  async cachedRead(file: TFile): Promise<string> {
    return this.read(file);
  }

  async modify(file: TFile, content: string): Promise<void> {
    this.files.set(file.path, content);
  }

  async create(path: string, content: string): Promise<TFile> {
    const file = new TFile(path);
    this.files.set(path, content);
    this.fileObjects.set(path, file);
    return file;
  }

  async createFolder(path: string): Promise<void> {
    // No-op for mock
  }

  async delete(file: TFile): Promise<void> {
    this.files.delete(file.path);
    this.fileObjects.delete(file.path);
  }

  async rename(file: TFile, newPath: string): Promise<void> {
    const content = this.files.get(file.path) || "";
    this.files.delete(file.path);
    this.fileObjects.delete(file.path);
    file.path = newPath;
    this.files.set(newPath, content);
    this.fileObjects.set(newPath, file);
  }

  getAbstractFileByPath(path: string): TFile | TFolder | null {
    return this.fileObjects.get(path) || null;
  }

  getMarkdownFiles(): TFile[] {
    return Array.from(this.fileObjects.values()).filter(
      (f) => f.extension === "md"
    );
  }

  getFiles(): TFile[] {
    return Array.from(this.fileObjects.values());
  }

  on(event: string, callback: (...args: unknown[]) => void): { unload: () => void } {
    return { unload: () => {} };
  }

  // Test helpers
  _setFile(path: string, content: string): TFile {
    const file = new TFile(path);
    this.files.set(path, content);
    this.fileObjects.set(path, file);
    return file;
  }

  _getContent(path: string): string | undefined {
    return this.files.get(path);
  }
}

// ============================================================================
// Metadata Cache
// ============================================================================

export interface FrontMatterCache {
  [key: string]: unknown;
}

export interface CachedMetadata {
  frontmatter?: FrontMatterCache;
  links?: Array<{ link: string; displayText?: string }>;
  tags?: Array<{ tag: string }>;
  headings?: Array<{ heading: string; level: number }>;
}

export class MetadataCache {
  private cache: Map<string, CachedMetadata> = new Map();

  getFileCache(file: TFile): CachedMetadata | null {
    return this.cache.get(file.path) || null;
  }

  getCache(path: string): CachedMetadata | null {
    return this.cache.get(path) || null;
  }

  getFirstLinkpathDest(linkpath: string, sourcePath: string): TFile | null {
    return null;
  }

  on(event: string, callback: (...args: unknown[]) => void): { unload: () => void } {
    return { unload: () => {} };
  }

  // Test helpers
  _setCache(path: string, metadata: CachedMetadata): void {
    this.cache.set(path, metadata);
  }
}

// ============================================================================
// Workspace
// ============================================================================

export class WorkspaceLeaf {
  view: unknown = null;

  async setViewState(state: { type: string; active?: boolean }): Promise<void> {}

  getViewState(): { type: string } {
    return { type: "" };
  }
}

export class Workspace {
  private activeFile: TFile | null = null;

  getActiveFile(): TFile | null {
    return this.activeFile;
  }

  getActiveViewOfType<T>(type: unknown): T | null {
    return null;
  }

  getRightLeaf(create: boolean): WorkspaceLeaf | null {
    return create ? new WorkspaceLeaf() : null;
  }

  getLeaf(newLeaf?: boolean): WorkspaceLeaf {
    return new WorkspaceLeaf();
  }

  revealLeaf(leaf: WorkspaceLeaf): void {}

  detachLeavesOfType(type: string): void {}

  onLayoutReady(callback: () => void): void {
    callback();
  }

  on(event: string, callback: (...args: unknown[]) => void): { unload: () => void } {
    return { unload: () => {} };
  }

  // Test helpers
  _setActiveFile(file: TFile | null): void {
    this.activeFile = file;
  }
}

// ============================================================================
// App
// ============================================================================

export class App {
  vault: Vault;
  metadataCache: MetadataCache;
  workspace: Workspace;

  constructor() {
    this.vault = new Vault();
    this.metadataCache = new MetadataCache();
    this.workspace = new Workspace();
  }
}

// ============================================================================
// Plugin
// ============================================================================

export abstract class Plugin {
  app: App;
  manifest: { id: string; name: string; version: string };

  constructor(app: App, manifest: { id: string; name: string; version: string }) {
    this.app = app;
    this.manifest = manifest;
  }

  abstract onload(): void | Promise<void>;
  abstract onunload(): void;

  async loadData(): Promise<unknown> {
    return {};
  }

  async saveData(data: unknown): Promise<void> {}

  addCommand(command: {
    id: string;
    name: string;
    callback?: () => void;
    checkCallback?: (checking: boolean) => boolean | void;
    editorCallback?: (editor: Editor, view: MarkdownView) => void;
  }): void {}

  addSettingTab(tab: PluginSettingTab): void {}

  registerView(
    type: string,
    viewCreator: (leaf: WorkspaceLeaf) => ItemView
  ): void {}

  registerEvent(event: { unload: () => void }): void {}

  registerObsidianProtocolHandler(
    action: string,
    handler: (params: Record<string, string>) => void
  ): void {}
}

// ============================================================================
// Settings
// ============================================================================

export abstract class PluginSettingTab {
  app: App;
  plugin: Plugin;
  containerEl: HTMLElement;

  constructor(app: App, plugin: Plugin) {
    this.app = app;
    this.plugin = plugin;
    this.containerEl = document.createElement("div");
  }

  abstract display(): void;

  hide(): void {}
}

export class Setting {
  settingEl: HTMLElement;
  infoEl: HTMLElement;
  nameEl: HTMLElement;
  descEl: HTMLElement;
  controlEl: HTMLElement;

  constructor(containerEl: HTMLElement) {
    this.settingEl = document.createElement("div");
    this.infoEl = document.createElement("div");
    this.nameEl = document.createElement("div");
    this.descEl = document.createElement("div");
    this.controlEl = document.createElement("div");
    containerEl.appendChild(this.settingEl);
  }

  setName(name: string): this {
    return this;
  }

  setDesc(desc: string | DocumentFragment): this {
    return this;
  }

  setClass(cls: string): this {
    return this;
  }

  setHeading(): this {
    return this;
  }

  addText(cb: (text: TextComponent) => void): this {
    cb(new TextComponent(this.controlEl));
    return this;
  }

  addTextArea(cb: (text: TextAreaComponent) => void): this {
    cb(new TextAreaComponent(this.controlEl));
    return this;
  }

  addToggle(cb: (toggle: ToggleComponent) => void): this {
    cb(new ToggleComponent(this.controlEl));
    return this;
  }

  addDropdown(cb: (dropdown: DropdownComponent) => void): this {
    cb(new DropdownComponent(this.controlEl));
    return this;
  }

  addButton(cb: (button: ButtonComponent) => void): this {
    cb(new ButtonComponent(this.controlEl));
    return this;
  }

  addSlider(cb: (slider: SliderComponent) => void): this {
    cb(new SliderComponent(this.controlEl));
    return this;
  }
}

// ============================================================================
// Components
// ============================================================================

export class TextComponent {
  inputEl: HTMLInputElement;
  private value = "";

  constructor(containerEl: HTMLElement) {
    this.inputEl = document.createElement("input");
    containerEl.appendChild(this.inputEl);
  }

  getValue(): string {
    return this.value;
  }

  setValue(value: string): this {
    this.value = value;
    return this;
  }

  setPlaceholder(placeholder: string): this {
    return this;
  }

  onChange(callback: (value: string) => void): this {
    return this;
  }
}

export class TextAreaComponent {
  inputEl: HTMLTextAreaElement;
  private value = "";

  constructor(containerEl: HTMLElement) {
    this.inputEl = document.createElement("textarea");
    containerEl.appendChild(this.inputEl);
  }

  getValue(): string {
    return this.value;
  }

  setValue(value: string): this {
    this.value = value;
    return this;
  }

  setPlaceholder(placeholder: string): this {
    return this;
  }

  onChange(callback: (value: string) => void): this {
    return this;
  }
}

export class ToggleComponent {
  toggleEl: HTMLElement;
  private value = false;

  constructor(containerEl: HTMLElement) {
    this.toggleEl = document.createElement("div");
    containerEl.appendChild(this.toggleEl);
  }

  getValue(): boolean {
    return this.value;
  }

  setValue(value: boolean): this {
    this.value = value;
    return this;
  }

  onChange(callback: (value: boolean) => void): this {
    return this;
  }
}

export class DropdownComponent {
  selectEl: HTMLSelectElement;
  private value = "";

  constructor(containerEl: HTMLElement) {
    this.selectEl = document.createElement("select");
    containerEl.appendChild(this.selectEl);
  }

  getValue(): string {
    return this.value;
  }

  setValue(value: string): this {
    this.value = value;
    return this;
  }

  addOption(value: string, display: string): this {
    return this;
  }

  addOptions(options: Record<string, string>): this {
    return this;
  }

  onChange(callback: (value: string) => void): this {
    return this;
  }
}

export class ButtonComponent {
  buttonEl: HTMLButtonElement;

  constructor(containerEl: HTMLElement) {
    this.buttonEl = document.createElement("button");
    containerEl.appendChild(this.buttonEl);
  }

  setButtonText(name: string): this {
    return this;
  }

  setCta(): this {
    return this;
  }

  setWarning(): this {
    return this;
  }

  setIcon(icon: string): this {
    return this;
  }

  setTooltip(tooltip: string): this {
    return this;
  }

  onClick(callback: () => void): this {
    return this;
  }
}

export class SliderComponent {
  sliderEl: HTMLInputElement;
  private value = 0;

  constructor(containerEl: HTMLElement) {
    this.sliderEl = document.createElement("input");
    this.sliderEl.type = "range";
    containerEl.appendChild(this.sliderEl);
  }

  getValue(): number {
    return this.value;
  }

  setValue(value: number): this {
    this.value = value;
    return this;
  }

  setLimits(min: number, max: number, step: number): this {
    return this;
  }

  setDynamicTooltip(): this {
    return this;
  }

  onChange(callback: (value: number) => void): this {
    return this;
  }
}

// ============================================================================
// Editor
// ============================================================================

export class Editor {
  private content = "";
  private selection = "";
  private cursor = { line: 0, ch: 0 };

  getValue(): string {
    return this.content;
  }

  setValue(value: string): void {
    this.content = value;
  }

  getSelection(): string {
    return this.selection;
  }

  replaceSelection(replacement: string): void {
    this.selection = replacement;
  }

  getCursor(): { line: number; ch: number } {
    return this.cursor;
  }

  setCursor(pos: { line: number; ch: number } | number, ch?: number): void {
    if (typeof pos === "number") {
      this.cursor = { line: pos, ch: ch || 0 };
    } else {
      this.cursor = pos;
    }
  }

  getLine(line: number): string {
    return this.content.split("\n")[line] || "";
  }

  setLine(line: number, text: string): void {
    const lines = this.content.split("\n");
    lines[line] = text;
    this.content = lines.join("\n");
  }

  lineCount(): number {
    return this.content.split("\n").length;
  }

  // Test helpers
  _setContent(content: string): void {
    this.content = content;
  }

  _setSelection(selection: string): void {
    this.selection = selection;
  }
}

// ============================================================================
// Views
// ============================================================================

export abstract class ItemView {
  containerEl: HTMLElement;
  leaf: WorkspaceLeaf;

  constructor(leaf: WorkspaceLeaf) {
    this.leaf = leaf;
    this.containerEl = document.createElement("div");
  }

  abstract getViewType(): string;
  abstract getDisplayText(): string;

  onOpen(): Promise<void> {
    return Promise.resolve();
  }

  onClose(): Promise<void> {
    return Promise.resolve();
  }
}

export class MarkdownView extends ItemView {
  editor: Editor;
  file: TFile | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.editor = new Editor();
  }

  getViewType(): string {
    return "markdown";
  }

  getDisplayText(): string {
    return this.file?.basename || "Untitled";
  }
}

// ============================================================================
// Modals
// ============================================================================

export abstract class Modal {
  app: App;
  containerEl: HTMLElement;
  modalEl: HTMLElement;
  titleEl: HTMLElement;
  contentEl: HTMLElement;

  constructor(app: App) {
    this.app = app;
    this.containerEl = document.createElement("div");
    this.modalEl = document.createElement("div");
    this.titleEl = document.createElement("div");
    this.contentEl = document.createElement("div");
  }

  open(): void {}

  close(): void {}

  onOpen(): void {}

  onClose(): void {}
}

export abstract class SuggestModal<T> extends Modal {
  inputEl: HTMLInputElement;
  resultContainerEl: HTMLElement;

  constructor(app: App) {
    super(app);
    this.inputEl = document.createElement("input");
    this.resultContainerEl = document.createElement("div");
  }

  abstract getSuggestions(query: string): T[] | Promise<T[]>;
  abstract renderSuggestion(item: T, el: HTMLElement): void;
  abstract onChooseSuggestion(item: T, evt: MouseEvent | KeyboardEvent): void;

  setPlaceholder(placeholder: string): void {}
}

export abstract class FuzzySuggestModal<T> extends SuggestModal<T> {
  abstract getItems(): T[];
  abstract getItemText(item: T): string;
  abstract onChooseItem(item: T, evt: MouseEvent | KeyboardEvent): void;

  getSuggestions(query: string): T[] {
    return this.getItems();
  }

  renderSuggestion(item: T, el: HTMLElement): void {
    el.setText(this.getItemText(item));
  }

  onChooseSuggestion(item: T, evt: MouseEvent | KeyboardEvent): void {
    this.onChooseItem(item, evt);
  }
}

// ============================================================================
// Notice
// ============================================================================

export class Notice {
  noticeEl: HTMLElement;

  constructor(message: string | DocumentFragment, timeout?: number) {
    this.noticeEl = document.createElement("div");
  }

  hide(): void {}

  setMessage(message: string | DocumentFragment): this {
    return this;
  }
}

// ============================================================================
// Utilities
// ============================================================================

export function parseYaml(yaml: string): Record<string, unknown> {
  // Simple YAML parser for frontmatter
  const result: Record<string, unknown> = {};
  const lines = yaml.split("\n");

  for (const line of lines) {
    const match = line.match(/^(\w+):\s*(.*)$/);
    if (match) {
      const [, key, value] = match;
      // Try to parse as number, boolean, or keep as string
      if (value === "true") result[key] = true;
      else if (value === "false") result[key] = false;
      else if (!isNaN(Number(value)) && value !== "") result[key] = Number(value);
      else result[key] = value;
    }
  }

  return result;
}

export function stringifyYaml(obj: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(`  - ${item}`);
      }
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  return lines.join("\n");
}

export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/");
}

export function getLinkpath(link: string): string {
  return link.replace(/\[\[|\]\]/g, "").split("|")[0];
}

export function requestUrl(options: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<{ json: unknown; text: string; status: number }> {
  return Promise.resolve({
    json: {},
    text: "",
    status: 200,
  });
}

// ============================================================================
// Mock Helpers for Tests
// ============================================================================

export function createMockApp(): App {
  return new App();
}

export function createMockFile(path: string, content = ""): TFile {
  const file = new TFile(path);
  return file;
}
