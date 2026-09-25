/**
 * Capabilities → workbench features. Framework-free (copied verbatim by ui-shadcn).
 */
import type { DataSource } from "@ranjeetk25/schema-grid-core";
import type { WorkbenchCapabilities, WorkbenchFeatures, WorkbenchGridClient } from "./types";

/**
 * TODO(lane-a): replace with `DEFAULT_CAPABILITIES` from core. A source that
 * reports nothing is treated as fully capable (v0.1 behaviour).
 */
export const WORKBENCH_DEFAULT_CAPABILITIES: WorkbenchCapabilities = {
  maxPageSize: 500,
  sort: "all",
  filter: "all",
  groupBy: true,
  search: true,
  changeFeed: true,
  write: { cells: true, createRows: true, deleteRows: true },
  options: true,
  lookup: true,
  export: {},
};

/** Fills gaps in a partial / older capabilities object with the defaults. */
export function normalizeCapabilities(caps: Partial<WorkbenchCapabilities> | null | undefined): WorkbenchCapabilities {
  const d = WORKBENCH_DEFAULT_CAPABILITIES;
  if (!caps) return d;
  return {
    ...d,
    ...caps,
    write: { ...d.write, ...(caps.write ?? {}) },
    export: { ...d.export, ...(caps.export ?? {}) },
  };
}

type CapabilitiesSource = { capabilities?: unknown };

/**
 * Reads capabilities from a grid client (object or function) or the data
 * source's optional `capabilities()`; resolves to the defaults when neither
 * reports any. Never rejects: a failing call falls back to the defaults.
 */
export async function loadCapabilities(
  client: Pick<WorkbenchGridClient, "capabilities"> | null | undefined,
  dataSource: DataSource | null | undefined,
): Promise<WorkbenchCapabilities> {
  const pick = (src: CapabilitiesSource | null | undefined) => src?.capabilities;
  const raw = pick(client) ?? pick(dataSource as CapabilitiesSource | null | undefined);
  try {
    if (typeof raw === "function") {
      const owner = pick(client) === raw ? client : dataSource;
      return normalizeCapabilities((await (raw as () => unknown).call(owner)) as Partial<WorkbenchCapabilities>);
    }
    if (raw && typeof raw === "object") return normalizeCapabilities(raw as Partial<WorkbenchCapabilities>);
  } catch {
    // Treated like "not reported": the grid keeps working with everything on.
  }
  return WORKBENCH_DEFAULT_CAPABILITIES;
}

export interface DeriveFeaturesInput {
  capabilities: WorkbenchCapabilities;
  /** Host overrides: only `false` has an effect. */
  features?: Partial<WorkbenchFeatures>;
  /** `dataSource.getChanges` exists. */
  hasChangeFeed: boolean;
  /** The schema can be changed (a client with `updateSchema`, or direct mode). */
  canChangeSchema: boolean;
}

const hasColumns = (scope: WorkbenchCapabilities["filter"]) => scope === "all" || scope.columnIds.length > 0;

/**
 * Every feature the capabilities allow, minus the ones the host switched off.
 * `features` can never switch a feature ON that the source can't support.
 */
export function deriveWorkbenchFeatures({
  capabilities: c,
  features = {},
  hasChangeFeed,
  canChangeSchema,
}: DeriveFeaturesInput): WorkbenchFeatures {
  const allowed: WorkbenchFeatures = {
    filter: hasColumns(c.filter),
    group: c.groupBy,
    search: c.search,
    views: true,
    export: c.export.maxRows !== 0,
    import: c.write.createRows,
    addColumn: canChangeSchema,
    undo: c.write.cells,
    polling: hasChangeFeed && c.changeFeed !== false,
  };
  const out = { ...allowed };
  for (const key of Object.keys(out) as (keyof WorkbenchFeatures)[]) {
    if (features[key] === false) out[key] = false;
  }
  return out;
}
