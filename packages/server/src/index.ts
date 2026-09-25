import { ping as corePing } from "@masai/schema-grid-core";

export const SCHEMA_GRID_SERVER_VERSION = "0.0.1";

/**
 * Placeholder export. Real filter-AST-to-Drizzle translation, permission
 * enforcement, and change-feed APIs land in follow-up work per
 * docs/superpowers/specs/2026-09-25-schema-grid-v1-spec.md.
 */
export function ping(): string {
  return `server:${corePing()}`;
}
