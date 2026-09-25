import type { ColumnDef, GridSchema } from "./types";

export function getColumnById(schema: GridSchema, id: string): ColumnDef | undefined {
  return schema.columns.find((column) => column.id === id);
}

export function getColumnByKey(schema: GridSchema, key: string): ColumnDef | undefined {
  return schema.columns.find((column) => column.key === key);
}

export interface ColumnIndex {
  byId: Map<string, ColumnDef>;
  byKey: Map<string, ColumnDef>;
}

export function indexColumns(schema: GridSchema): ColumnIndex {
  const byId = new Map<string, ColumnDef>();
  const byKey = new Map<string, ColumnDef>();
  for (const column of schema.columns) {
    byId.set(column.id, column);
    byKey.set(column.key, column);
  }
  return { byId, byKey };
}
