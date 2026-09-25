import {
  type DataSource,
  type DataSourceCapabilities,
  type GridRow,
  type GridSchema,
  getDataSourceCapabilities,
} from "@ranjeetk25/schema-grid-core";
import { RemoteDataSourceError, wireSchemas } from "@ranjeetk25/schema-grid-core/wire";
import { createHttpDataSource, createHttpTransport, type HttpDataSourceOptions } from "./httpDataSource";

export type { DataSourceCapabilities };

/** @deprecated Use `DataSourceCapabilities` (core). */
export type GridClientCapabilities = DataSourceCapabilities;

export interface GridClientOptions extends Omit<HttpDataSourceOptions, "baseUrl" | "opPath" | "method"> {
  /** URL the grid registry is mounted at, e.g. `/api/grid` (server: `toFetchHandler(registry, { basePath: "/api/grid" })`). */
  baseUrl: string;
  /** The `defineGrid` id. */
  gridId: string;
}

export interface GridClient {
  readonly gridId: string;
  /** Wire-contract data source for `<SchemaGrid dataSource>` (`POST {baseUrl}/{gridId}/{op}`). */
  readonly dataSource: DataSource<GridRow>;
  /** The grid's current schema. */
  getSchema(): Promise<GridSchema>;
  /** Saves `schema` (its `schemaVersion` must be current); resolves with the stored, version-bumped schema. */
  updateSchema(schema: GridSchema): Promise<GridSchema>;
  /**
   * What the grid's data source supports (paging limit, sortable/filterable
   * columns, writes, ...): the wire `capabilities` op via `dataSource`,
   * normalised; inferred without a request when `supports.capabilities` is false.
   */
  capabilities(): Promise<DataSourceCapabilities>;
}

function checked<T>(op: "getSchema" | "updateSchema", raw: unknown, validate: boolean): T {
  if (!validate) return raw as T;
  const parsed = wireSchemas[op].output.safeParse(raw);
  if (!parsed.success) {
    throw new RemoteDataSourceError({
      code: "OUTPUT_INVALID",
      message: `Invalid "${op}" response`,
      details: {
        issues: parsed.error.issues.map((i) => ({ path: i.path.map((p) => String(p)), message: i.message })),
      },
    });
  }
  return raw as T;
}

/**
 * Browser client for one grid served by `createGridRegistry` +
 * `toFetchHandler` / `toExpressRouter` / `toLambdaHandler`:
 * `createGridClient({ baseUrl: "/api/grid", gridId: "leads" })`.
 */
export function createGridClient(options: GridClientOptions): GridClient {
  const { gridId, ...rest } = options;
  const baseUrl = `${options.baseUrl.replace(/\/+$/, "")}/${encodeURIComponent(gridId)}`;
  const transport = createHttpTransport({ ...rest, baseUrl });
  const validate = options.validateOutput !== false;
  const dataSource = createHttpDataSource({ ...rest, baseUrl });
  return {
    gridId,
    dataSource,
    getSchema: async () => checked<GridSchema>("getSchema", await transport("getSchema", null), validate),
    updateSchema: async (schema) =>
      checked<GridSchema>("updateSchema", await transport("updateSchema", schema), validate),
    capabilities: () => getDataSourceCapabilities(dataSource),
  };
}
