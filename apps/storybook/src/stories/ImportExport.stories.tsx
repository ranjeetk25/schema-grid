import { Button, Code, Tooltip, VisuallyHidden } from "@mantine/core";
import type { SchemaGridHandle } from "@ranjeetk25/schema-grid-ag-grid";
import {
  type ColumnDef,
  type GridRow,
  resolveColumnAccess,
} from "@ranjeetk25/schema-grid-core";
import { buildExportBlob, exportFileName } from "@ranjeetk25/schema-grid-io/export";
import { toChangeBatches, validateRows } from "@ranjeetk25/schema-grid-io/import";
import {
  ExportDialog,
  type ExportRequest,
  ImportWizard,
} from "@ranjeetk25/schema-grid-ui-mantine";
import type { ImportJobStatus } from "@ranjeetk25/schema-grid-ui-mantine";
import type { Meta, StoryObj } from "@storybook/react";
import { useMemo, useRef, useState } from "react";
import { IconDownload, IconUpload } from "@tabler/icons-react";
import { Workbench } from "../support/Workbench";
import {
  FIXTURE_TIME_ZONE,
  USERS,
  createMemoryDataSource,
  createStorySchema,
  exposeToTests,
  instrument,
  registry,
  resolver,
} from "../support/data";

const ICON = { size: 16, stroke: 1.75 } as const;

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

function ImportExportDemo() {
  const [schema, setSchema] = useState(() => createStorySchema());
  const user = USERS.admin;
  const memory = useMemo(
    () => createMemoryDataSource({ schema: createStorySchema() }),
    [],
  );
  const ds = useMemo(() => {
    const d = instrument(memory);
    exposeToTests("importExport", { snapshot: () => memory.snapshot() });
    return d;
  }, [memory]);
  const access = useMemo(
    () => resolveColumnAccess(schema, resolver, user),
    [schema, user],
  );
  const grid = useRef<SchemaGridHandle | null>(null);
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
      .filter(
        (c): c is ColumnDef =>
          c !== undefined &&
          (access.get(c.id) === "read" || access.get(c.id) === "edit"),
      );
  };

  const onExport = async ({ scope, format }: ExportRequest) => {
    const columns = visibleColumns();
    let rows: GridRow[];
    if (scope === "selected") {
      rows = (grid.current?.api()?.getSelectedRows() ?? []) as GridRow[];
    } else {
      const filter =
        scope === "view"
          ? (grid.current?.stores.query.getState().filter ?? null)
          : null;
      const sort =
        scope === "view"
          ? (grid.current?.stores.query.getState().sort ?? [])
          : [];
      rows = (
        await ds.fetch({ filter, sort, page: { offset: 0, limit: 10_000 } })
      ).rows;
    }
    const fileName = exportFileName("admissions", format);
    const blob = await buildExportBlob({
      columns,
      registry,
      rows,
      format,
      tz: FIXTURE_TIME_ZONE,
      fileName,
      access,
    });
    setLastExport(
      `${fileName}: ${rows.length} rows, ${columns.length} columns`,
    );
    download(blob, fileName);
  };

  const jobText =
    job?.state === "running"
      ? `Importing ${job.processed}/${job.total}…`
      : job?.state === "done"
        ? `Imported ${job.total - job.errorCount} of ${job.total} rows${job.errorCount ? ` · ${job.errorCount} rejected` : ""}`
        : null;

  return (
    <>
      <Workbench
        title="Admissions"
        description="Import a spreadsheet or export the current view"
        dataSource={ds}
        schema={schema}
        user={user}
        onHandle={(h) => {
          grid.current = h;
        }}
        toolbar={() => (
          <>
            <Tooltip label="Import rows from CSV or XLSX">
              <Button
                variant="subtle"
                color="gray"
                leftSection={<IconUpload {...ICON} />}
                onClick={() => setImportOpen(true)}
              >
                Import…
              </Button>
            </Tooltip>
            <Tooltip label="Export as CSV or XLSX">
              <Button
                variant="subtle"
                color="gray"
                leftSection={<IconDownload {...ICON} />}
                onClick={() => setExportOpen(true)}
              >
                Export…
              </Button>
            </Tooltip>
          </>
        )}
        status={[lastExport ? `Exported ${lastExport}` : null, jobText]}
      />
      <VisuallyHidden>
        <Code data-testid="last-export">{lastExport ?? ""}</Code>
        <Code data-testid="import-job">{job ? JSON.stringify(job) : ""}</Code>
      </VisuallyHidden>
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
          const report = validateRows(
            plan.parsed,
            plan.mapping,
            schema,
            registry,
            {
              mode: plan.mode,
              unknownOptions: plan.unknownOptions,
              access,
              ...(plan.keyColumnId ? { keyColumnId: plan.keyColumnId } : {}),
            },
          );
          const total = plan.parsed.rows.length;
          setJob({ state: "running", processed: 0, total, errorCount: 0 });
          const importPlan = toChangeBatches(report, new Map(), {
            schema,
            registry,
            mode: plan.mode,
            ...(plan.keyColumnId ? { keyColumnId: plan.keyColumnId } : {}),
          });
          // Options the file introduced (unknownOptions: "create").
          for (const [columnId, labels] of Object.entries(
            report.summary.newOptions ?? {},
          )) {
            for (const label of labels as string[])
              await ds.createOption?.(columnId, label).catch(() => undefined);
          }
          const created = await ds.createRows(
            importPlan.creates.map((c) => ({ cells: c.cells ?? {} })),
          );
          for (const batch of importPlan.updates) await ds.applyChanges(batch);
          setSchema(memory.getSchema());
          setJob({
            state: "done",
            processed: total,
            total,
            errorCount: importPlan.rejected.length,
          });
          await grid.current?.refetch();
          return void created;
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
    </>
  );
}

export const ImportAndExport: StoryObj = {
  name: "Import wizard + export dialog",
  render: () => <ImportExportDemo />,
};
