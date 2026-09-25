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
export const AgGridDefaults: StoryObj = {
  name: "AG Grid defaults",
  render: () => <DefaultFieldTypes />,
};
