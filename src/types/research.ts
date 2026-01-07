// ============================================================================
// Research Types
// ============================================================================

export interface PersonResearchResult {
  success: boolean;
  personName: string;
  email?: string;
  orgResult?: OrgLinkResult;
  extractedInfo?: ExtractedPersonInfo;
}

export interface ExtractedPersonInfo {
  title?: string;
  organization?: string;
  location?: string;
  phone?: string;
}

export interface OrgLinkResult {
  name: string;
  created: boolean;
  domain?: string;
}

export interface OrgResearchResult {
  success: boolean;
  orgName: string;
  domain?: string;
}

// ============================================================================
// Frontmatter Types
// ============================================================================

export interface PersonFrontmatter {
  Title?: string;
  Organization?: string;
  Location?: string;
  Phone?: string;
  Email?: string;
  researched?: boolean | string;
  tags?: string[];
  created?: string;
}

export interface OrgFrontmatter {
  Domain?: string;
  researched?: boolean | string;
  tags?: string[];
}
