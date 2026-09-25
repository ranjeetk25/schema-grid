import type { DataSource, GridRow, SchemaGridEvents } from "../internal/core";

/**
 * What the grid puts in AG Grid's `context` grid option, so cell editors,
 * renderers and filters can reach the data source and the consumer's events.
 */
export interface SchemaGridContext<Row extends GridRow = GridRow> {
  dataSource: DataSource<Row>;
  /** Latest events (a getter so consumers can pass fresh callbacks without re-creating the context). */
  events: () => SchemaGridEvents<Row> | undefined;
  [key: string]: unknown;
}

/** Narrows AG Grid's untyped `context` to a `SchemaGridContext`, or undefined when it isn't one. */
export function getSchemaGridContext<Row extends GridRow = GridRow>(ctx: unknown): SchemaGridContext<Row> | undefined {
  if (!ctx || typeof ctx !== "object") return undefined;
  const candidate = ctx as Partial<SchemaGridContext<Row>>;
  if (!candidate.dataSource || typeof candidate.dataSource !== "object") return undefined;
  if (typeof candidate.events !== "function") return undefined;
  return candidate as SchemaGridContext<Row>;
}
