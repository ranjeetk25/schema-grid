import {
  SchemaGrid,
  createDefaultUiRegistry,
} from "@ranjeetk25/schema-grid-ag-grid";
import type { Meta, StoryObj } from "@storybook/react";
import { useMemo, useState } from "react";
import { GRID_OPTIONS, Workbench } from "../support/Workbench";
import {
  USERS,
  createMemoryDataSource,
  createStorySchema,
  exposeToTests,
  instrument,
  registry,
  resolver,
} from "../support/data";

/**
 * Story 1 — every built-in field type (text … formula) in one small grid over
 * the core admissions fixture, with the Mantine renderers/editors
 * (`createMantineUiRegistry`) and, for comparison, ag-grid's plain defaults.
 */
const meta: Meta = { title: "1. Field types" };
export default meta;

function MantineFieldTypes() {
  const schema = useMemo(() => createStorySchema(), []);
  const ds = useMemo(() => {
    const d = instrument(createMemoryDataSource({ schema }));
    exposeToTests("fieldTypes", d);
    return d;
  }, [schema]);
  return (
    <Workbench
      title="Field types"
      description="Every built-in type with the Mantine widgets"
      dataSource={ds}
      schema={schema}
      user={USERS.admin}
    />
  );
}

function DefaultFieldTypes() {
  const [schema] = useState(() => createStorySchema());
  const ds = useMemo(
    () => instrument(createMemoryDataSource({ schema })),
    [schema],
  );
  const defaults = useMemo(() => createDefaultUiRegistry(), []);
  return (
    <SchemaGrid
      schema={schema}
      dataSource={ds}
      user={USERS.admin}
      registry={registry}
      resolver={resolver}
      uiRegistry={defaults}
      height={330}
      gridOptions={GRID_OPTIONS}
    />
  );
}

export const Mantine: StoryObj = { render: () => <MantineFieldTypes /> };

/**
 * v0.4.1 capability-gated field types: the source reports `lookup: false`
 * and `options: false`. "Add column" offers no Link / User type; the existing
 * Programs (link) and Owner (user) columns keep their type, shown with the
 * reason, and their pickers say "Linking isn't set up for this grid" /
 * "People search isn't set up for this grid" instead of searching.
 */
function NoLookupFieldTypes() {
  const schema = useMemo(() => createStorySchema(), []);
  const ds = useMemo(() => {
    const memory = createMemoryDataSource({ schema });
    const gated = Object.assign(Object.create(memory) as typeof memory, {
      capabilities: async () => ({ ...(await memory.capabilities?.()), lookup: false, options: false }),
    });
    const d = instrument(gated);
    exposeToTests("noLookup", d);
    return d;
  }, [schema]);
  return (
    <Workbench
      title="Field types"
      description="A source without lookup / options: no Link or User columns"
      dataSource={ds}
      schema={schema}
      user={USERS.admin}
    />
  );
}

export const NoLookup: StoryObj = {
  name: "Without lookup or options",
  render: () => <NoLookupFieldTypes />,
};
export const AgGridDefaults: StoryObj = {
  name: "AG Grid defaults",
  render: () => <DefaultFieldTypes />,
};
