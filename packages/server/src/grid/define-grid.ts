import type { ValidateSchemaOptions } from "../schema/validate-schema";
import type { DataSource, FieldTypeRegistry, GridOperation, GridRow, GridSchema } from "../internal/core";
import type { SchemaStore } from "./schema-store";

/** What `source(ctx, info)` receives besides the request context. */
export interface GridSourceInfo {
  gridId: string;
  /** The grid's current schema (stored schema when a `schemaStore` has one, else `schema`). */
  schema: GridSchema;
}

export interface GridDefinitionInput<Ctx = undefined> {
  /** URL-safe grid id (`[A-Za-z0-9_-]+`): the `:gridId` path segment. */
  id: string;
  /** The base schema, fixed or per request. A `schemaStore` entry takes precedence once saved. */
  schema: GridSchema | ((ctx: Ctx) => GridSchema | Promise<GridSchema>);
  /** Builds the data source for one request. */
  source: (ctx: Ctx, info: GridSourceInfo) => DataSource<GridRow> | Promise<DataSource<GridRow>>;
  /** Per-operation gate (all operations incl. `getSchema` / `updateSchema`); false → `PERMISSION_DENIED` 403. Default: allow. */
  permission?: (ctx: Ctx, op: GridOperation) => boolean | Promise<boolean>;
  /**
   * Extra gate on schema writes only, consulted besides `permission(ctx, "updateSchema")`
   * (v0.3.1): false → `capabilities.schema.write: false, reason: "forbidden"` and
   * `updateSchema` → `PERMISSION_DENIED` 403. Default: allow.
   */
  schemaWritable?: (ctx: Ctx) => boolean | Promise<boolean>;
  /**
   * Persists `updateSchema`. Without one — or while `schemaStore.available()` is false —
   * `updateSchema` answers `UNSUPPORTED_OPERATION` 501 (`details.reason: "schema-store-unavailable"`)
   * and the grid serves `schema` read-only.
   */
  schemaStore?: SchemaStore;
  /**
   * Runs after validation and BEFORE the new schema is persisted (e.g. the DDL
   * diff for generated / extension columns). Throwing aborts the update, so the
   * stored schema is always one whose side effects were applied.
   */
  onSchemaChange?: (ctx: Ctx, prev: GridSchema, next: GridSchema) => void | Promise<void>;
  /** Field types for `assertValidSchema`. Default: `createDefaultRegistry()`. */
  registry?: FieldTypeRegistry;
  /** Extra `assertValidSchema` options (`physicalColumns`, `isFormulaTranslatable` from `./drizzle`). */
  validation?: ValidateSchemaOptions;
}

/** A grid declared with `defineGrid`; register it with `createGridRegistry`. */
export type GridDefinition<Ctx = undefined> = Readonly<GridDefinitionInput<Ctx>> & {
  readonly kind: "schema-grid/grid";
};

const GRID_ID = /^[A-Za-z0-9_-]+$/;

/**
 * Declares one grid: its schema, how to build its data source per request and
 * who may run which operation. Serve it (with others) through
 * `createGridRegistry` + `toFetchHandler` / `toExpressRouter` / `toLambdaHandler`.
 */
export function defineGrid<Ctx = undefined>(input: GridDefinitionInput<Ctx>): GridDefinition<Ctx> {
  if (typeof input.id !== "string" || !GRID_ID.test(input.id)) {
    throw new TypeError(`Invalid grid id ${JSON.stringify(input.id)}: use letters, digits, "_" or "-"`);
  }
  if (typeof input.source !== "function") throw new TypeError(`Grid "${input.id}" needs a source(ctx) function`);
  return Object.freeze({ ...input, kind: "schema-grid/grid" as const });
}
