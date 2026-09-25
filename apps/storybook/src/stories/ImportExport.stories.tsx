import { Button, Tooltip } from "@mantine/core";
import type { Meta, StoryObj } from "@storybook/react";
import { IconDownload } from "@tabler/icons-react";
import { useMemo } from "react";
import { Workbench } from "../support/Workbench";
import {
  USERS,
  createMemoryDataSource,
  createStorySchema,
  exposeToTests,
  instrument,
} from "../support/data";

const ICON = { size: 16, stroke: 1.75 } as const;

/**
 * Story 5 — the workbench's built-in ImportWizard ("Import…": io parse → map
 * → validate → toChangeBatches → createRows/applyChanges, with job progress)
 * and ExportDialog (io `buildExportBlob` over the current view / all rows /
 * selected rows, downloaded as CSV or XLSX), opened from a toolbar button.
 */
const meta: Meta = { title: "5. Import and export" };
export default meta;

function ImportExportDemo() {
  const schema = useMemo(() => createStorySchema(), []);
  const memory = useMemo(
    () => createMemoryDataSource({ schema: createStorySchema() }),
    [],
  );
  const ds = useMemo(() => {
    const d = instrument(memory);
    exposeToTests("importExport", { snapshot: () => memory.snapshot() });
    return d;
  }, [memory]);

  return (
    <Workbench
      title="Admissions"
      description="Import a spreadsheet or export the current view"
      dataSource={ds}
      schema={schema}
      user={USERS.admin}
      onSchemaChange={(next) => {
        memory.setSchema(next);
        return next;
      }}
      toolbar={(ctx) => (
        <Tooltip label="Export as CSV or XLSX">
          <Button
            variant="subtle"
            color="gray"
            leftSection={<IconDownload {...ICON} />}
            onClick={ctx.openExport}
          >
            Export…
          </Button>
        </Tooltip>
      )}
    />
  );
}

export const ImportAndExport: StoryObj = {
  name: "Import wizard + export dialog",
  render: () => <ImportExportDemo />,
};
