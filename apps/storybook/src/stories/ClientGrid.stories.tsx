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

function ClientGrid({ rows }: { rows: number }) {
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
      dataSource={ds}
      schema={schema}
      user={USERS.admin}
      height={520}
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
