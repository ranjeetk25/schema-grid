import type { ViewDef } from "@ranjeetk25/schema-grid-core";
import type { Meta, StoryObj } from "@storybook/react";
import { useMemo } from "react";
import { Workbench } from "../support/Workbench";
import { USERS, createLargeRows, createMemoryDataSource, createStorySchema, exposeToTests, instrument } from "../support/shared";

/**
 * Story 8 — v0.4 cell colors over the in-memory source (manual colors,
 * color rules and filter by color all supported):
 * - the "Color coded" view carries two rules: paid rows green, and an empty
 *   Payment status cell gray;
 * - "Cell color" (toolbar, right) paints the selected cells; skipped
 *   read-only cells (e.g. the Balance formula) show a toast;
 * - "Color rules" edits the view's rules; "Filter by color" is in every
 *   column's header menu, and "color is" in the Filter builder.
 * Playwright reads the stored colors through `window.__sg.stories.colors`.
 */
const meta: Meta = { title: "8. Cell colors" };
export default meta;

const COLOR_CODED: ViewDef = {
  id: "view_colors",
  name: "Color coded",
  filter: null,
  sort: [],
  columnState: [],
  groupBy: [],
  pageSize: 100,
  colorRules: [
    {
      id: "rule_paid",
      color: "green",
      target: { kind: "row" },
      when: { op: "and", children: [{ columnId: "col_status", operator: "is", value: "paid" }] },
    },
    {
      id: "rule_no_status",
      color: "gray",
      target: { kind: "cells", columnIds: ["col_status"] },
      when: { op: "and", children: [{ columnId: "col_status", operator: "isEmpty" }] },
    },
  ],
};

function CellColorsGrid({ rows }: { rows: number }) {
  const schema = useMemo(() => createStorySchema(), []);
  const memory = useMemo(() => createMemoryDataSource({ schema, rows: createLargeRows(rows) }), [schema, rows]);
  const ds = useMemo(() => {
    const d = instrument(memory);
    exposeToTests("colors", { snapshot: () => memory.snapshot() });
    return d;
  }, [memory]);
  return (
    <Workbench
      dataSource={ds}
      schema={schema}
      user={USERS.admin}
      height={520}
      title="Admissions"
      subtitle="Cell colors"
      initialViews={[COLOR_CODED]}
      onSchemaChange={(next) => {
        memory.setSchema(next);
        return next;
      }}
    />
  );
}

export const RulesPaintAndFilter: StoryObj = { name: "Rules, paint and filter", render: () => <CellColorsGrid rows={0} /> };
export const LargeTable: StoryObj = { name: "Rules over 60 rows", render: () => <CellColorsGrid rows={60} /> };
