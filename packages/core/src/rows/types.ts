import type { ActorRef, ISODateTimeString } from "../common/types";

export interface GridRow {
  id: string;
  version: number;
  updatedAt: ISODateTimeString;
  updatedBy?: ActorRef;
  /** Keyed by ColumnDef.key. */
  cells: Record<string, unknown>;
}

/** JSON-serialisable side data travelling with a change (never a cell value). */
export type ChangeMeta = Record<string, unknown>;

export interface CellChange {
  rowId: string;
  columnId: string;
  prev: unknown;
  next: unknown;
  /**
   * v0.3: input-only data for this change (e.g. a decision message a
   * `beforeCellsChange` hook attached). Ignored by validation and the client
   * write check; data sources receive it and echo it on the matching
   * `applied` / `rejected` / `conflicts` entry.
   */
  meta?: ChangeMeta;
}

export type ChangeSource = "edit" | "paste" | "fill" | "undo" | "redo" | "import";

export interface ChangeBatch {
  id: string;
  changes: CellChange[];
  baseVersions: Record<string, number>;
  source: ChangeSource;
  /** v0.3: input-only data for the whole batch (see `CellChange.meta`). */
  meta?: ChangeMeta;
  /**
   * v0.3.1: the id of the batch this one re-submits (a conflict "Overwrite",
   * a retry). Set by the client's edit controller; hosts use it to skip a
   * confirmation they already gave for the original batch. Passthrough on the wire.
   */
  resubmitOf?: string;
}

export interface ChangeConflict {
  rowId: string;
  columnId: string;
  serverValue: unknown;
  serverVersion: number;
  updatedBy?: ActorRef;
  updatedAt: ISODateTimeString;
  /** The conflicting change's `meta`, echoed back. */
  meta?: ChangeMeta;
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
  /**
   * Spec §4.5 addendum: the NEW version of every row this call wrote, keyed by
   * row id (rows with only conflicts/errors are absent). Optional so older
   * data sources stay valid; clients that find it missing may assume one bump
   * per written row (`baseVersions[rowId] + 1`). The in-memory data source and
   * the server always populate it.
   */
  versions?: Record<string, number>;
  /**
   * v0.3: changes that were NOT applied and are NOT errors — the data source
   * (or a `beforeCellsChange` hook that dropped them) declined them quietly.
   * Clients revert the optimistic value with no error state; a status line
   * may say "N changes not saved". Optional: absent means none.
   */
  rejected?: CellChange[];
  /**
   * v0.3.1: the refreshed rows for every row id in the batch that still
   * exists, read AFTER the write — formulas, computed columns, `mapRows` and
   * projection applied — so the client can show derived values without a
   * refetch. Optional: sources that omit it leave the client to `getRows`.
   */
  rows?: GridRow[];
}

export interface ChangeFeedEntry<Row extends GridRow = GridRow> {
  cursor: string;
  rows: Row[];
  deletedRowIds: string[];
  schemaVersion: number;
}
