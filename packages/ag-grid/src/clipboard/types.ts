/** Outcome of one paste, handed to `SchemaGridProps.onClipboardReport` (wired in T24). */
export interface ClipboardReport {
  pastedCells: number;
  /**
   * Target cells not written because they are read-only: skipped by the plan
   * (permission, `settable: false`, formula) plus cells the edit controller
   * rejected at submit time (v0.2 C3). Never also listed in `errors`.
   */
  skippedReadOnly: number;
  /** Cells the data source reported as conflicts (resolved through `events.onConflict`). */
  conflicts: number;
  errors: { rowId: string; columnId: string; message: string }[];
}
