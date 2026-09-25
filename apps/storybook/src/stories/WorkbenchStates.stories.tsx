import {
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
 */
const meta: Meta = { title: "8. Workbench states" };
export default meta;

type Failure = "network" | "permission" | null;

function Demo({
  caps,
  fail = null,
  empty = false,
  subtitle,
}: {
  caps?: Partial<DataSourceCapabilities>;
  fail?: Failure;
  empty?: boolean;
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
      applyChanges: (b) => memory.applyChanges(b),
      createRows: (p) => memory.createRows(p),
      deleteRows: (ids) => memory.deleteRows(ids),
      getChanges: (s) => memory.getChanges?.(s) ?? Promise.reject(),
      getOptions: (c, s) => memory.getOptions?.(c, s) ?? Promise.resolve([]),
      ...(caps ? { capabilities: () => normalizeCapabilities(caps) } : {}),
    };
    return source;
  }, [schema, caps, fail, empty]);
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
