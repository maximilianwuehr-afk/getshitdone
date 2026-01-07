// ============================================================================
// Inbox - Re-exports from inbox/ directory for backward compatibility
// ============================================================================
// All inbox functionality has been split into separate files in src/actions/inbox/
// This file re-exports everything for existing imports to work unchanged.
// New code should import directly from "./inbox" or "./inbox/specific-module"
// ============================================================================

export * from "./inbox/index";
