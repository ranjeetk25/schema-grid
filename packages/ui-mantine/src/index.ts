import { ping as agGridPing } from "@masai/schema-grid-ag-grid";
import { ping as corePing } from "@masai/schema-grid-core";
import { ping as ioPing } from "@masai/schema-grid-io";

export const SCHEMA_GRID_UI_MANTINE_VERSION = "0.0.1";

/**
 * Placeholder export. Real column/filter builders, view switcher, import
 * wizard, export dialog, and conflict prompt land in follow-up work per
 * docs/superpowers/specs/2026-09-25-schema-grid-v1-spec.md.
 */
export function ping(): string {
  return `ui-mantine:${corePing()}:${agGridPing()}:${ioPing()}`;
}
