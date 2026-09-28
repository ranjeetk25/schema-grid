import type { GridSchema, ViewDef } from "@ranjeetk25/schema-grid-core";
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
 *
 * v0.4.1 "Rule on an unfilterable column": Internal notes is `filterable:
 * false` (like a SQL-view computed column) and the view's rule colors
 * Payment status from it. The rule still renders, the Color rules dialog
 * notes "Can't be used to filter by color", and Payment status can't be
 * filtered by color (header menu item disabled with the reason, no "color
 * is" in the Filter builder).
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

const UNFILTERABLE_RULE: ViewDef = {
  ...COLOR_CODED,
  id: "view_unfilterable_rule",
  name: "Notes rule",
  colorRules: [
    {
      id: "rule_has_notes",
      color: "orange",
      target: { kind: "cells", columnIds: ["col_status"] },
      when: { op: "and", children: [{ columnId: "col_notes", operator: "isNotEmpty" }] },
    },
  ],
};

/** Internal notes can't be filtered on the server (a computed column, say). */
function unfilterableNotesSchema(): GridSchema {
  const schema = createStorySchema();
  return { ...schema, columns: schema.columns.map((c) => (c.id === "col_notes" ? { ...c, filterable: false } : c)) };
}

function CellColorsGrid({ rows, view = COLOR_CODED, unfilterableNotes = false }: { rows: number; view?: ViewDef; unfilterableNotes?: boolean }) {
  const schema = useMemo(() => (unfilterableNotes ? unfilterableNotesSchema() : createStorySchema()), [unfilterableNotes]);
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
      initialViews={[view]}
      onSchemaChange={(next) => {
        memory.setSchema(next);
        return next;
      }}
    />
  );
}

export const RulesPaintAndFilter: StoryObj = { name: "Rules, paint and filter", render: () => <CellColorsGrid rows={0} /> };
export const LargeTable: StoryObj = { name: "Rules over 60 rows", render: () => <CellColorsGrid rows={60} /> };
export const UnfilterableRule: StoryObj = {
  name: "Rule on an unfilterable column",
  render: () => <CellColorsGrid rows={0} view={UNFILTERABLE_RULE} unfilterableNotes />,
};
