/** Outcome of one paste, handed to `SchemaGridProps.onClipboardReport` (wired in T24). */
export interface ClipboardReport {
  pastedCells: number;
  skippedReadOnly: number;
  /** Cells the data source reported as conflicts (resolved through `events.onConflict`). */
  conflicts: number;
  errors: { rowId: string; columnId: string; message: string }[];
}
