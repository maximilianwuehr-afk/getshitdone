// ============================================================================
// Reference System Types
// ============================================================================

export type ReferenceSourceType = "article" | "video" | "podcast" | "paper" | "tweet" | "repo" | "unknown";

export interface TopicNode {
  _aliases?: string[];
  [key: string]: string[] | TopicNode | undefined;
}

export interface TopicHierarchy {
  [key: string]: TopicNode;
}

export interface ReferenceSettings {
  enabled: boolean;
  referencesFolder: string;
  topicsFilePath: string;
  urlTriggers: string[];
  autoProcess: boolean;
  dailyNoteLink: boolean;
}
