import {
  type ChangeBatch,
  type ChangeResult,
  type DataSource,
  type DataSourceCapabilities,
  normalizeCapabilities,
} from "@ranjeetk25/schema-grid-core";
import { SchemaGridWorkbench, createMemoryViewStore } from "@ranjeetk25/schema-grid-ui-mantine";
import type { Meta, StoryObj } from "@storybook/react";
import { useMemo } from "react";
import { GRID_OPTIONS, uiRegistry } from "../support/Workbench";
import {
  USERS,
  createMemoryDataSource,
  createStorySchema,
  registry,
  resolver,
} from "../support/data";

/**
 * Story 8 — `<SchemaGridWorkbench>` states: capabilities switch toolbar
 * features off, and failures surface as inline banners with retry / reload.
 * v0.3.1: `SaveErrors` — every save answers a per-cell server message, shown
 * in the "save" banner, on the cell (title) and in the live region.
 */
const meta: Meta = { title: "8. Workbench states" };
export default meta;

type Failure = "network" | "permission" | null;

/** v0.3.1 `SaveErrors`: the message every change fails with (not exported: CSF treats named exports as stories). */
const SAVE_ERROR_MESSAGE = "The student has not uploaded: Aadhaar card";

function Demo({
  caps,
  fail = null,
  empty = false,
  saveFails = false,
  subtitle,
}: {
  caps?: Partial<DataSourceCapabilities>;
  fail?: Failure;
  empty?: boolean;
  /** Every `applyChanges` answers a per-cell error (`SAVE_ERROR_MESSAGE`), nothing applied. */
  saveFails?: boolean;
  subtitle: string;
}) {
  const schema = useMemo(() => createStorySchema(), []);
  const viewStore = useMemo(() => createMemoryViewStore(), []);
  const ds = useMemo(() => {
    const memory = createMemoryDataSource({
      schema,
      ...(empty ? { rows: [] } : {}),
    });
    let failures = fail ? 1 : 0;
    const source: DataSource = {
      fetch: (q) => {
        if (failures > 0) {
          failures -= 1;
          return Promise.reject(
            fail === "network"
              ? new TypeError("Failed to fetch")
              : Object.assign(new Error("Forbidden"), {
                  code: "PERMISSION_DENIED",
                  status: 403,
                }),
          );
        }
        return memory.fetch(q);
      },
      applyChanges: (b: ChangeBatch): Promise<ChangeResult> =>
        saveFails
          ? Promise.resolve({
              applied: [],
              conflicts: [],
              rejected: [],
              errors: b.changes.map((c) => ({ rowId: c.rowId, columnId: c.columnId, message: SAVE_ERROR_MESSAGE })),
            })
          : memory.applyChanges(b),
      createRows: (p) => memory.createRows(p),
      deleteRows: (ids) => memory.deleteRows(ids),
      getChanges: (s) => memory.getChanges?.(s) ?? Promise.reject(),
      getOptions: (c, s) => memory.getOptions?.(c, s) ?? Promise.resolve([]),
      ...(caps ? { capabilities: () => normalizeCapabilities(caps) } : {}),
    };
    return source;
  }, [schema, caps, fail, empty, saveFails]);
  return (
    <div style={{ height: "100dvh" }}>
      <SchemaGridWorkbench
        title="Admissions"
        subtitle={subtitle}
        dataSource={ds}
        schema={schema}
        user={USERS.admin}
        registry={registry}
        resolver={resolver}
        uiRegistry={uiRegistry}
        viewStore={viewStore}
        roles={["admin", "counsellor", "viewer"]}
        gridProps={{ gridOptions: GRID_OPTIONS }}
      />
    </div>
  );
}

const READ_ONLY: Partial<DataSourceCapabilities> = {
  groupBy: false,
  write: { cells: false, createRows: false, deleteRows: false },
};

export const ReadOnly: StoryObj = {
  name: "Read-only source (no group, no writes)",
  render: () => <Demo caps={READ_ONLY} subtitle="capabilities: write.cells false, groupBy false" />,
};
export const Network: StoryObj = {
  name: "Network error with retry",
  render: () => <Demo fail="network" subtitle="first fetch fails" />,
};
export const Permission: StoryObj = {
  name: "Permission denied",
  render: () => <Demo fail="permission" subtitle="first fetch is 403" />,
};
export const Empty: StoryObj = {
  name: "Empty",
  render: () => <Demo empty subtitle="no rows" />,
};
export const SaveErrors: StoryObj = {
  name: "Save errors (server message per cell)",
  render: () => <Demo saveFails subtitle="every save fails: the server's message on the cell and in a banner" />,
};
