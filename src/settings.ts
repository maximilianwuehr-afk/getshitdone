// ============================================================================
// Settings - Re-exports from settings/ directory for backward compatibility
// ============================================================================
// All settings UI has been split into separate files in src/settings/
// This file re-exports everything for existing imports to work unchanged.
// New code should import directly from "./settings" or "./settings/specific-module"
// ============================================================================

export * from "./settings/index";
