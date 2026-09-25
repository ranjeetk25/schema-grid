import type {
  Access,
  DataSource,
  FieldTypeRegistry,
  GridRow,
  GridSchema,
  GridUser,
  SchemaGridEvents,
} from "../internal/core";
import type { CellStatusStore } from "../state/cellStatusStore";
import type { ExpansionStore } from "../state/expansionStore";
import type { QueryStore } from "../state/queryStore";
import type { RangeStore } from "../state/rangeStore";
import type { RowStore } from "../state/rowStore";

/** The external stores one grid instance owns (stable for the grid's lifetime). */
export interface SchemaGridStores<Row extends GridRow = GridRow> {
  rows: RowStore<Row>;
  cellStatus: CellStatusStore;
  range: RangeStore;
  query: QueryStore;
  expansion: ExpansionStore;
}

/**
 * What the grid puts in AG Grid's `context` grid option, so cell editors,
 * renderers, filters and `cellClassRules`/`rowClassRules` can reach the data
 * source, the consumer's events and the stores without closures (the rules
 * stay pure functions of `params`).
 *
 * Only `dataSource` and `events` are required, so editors/filters can be used
 * (and tested) with a minimal context; `useSchemaGrid` always fills every
 * field (see `SchemaGridHookContext`). The object is stable for the grid's
 * lifetime; its fields are updated in place as props change.
 */
export interface SchemaGridContext<Row extends GridRow = GridRow> {
  dataSource: DataSource<Row>;
  /** Latest events (a getter so consumers can pass fresh callbacks without re-creating the context). */
  events: () => SchemaGridEvents<Row> | undefined;
  stores?: SchemaGridStores<Row>;
  schema?: GridSchema;
  registry?: FieldTypeRegistry;
  /** Column-level access for the current user. */
  access?: Map<string, Access>;
  /** Columns whose filter conditions live in the compound filter's residual (see `astToFilterModel`). */
  advancedColumnIds?: () => ReadonlySet<string>;
  /** Row-level edit check (see `createCellAccess`). */
  canEditCell?(row: Row, columnId: string): boolean;
  user?: GridUser;
  mode?: "client" | "server";
  [key: string]: unknown;
}

/** The fully-populated context `useSchemaGrid` hands to AG Grid. */
export type SchemaGridHookContext<Row extends GridRow = GridRow> = SchemaGridContext<Row> &
  Required<
    Pick<
      SchemaGridContext<Row>,
      "stores" | "schema" | "registry" | "access" | "advancedColumnIds" | "canEditCell" | "user" | "mode"
    >
  >;

/** Narrows AG Grid's untyped `context` to a `SchemaGridContext`, or undefined when it isn't one. */
export function getSchemaGridContext<Row extends GridRow = GridRow>(ctx: unknown): SchemaGridContext<Row> | undefined {
  if (!ctx || typeof ctx !== "object") return undefined;
  const candidate = ctx as Partial<SchemaGridContext<Row>>;
  if (!candidate.dataSource || typeof candidate.dataSource !== "object") return undefined;
  if (typeof candidate.events !== "function") return undefined;
  return candidate as SchemaGridContext<Row>;
}

/** The grid's stores from AG Grid's untyped `context`, or undefined outside a `useSchemaGrid` grid. */
export function getSchemaGridStores<Row extends GridRow = GridRow>(ctx: unknown): SchemaGridStores<Row> | undefined {
  return getSchemaGridContext<Row>(ctx)?.stores;
}
