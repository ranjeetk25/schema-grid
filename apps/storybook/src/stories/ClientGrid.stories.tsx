import type { Meta, StoryObj } from "@storybook/react";
import { useMemo } from "react";
import { Workbench } from "../support/Workbench";
import {
  USERS,
  createLargeRows,
  createMemoryDataSource,
  createStorySchema,
  exposeToTests,
  instrument,
} from "../support/data";

/**
 * Story 3 — client mode with the full toolbar: FilterButton + FilterChips,
 * ViewSwitcher, GroupByBar, ColumnBuilderModal, undo/redo and CSV export,
 * over the fixture (r1..r5) plus 60 generated rows (x001..x060).
 */
const meta: Meta = { title: "3. Client grid" };
export default meta;

function ClientGrid({ rows, persistViewsKey }: { rows: number; persistViewsKey?: string }) {
  const schema = useMemo(() => createStorySchema(), []);
  const memory = useMemo(
    () => createMemoryDataSource({ schema, rows: createLargeRows(rows) }),
    [schema, rows],
  );
  const ds = useMemo(() => {
    const d = instrument(memory);
    exposeToTests("client", { snapshot: () => memory.snapshot() });
    return d;
  }, [memory]);
  return (
    <Workbench
      title="Admissions"
      description={`Client mode · ${rows + 5} rows`}
      dataSource={ds}
      schema={schema}
      user={USERS.admin}
      persistViewsKey={persistViewsKey}
      onSchemaChange={(next) => {
        memory.setSchema(next);
        return next;
      }}
    />
  );
}

export const FullToolbar: StoryObj = {
  name: "Full toolbar",
  render: () => <ClientGrid rows={60} />,
};
export const FixtureOnly: StoryObj = {
  name: "Fixture only (r1..r5)",
  render: () => <ClientGrid rows={0} />,
};
/** Saved views persist in localStorage (v0.3 columns-picker e2e: hide → save → reload → still hidden). */
export const PersistedViews: StoryObj = {
  name: "Persisted views (localStorage)",
  render: () => <ClientGrid rows={0} persistViewsKey="sg-e2e-persisted-views" />,
};
