/** Outcome of one paste, handed to `SchemaGridProps.onClipboardReport` (wired in T24). */
export interface ClipboardReport {
  pastedCells: number;
  skippedReadOnly: number;
  errors: { rowId: string; columnId: string; message: string }[];
}
