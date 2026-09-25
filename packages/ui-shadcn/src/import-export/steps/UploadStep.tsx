import { FileSpreadsheetIcon, UploadIcon } from "lucide-react";
import { type DragEvent, useRef, useState } from "react";
import { cn } from "../../lib/cn";
import { Button } from "../../ui/button";
import { formatFileSize } from "../import-model";
import { InlineAlert, Spinner } from "../parts";

/**
 * `.xls` (legacy BIFF) is deliberately absent: `@ranjeetk25/schema-grid-io`'s
 * parser reads only CSV and OOXML workbooks.
 */
export const IMPORT_ACCEPT =
  ".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const ACCEPTED_EXTENSIONS = /\.(csv|xlsx)$/i;
const ACCEPTED_TYPES = new Set(["text/csv", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]);

function isAccepted(file: File): boolean {
  return ACCEPTED_EXTENSIONS.test(file.name) || ACCEPTED_TYPES.has(file.type);
}

export interface UploadStepProps {
  file: File | null;
  fileName: string;
  parsing: boolean;
  parseError: string | null;
  rowCount: number | null;
  /** The file had more rows than the parser keeps. */
  truncated?: boolean;
  onFile(file: File): void;
}

export function UploadStep({ file, fileName, parsing, parseError, rowCount, truncated = false, onFile }: UploadStepProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);
  const hasFile = Boolean(file || fileName);

  const take = (f: File | undefined) => {
    if (!f) return;
    if (!isAccepted(f)) {
      setDropError(`"${f.name}" is not a CSV or Excel (.xlsx) file`);
      return;
    }
    setDropError(null);
    onFile(f);
  };

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    if (!dragging) setDragging(true);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    take(e.dataTransfer.files?.[0]);
  };

  const error = dropError ?? parseError;

  return (
    <div className="sg:flex sg:flex-col sg:gap-4">
      <div
        data-testid="import-drop-zone"
        data-dragging={dragging || undefined}
        onDragEnter={onDragOver}
        onDragOver={onDragOver}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={onDrop}
        className={cn(
          "sg:flex sg:flex-col sg:items-center sg:justify-center sg:gap-3 sg:rounded-lg sg:border sg:border-dashed sg:border-input sg:px-6 sg:text-center",
          "sg:transition-colors sg:duration-150",
          hasFile ? "sg:py-7" : "sg:py-12",
          dragging && "sg:border-primary sg:bg-primary-subtle",
        )}
      >
        <span className="sg:flex sg:size-10 sg:items-center sg:justify-center sg:rounded-full sg:bg-muted sg:text-muted-foreground">
          <UploadIcon aria-hidden className="sg:size-4" />
        </span>
        <div className="sg:flex sg:flex-col sg:gap-1">
          <p className="sg:m-0 sg:text-base sg:font-medium sg:text-foreground">{dragging ? "Drop to upload" : "Drag a file here"}</p>
          <p className="sg:m-0 sg:text-xs sg:text-muted-foreground">CSV or Excel (.xlsx). The first row must contain column headers.</p>
        </div>
        <Button variant="secondary" disabled={parsing} onClick={() => inputRef.current?.click()}>
          {hasFile ? "Choose another file" : "Choose file"}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept={IMPORT_ACCEPT}
          aria-label="Import file"
          tabIndex={-1}
          className="sg:sr-only"
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            // Clear the input so picking the same file again still fires onChange.
            e.currentTarget.value = "";
            take(f);
          }}
        />
      </div>

      {fileName ? (
        <div className="sg:flex sg:items-center sg:gap-3 sg:rounded-lg sg:bg-subtle sg:px-3 sg:py-2.5">
          <span className="sg:flex sg:size-9 sg:shrink-0 sg:items-center sg:justify-center sg:rounded-md sg:bg-background sg:text-muted-foreground sg:shadow-xs">
            <FileSpreadsheetIcon aria-hidden className="sg:size-4" />
          </span>
          <div className="sg:flex sg:min-w-0 sg:flex-1 sg:flex-col sg:gap-0.5">
            <span className="sg:truncate sg:text-sm sg:font-medium sg:text-foreground">{fileName}</span>
            <span className="sg:flex sg:items-center sg:gap-1.5 sg:text-xs sg:text-muted-foreground sg:tabular-nums">
              {file ? <span>{formatFileSize(file.size)}</span> : null}
              {parsing ? (
                <>
                  {file ? <span aria-hidden>·</span> : null}
                  <span className="sg:inline-flex sg:items-center sg:gap-1">
                    <Spinner className="sg:size-3" />
                    Reading file…
                  </span>
                </>
              ) : rowCount != null && !parseError ? (
                <>
                  {file ? <span aria-hidden>·</span> : null}
                  <span>{`${rowCount} ${rowCount === 1 ? "row" : "rows"} found`}</span>
                </>
              ) : null}
            </span>
          </div>
        </div>
      ) : null}

      {truncated && rowCount != null && !parseError ? (
        <p className="sg:m-0 sg:text-xs sg:text-warning">
          The file has more rows than can be imported at once; the rest were dropped.
        </p>
      ) : null}

      {error ? <InlineAlert title={dropError ? "Unsupported file" : "Could not parse file"}>{error}</InlineAlert> : null}
    </div>
  );
}
