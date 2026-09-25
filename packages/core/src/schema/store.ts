import type { GridSchema } from "./types";

/**
 * Persistence seam for a grid's schema, used by `defineGrid` to back
 * `getSchema` / `updateSchema` (so schema edits such as the Workbench "+"
 * add-column flow survive reloads).
 *
 * - `get` resolves the stored schema for `gridId`, or `null` when none exists.
 * - `put` stores `schema` exactly as given; it does not bump or check
 *   `schemaVersion` — callers (e.g. `updateSchema`) are responsible for that.
 *
 * Implementations must be safe to call concurrently (last write wins) unless
 * they document otherwise.
 */
export interface SchemaStore {
  get(gridId: string): Promise<GridSchema | null>;
  put(gridId: string, schema: GridSchema): Promise<void>;
}
