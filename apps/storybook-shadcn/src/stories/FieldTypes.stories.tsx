import { SchemaGrid, createDefaultUiRegistry } from "@masai/schema-grid-ag-grid";
import { useGridThemeFromShadcn } from "@masai/schema-grid-ui-shadcn";
import type { Meta, StoryObj } from "@storybook/react";
import { useMemo, useState } from "react";
import { GRID_OPTIONS, Workbench } from "../support/Workbench";
import { USERS, createMemoryDataSource, createStorySchema, exposeToTests, instrument, registry, resolver } from "../support/shared";

/**
 * Story 1 — every built-in field type (text … formula) over the core
 * admissions fixture with the shadcn renderers/editors
 * (`createShadcnUiRegistry`) and, for comparison, ag-grid's plain defaults.
 */
const meta: Meta = { title: "1. Field types" };
export default meta;

function ShadcnFieldTypes() {
  const schema = useMemo(() => createStorySchema(), []);
  const ds = useMemo(() => {
    const d = instrument(createMemoryDataSource({ schema }));
    exposeToTests("fieldTypes", d);
    return d;
  }, [schema]);
  return <Workbench dataSource={ds} schema={schema} user={USERS.admin} height={330} />;
}

function DefaultFieldTypes() {
  const [schema] = useState(() => createStorySchema());
  const ds = useMemo(() => instrument(createMemoryDataSource({ schema })), [schema]);
  const defaults = useMemo(() => createDefaultUiRegistry(), []);
  const { theme } = useGridThemeFromShadcn();
  return (
    <SchemaGrid
      schema={schema}
      dataSource={ds}
      user={USERS.admin}
      registry={registry}
      resolver={resolver}
      uiRegistry={defaults}
      height={330}
      theme={theme}
      gridOptions={GRID_OPTIONS}
    />
  );
}

export const Shadcn: StoryObj = { render: () => <ShadcnFieldTypes /> };
export const AgGridDefaults: StoryObj = { name: "AG Grid defaults", render: () => <DefaultFieldTypes /> };
