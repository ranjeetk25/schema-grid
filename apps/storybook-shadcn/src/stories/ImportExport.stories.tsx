import { SchemaGrid, type SchemaGridHandle } from "@masai/schema-grid-ag-grid";
import { type ColumnDef, type GridRow, resolveColumnAccess } from "@masai/schema-grid-core";
import { buildExportBlob, exportFileName } from "@masai/schema-grid-io/export";
import { toChangeBatches, validateRows } from "@masai/schema-grid-io/import";
import {
  ExportDialog,
  type ExportRequest,
  type ImportJobStatus,
  ImportWizard,
  useGridThemeFromShadcn,
} from "@masai/schema-grid-ui-shadcn";
import type { Meta, StoryObj } from "@storybook/react";
import { DownloadIcon, UploadIcon } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { GRID_OPTIONS, IconAction, uiRegistry } from "../support/Workbench";
import {
  FIXTURE_TIME_ZONE,
  USERS,
  createMemoryDataSource,
  createStorySchema,
  exposeToTests,
  instrument,
  registry,
  resolver,
} from "../support/shared";

/**
 * Story 5 — ImportWizard (browser-side: io parse → map → validate →
 * toChangeBatches → createRows/applyChanges, with job progress) and
 * ExportDialog (io `buildExportBlob` over the current view / all rows /
 * selected rows, downloaded as CSV or XLSX).
 */
const meta: Meta = { title: "5. Import and export" };
export default meta;

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function jobLine(job: ImportJobStatus): string {
  if (job.state === "done") return `Imported ${job.processed} of ${job.total} rows${job.errorCount ? ` · ${job.errorCount} rejected` : ""}`;
  if (job.state === "failed") return "Import failed";
  return `Importing ${job.processed} of ${job.total} rows…`;
}

function ImportExportDemo() {
  const [schema, setSchema] = useState(() => createStorySchema());
  const user = USERS.admin;
  const memory = useMemo(() => createMemoryDataSource({ schema: createStorySchema() }), []);
  const ds = useMemo(() => {
    const d = instrument(memory);
    exposeToTests("importExport", { snapshot: () => memory.snapshot() });
    return d;
  }, [memory]);
  const access = useMemo(() => resolveColumnAccess(schema, resolver, user), [schema, user]);
  const grid = useRef<SchemaGridHandle | null>(null);
  const { theme } = useGridThemeFromShadcn();
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [job, setJob] = useState<ImportJobStatus | undefined>(undefined);
  const [lastExport, setLastExport] = useState<string | null>(null);

  const visibleColumns = (): ColumnDef[] => {
    const state = grid.current?.api()?.getColumnState() ?? [];
    const byId = new Map(schema.columns.map((c) => [c.id, c]));
    return state
      .filter((s) => !s.hide)
      .map((s) => byId.get(s.colId))
      .filter((c): c is ColumnDef => c !== undefined && (access.get(c.id) === "read" || access.get(c.id) === "edit"));
  };

  const onExport = async ({ scope, format }: ExportRequest) => {
    const columns = visibleColumns();
    let rows: GridRow[];
    if (scope === "selected") {
      rows = (grid.current?.api()?.getSelectedRows() ?? []) as GridRow[];
    } else {
      const filter = scope === "view" ? (grid.current?.stores.query.getState().filter ?? null) : null;
      const sort = scope === "view" ? (grid.current?.stores.query.getState().sort ?? []) : [];
      rows = (await ds.fetch({ filter, sort, page: { offset: 0, limit: 10_000 } })).rows;
    }
    const fileName = exportFileName("admissions", format);
    const blob = await buildExportBlob({ columns, registry, rows, format, tz: FIXTURE_TIME_ZONE, fileName, access });
    setLastExport(`Exported ${fileName} · ${rows.length} rows, ${columns.length} columns`);
    download(blob, fileName);
  };

  return (
    <div className="sg-ui sg:flex sg:flex-col sg:gap-2">
      <div className="sg:flex sg:items-center sg:justify-end sg:gap-0.5">
        <IconAction label="Import…" onClick={() => setImportOpen(true)}>
          <UploadIcon />
        </IconAction>
        <IconAction label="Export…" onClick={() => setExportOpen(true)}>
          <DownloadIcon />
        </IconAction>
      </div>
      <SchemaGrid
        ref={grid}
        schema={schema}
        dataSource={ds}
        user={user}
        registry={registry}
        resolver={resolver}
        uiRegistry={uiRegistry}
        height={360}
        theme={theme}
        gridOptions={GRID_OPTIONS}
      />
      <div className="sg:flex sg:min-h-5 sg:items-center sg:gap-3 sg:text-xs sg:text-muted-foreground sg:tabular-nums">
        {job ? <span>{jobLine(job)}</span> : null}
        {lastExport ? <span>{lastExport}</span> : null}
      </div>
      <div hidden>
        <span data-testid="last-export">{lastExport ?? ""}</span>
        <span data-testid="import-job">{job ? JSON.stringify(job) : ""}</span>
      </div>
      <ImportWizard
        opened={importOpen}
        onClose={() => {
          setImportOpen(false);
          setJob(undefined);
        }}
        schema={schema}
        registry={registry}
        access={access}
        job={job}
        onCommit={async (plan) => {
          const report = validateRows(plan.parsed, plan.mapping, schema, registry, {
            mode: plan.mode,
            unknownOptions: plan.unknownOptions,
            access,
            ...(plan.keyColumnId ? { keyColumnId: plan.keyColumnId } : {}),
          });
          const total = plan.parsed.rows.length;
          setJob({ state: "running", processed: 0, total, errorCount: 0 });
          const importPlan = toChangeBatches(report, new Map(), {
            schema,
            registry,
            mode: plan.mode,
            ...(plan.keyColumnId ? { keyColumnId: plan.keyColumnId } : {}),
          });
          for (const [columnId, labels] of Object.entries(report.summary.newOptions ?? {})) {
            for (const label of labels as string[]) await ds.createOption?.(columnId, label).catch(() => undefined);
          }
          await ds.createRows(importPlan.creates.map((c) => ({ cells: c.cells ?? {} })));
          for (const batch of importPlan.updates) await ds.applyChanges(batch);
          setSchema(memory.getSchema());
          setJob({ state: "done", processed: total, total, errorCount: importPlan.rejected.length });
          await grid.current?.refetch();
        }}
      />
      <ExportDialog
        opened={exportOpen}
        onClose={() => setExportOpen(false)}
        visibleColumnCount={visibleColumns().length}
        selectedRowCount={grid.current?.api()?.getSelectedRows().length ?? 0}
        onExport={async (req) => {
          await onExport(req);
          setExportOpen(false);
        }}
      />
    </div>
  );
}

export const ImportAndExport: StoryObj = { name: "Import wizard + export dialog", render: () => <ImportExportDemo /> };
