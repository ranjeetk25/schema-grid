import type { ActorRef, ISODateTimeString } from "../common/types";

export interface GridRow {
  id: string;
  version: number;
  updatedAt: ISODateTimeString;
  updatedBy?: ActorRef;
  /** Keyed by ColumnDef.key. */
  cells: Record<string, unknown>;
}

export interface CellChange {
  rowId: string;
  columnId: string;
  prev: unknown;
  next: unknown;
}

export type ChangeSource = "edit" | "paste" | "fill" | "undo" | "redo" | "import";

export interface ChangeBatch {
  id: string;
  changes: CellChange[];
  baseVersions: Record<string, number>;
  source: ChangeSource;
}

export interface ChangeConflict {
  rowId: string;
  columnId: string;
  serverValue: unknown;
  serverVersion: number;
  updatedBy?: ActorRef;
  updatedAt: ISODateTimeString;
}

export interface ChangeError {
  rowId: string;
  columnId: string;
  message: string;
}

export interface ChangeResult {
  applied: CellChange[];
  conflicts: ChangeConflict[];
  errors: ChangeError[];
}

export interface ChangeFeedEntry<Row extends GridRow = GridRow> {
  cursor: string;
  rows: Row[];
  deletedRowIds: string[];
  schemaVersion: number;
}
