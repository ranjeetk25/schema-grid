import { Button } from "@ranjeetk25/schema-grid-ui-shadcn";
import type { Meta, StoryObj } from "@storybook/react";
import { DownloadIcon } from "lucide-react";
import { useMemo } from "react";
import { Workbench } from "../support/Workbench";
import { USERS, createMemoryDataSource, createStorySchema, exposeToTests, instrument } from "../support/shared";

/**
 * Story 5 — the workbench's built-in ImportWizard ("Import…": io parse → map
 * → validate → toChangeBatches → createRows/applyChanges, with job progress)
 * and ExportDialog ("Export…": io `buildExportBlob` over the current view /
 * all rows / selected rows, downloaded as CSV or XLSX). The quick "Export CSV"
 * icon stays next to Import….
 */
const meta: Meta = { title: "5. Import and export" };
export default meta;

function ImportExportDemo() {
  const schema = useMemo(() => createStorySchema(), []);
  const memory = useMemo(() => createMemoryDataSource({ schema: createStorySchema() }), []);
  const ds = useMemo(() => {
    const d = instrument(memory);
    exposeToTests("importExport", { snapshot: () => memory.snapshot() });
    return d;
  }, [memory]);
  return (
    <Workbench
      dataSource={ds}
      schema={schema}
      user={USERS.admin}
      height={360}
      onSchemaChange={(next) => {
        memory.setSchema(next);
        return next;
      }}
      toolbarStart={(ctx) => (
        <Button variant="secondary" onClick={ctx.openExport}>
          <DownloadIcon className="sg:text-muted-foreground" />
          Export…
        </Button>
      )}
    />
  );
}

export const ImportAndExport: StoryObj = { name: "Import wizard + export dialog", render: () => <ImportExportDemo /> };
