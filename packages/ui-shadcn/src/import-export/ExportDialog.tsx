import { ColumnsIcon, FileSpreadsheetIcon, FileTextIcon } from "lucide-react";
import { useEffect, useState } from "react";
import type { ExportFormat } from "../internal/io-contracts";
import { SG_ROOT, cn } from "../lib/cn";
import { Button } from "../ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { ChoiceGroup, InlineAlert, Spinner } from "./parts";

export type ExportScope = "view" | "selected" | "all";

export interface ExportRequest {
  scope: ExportScope;
  format: ExportFormat;
}

export interface ExportDialogProps {
  opened: boolean;
  onClose(): void;
  visibleColumnCount: number;
  selectedRowCount: number;
  defaultScope?: ExportScope;
  defaultFormat?: ExportFormat;
  onExport(request: ExportRequest): Promise<void> | void;
}

const FORMAT_OPTIONS = [
  { value: "csv" as const, label: "CSV", description: "Comma-separated text", icon: <FileTextIcon className="sg:size-4" /> },
  { value: "xlsx" as const, label: "Excel", description: ".xlsx workbook", icon: <FileSpreadsheetIcon className="sg:size-4" /> },
];

export function ExportDialog({
  opened,
  onClose,
  visibleColumnCount,
  selectedRowCount,
  defaultScope = "view",
  defaultFormat = "csv",
  onExport,
}: ExportDialogProps) {
  const initialScope = defaultScope === "selected" && selectedRowCount === 0 ? "view" : defaultScope;
  const [scope, setScope] = useState<ExportScope>(initialScope);
  const [format, setFormat] = useState<ExportFormat>(defaultFormat);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (opened) {
      setScope(initialScope);
      setError(null);
    }
  }, [opened, initialScope]);

  useEffect(() => {
    if (scope === "selected" && selectedRowCount === 0) setScope("view");
  }, [scope, selectedRowCount]);

  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      await onExport({ scope, format });
      setPending(false);
      onClose();
    } catch (e) {
      setPending(false);
      setError(e instanceof Error ? e.message : "Export failed");
    }
  };

  return (
    <Dialog
      open={opened}
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent size="sm" closeLabel="Close export" className={SG_ROOT}>
        <DialogHeader>
          <DialogTitle>Export</DialogTitle>
          <DialogDescription>Download the grid as a file.</DialogDescription>
        </DialogHeader>
        <DialogBody className="sg:flex sg:flex-col sg:gap-5">
          <div className="sg:flex sg:flex-col sg:gap-2">
            <span aria-hidden className="sg:text-sm sg:font-medium">
              Format
            </span>
            <ChoiceGroup<ExportFormat> label="Format" variant="cards" value={format} options={FORMAT_OPTIONS} onChange={setFormat} disabled={pending} />
          </div>
          <div className="sg:flex sg:flex-col sg:gap-2">
            <span aria-hidden className="sg:text-sm sg:font-medium">
              Rows
            </span>
            <ChoiceGroup<ExportScope>
              label="Rows"
              value={scope}
              onChange={setScope}
              disabled={pending}
              className="sg:flex sg:w-full sg:*:flex-1"
              options={[
                { value: "view", label: "Current view" },
                {
                  value: "selected",
                  label: (
                    <>
                      Selected <span className="sg:tabular-nums sg:text-faint-foreground">({selectedRowCount})</span>
                    </>
                  ),
                  disabled: selectedRowCount === 0,
                },
                { value: "all", label: "All rows" },
              ]}
            />
          </div>
          <p className="sg:m-0 sg:flex sg:items-center sg:gap-2 sg:text-xs sg:text-muted-foreground">
            <ColumnsIcon aria-hidden className="sg:size-3.5 sg:shrink-0" />
            <span className="sg:tabular-nums">{`Includes ${visibleColumnCount} visible column${visibleColumnCount === 1 ? "" : "s"}`}</span>
          </p>
          {error ? <InlineAlert title="Export failed">{error}</InlineAlert> : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={pending} aria-busy={pending || undefined} className={cn(pending && "sg:disabled:opacity-80")}>
            {pending ? <Spinner className="sg:text-primary-foreground" /> : null}
            Export
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
