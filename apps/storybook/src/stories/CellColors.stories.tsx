import type { ColorRule, GridRow, ViewDef } from "@ranjeetk25/schema-grid-core";
import { ALL_ROWS_VIEW } from "@ranjeetk25/schema-grid-ui-mantine";
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
 * Story 9 — v0.4 cell colors over the in-memory source (which reads, writes
 * and filters colors):
 * - the "Colored" view carries two color rules: paid rows green (whole row)
 *   and a partial payment's Paid cell yellow; "Color rules" edits them;
 * - two cells start with a manual color (painted colors win over rules);
 * - "Cell color" paints the selection (one undo step); the header menu's
 *   "Filter by color" and the filter builder's "color is" filter by the
 *   color a cell shows. Switch the Theme toolbar to see the dark palette.
 */
const meta: Meta = { title: "9. Cell colors" };
export default meta;

const RULES: ColorRule[] = [
  {
    id: "paid-rows",
    color: "green",
    target: { kind: "row" },
    when: { columnId: "col_status", operator: "is", value: "paid" },
  },
  {
    id: "partial-paid",
    color: "yellow",
    target: { kind: "cells", columnIds: ["col_paid"] },
    when: { columnId: "col_status", operator: "is", value: "partial" },
  },
];

const VIEWS: ViewDef[] = [
  { ...ALL_ROWS_VIEW, id: "colored", name: "Colored", colorRules: RULES },
  { ...ALL_ROWS_VIEW, id: "plain", name: "No rules" },
];

/** Fixture r1..r5 + 20 generated rows; x003 / x007 start with a manual color. */
function rows(): GridRow[] {
  return createLargeRows(20).map((r) =>
    r.id === "x003"
      ? { ...r, colors: { col_name: "purple" } }
      : r.id === "x007"
        ? { ...r, colors: { col_fee: "blue" } }
        : r,
  );
}

function CellColorsDemo() {
  const schema = useMemo(() => createStorySchema(), []);
  const memory = useMemo(
    () => createMemoryDataSource({ schema, rows: rows() }),
    [schema],
  );
  const ds = useMemo(() => {
    const d = instrument(memory);
    exposeToTests("colors", { snapshot: () => memory.snapshot() });
    return d;
  }, [memory]);
  return (
    <Workbench
      title="Admissions"
      description="Cell colors · rules, paint, filter by color"
      dataSource={ds}
      schema={schema}
      user={USERS.admin}
      initialViews={VIEWS}
      onSchemaChange={(next) => {
        memory.setSchema(next);
        return next;
      }}
    />
  );
}

export const CellColors: StoryObj = {
  name: "Rules, paint and filter by color",
  render: () => <CellColorsDemo />,
};

/**
 * v0.4.1: "Notes" is `filterable: false` (like a SQL-view computed column).
 * The "Has notes" view's rule colors the Name cell when Notes is not empty:
 * it renders fine, but a server couldn't filter Name by color through it, so
 * the header menu's "Filter by color" on Name is disabled with the reason, the
 * filter builder offers no "color is" for Name, and the rules dialog notes
 * "Can't be used to filter by color". Other columns still filter by color.
 */
const UNFILTERABLE_RULES: ColorRule[] = [
  {
    id: "has-notes",
    color: "orange",
    target: { kind: "cells", columnIds: ["col_name"] },
    when: { columnId: "col_notes", operator: "isNotEmpty" },
  },
];

function UnfilterableRuleDemo() {
  const schema = useMemo(() => {
    const base = createStorySchema();
    return {
      ...base,
      columns: base.columns.map((c) =>
        c.id === "col_notes" ? { ...c, filterable: false } : c,
      ),
    };
  }, []);
  const memory = useMemo(
    () => createMemoryDataSource({ schema, rows: createLargeRows(20) }),
    [schema],
  );
  const ds = useMemo(() => instrument(memory), [memory]);
  return (
    <Workbench
      title="Admissions"
      description="A color rule on a column the server can't filter"
      dataSource={ds}
      schema={schema}
      user={USERS.admin}
      initialViews={[
        {
          ...ALL_ROWS_VIEW,
          id: "has-notes",
          name: "Has notes",
          colorRules: UNFILTERABLE_RULES,
        },
      ]}
      onSchemaChange={(next) => {
        memory.setSchema(next);
        return next;
      }}
    />
  );
}

export const UnfilterableRule: StoryObj = {
  name: "Rule on an unfilterable column",
  render: () => <UnfilterableRuleDemo />,
};
