import { ping as corePing } from "@masai/schema-grid-core";

export const SCHEMA_GRID_AG_GRID_VERSION = "0.0.1";

/**
 * Placeholder export. Real ColDef compilation, custom editors/filters,
 * range selection, clipboard, and fill-handle APIs land in follow-up work
 * per docs/superpowers/specs/2026-09-25-schema-grid-v1-spec.md.
 */
export function ping(): string {
  return `ag-grid:${corePing()}`;
}
