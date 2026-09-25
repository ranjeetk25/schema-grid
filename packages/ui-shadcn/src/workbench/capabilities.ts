/**
 * Effective capabilities → workbench features. Framework-free (copied verbatim by ui-shadcn).
 *
 * The matrix comes from the grid (`SchemaGridHandle.capabilities`, i.e.
 * `useSchemaGrid`'s load of `dataSource.capabilities()`, inferred by core for
 * sources that don't report any) merged with the schema by core's
 * `mergeCapabilities`.
 */
import type { EffectiveCapabilities } from "@ranjeetk25/schema-grid-core";
import type { WorkbenchFeatures } from "./types";

export interface DeriveFeaturesInput {
  /** The grid's effective matrix; `null` until the source's capabilities have loaded. */
  capabilities: EffectiveCapabilities | null;
  /** Host overrides: only `false` has an effect. */
  features?: Partial<WorkbenchFeatures>;
  /** The schema can be changed (a grid client, or direct mode). */
  canChangeSchema: boolean;
}

/**
 * Every feature the effective capabilities allow, minus the ones the host
 * switched off. `features` can never switch a feature ON that the source
 * can't support. Capability-gated features stay off until the capabilities
 * load, so nothing appears and then vanishes.
 */
export function deriveWorkbenchFeatures({ capabilities: c, features = {}, canChangeSchema }: DeriveFeaturesInput): WorkbenchFeatures {
  const allowed: WorkbenchFeatures = {
    filter: c ? Object.values(c.columns).some((col) => col.filterable) : false,
    group: c?.groupBy ?? false,
    search: c?.search ?? false,
    views: true,
    export: c ? c.export.maxRows !== 0 : false,
    import: c?.write.createRows ?? false,
    addColumn: canChangeSchema,
    undo: c?.write.cells ?? false,
    polling: c ? c.changeFeed !== false : false,
  };
  const out = { ...allowed };
  for (const key of Object.keys(out) as (keyof WorkbenchFeatures)[]) {
    if (features[key] === false) out[key] = false;
  }
  return out;
}

/** The loaded capabilities say the source accepts no cell edits (→ the read-only banner). */
export function isReadOnly(capabilities: EffectiveCapabilities | null): boolean {
  return capabilities !== null && !capabilities.write.cells;
}
