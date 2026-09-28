/** v0.4 filter by color in the filter builder: color operators, the swatch value picker, chips text. */
import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { FilterNode, GridSchema } from "../internal/core-contracts";
import { FIXTURE_IDS, buildFixtureAccess, buildFixtureRegistry, buildFixtureSchema, buildStubUiRegistry } from "../test/fixtures";
import { renderUi } from "../test/render";
import { describeCondition } from "./describeFilter";
import { FilterBuilder } from "./FilterBuilder";
import { columnColorFilter, filterableColumns, fromDraft, operatorsFor, setColumnColorFilter, toDraft, updateCondition } from "./model";

const COLORS_ON = { cellColors: { read: true, write: true, filter: true } };
const COLORS_OFF = { cellColors: { read: true, write: true, filter: false } };

const base = buildFixtureSchema();
/** Notes is `filterable: false`: only the color operators apply to it. */
const schema: GridSchema = {
  ...base,
  columns: base.columns.map((c) => (c.id === FIXTURE_IDS.notes ? { ...c, filterable: false } : c)),
};
const registry = buildFixtureRegistry();
const col = (id: string) => {
  const c = schema.columns.find((x) => x.id === id);
  if (!c) throw new Error(id);
  return c;
};
const ids = (ops: readonly { id: string }[]) => ops.map((o) => o.id);

describe("color operators (model)", () => {
  it("are appended only when capabilities.cellColors.filter is true", () => {
    const own = ids(operatorsFor(col(FIXTURE_IDS.payment), registry));
    expect(own).not.toContain("colorIs");
    expect(ids(operatorsFor(col(FIXTURE_IDS.payment), registry, COLORS_OFF))).toEqual(own);
    expect(ids(operatorsFor(col(FIXTURE_IDS.payment), registry, COLORS_ON))).toEqual([...own, "colorIs", "colorIsNone"]);
  });

  it("a filterable:false column offers only the color operators, and is pickable only then", () => {
    expect(ids(operatorsFor(col(FIXTURE_IDS.notes), registry, COLORS_ON))).toEqual(["colorIs", "colorIsNone"]);
    const access = buildFixtureAccess(schema);
    expect(filterableColumns(schema, access).map((c) => c.id)).not.toContain(FIXTURE_IDS.notes);
    expect(filterableColumns(schema, access, COLORS_ON).map((c) => c.id)).toContain(FIXTURE_IDS.notes);
    // Hidden columns stay out whatever the capabilities.
    expect(filterableColumns(schema, access, COLORS_ON).map((c) => c.id)).not.toContain(FIXTURE_IDS.secret);
  });

  it("choosing a filterable:false column starts on `color is` with no colors", () => {
    const draft = toDraft({ op: "and", children: [{ columnId: FIXTURE_IDS.payment, operator: "isEmpty" }] });
    const row = draft.children[0];
    if (!row) throw new Error("row");
    const next = updateCondition(draft, row.id, { columnId: FIXTURE_IDS.notes }, { schema, registry, capabilities: COLORS_ON });
    expect(next.children[0]).toMatchObject({ columnId: FIXTURE_IDS.notes, operator: "colorIs", value: [] });
  });

  it("fromDraft keeps a colorIsNone condition value-less", () => {
    const draft = toDraft({ op: "and", children: [{ columnId: FIXTURE_IDS.payment, operator: "colorIsNone" }] });
    expect(fromDraft(draft, { schema, registry, capabilities: COLORS_ON })).toEqual({
      op: "and",
      children: [{ columnId: FIXTURE_IDS.payment, operator: "colorIsNone" }],
    });
  });
});

describe("setColumnColorFilter / columnColorFilter", () => {
  const P = FIXTURE_IDS.payment;
  it("starts an AND root from no filter", () => {
    expect(setColumnColorFilter(null, P, ["red"])).toEqual({ op: "and", children: [{ columnId: P, operator: "colorIs", value: ["red"] }] });
    expect(setColumnColorFilter(null, P, "none")).toEqual({ op: "and", children: [{ columnId: P, operator: "colorIsNone" }] });
    expect(setColumnColorFilter(null, P, null)).toBeNull();
  });

  it("replaces the column's own top-level color condition and keeps the rest", () => {
    const current: FilterNode = {
      op: "and",
      children: [
        { columnId: P, operator: "colorIs", value: ["blue"] },
        { columnId: FIXTURE_IDS.amount, operator: "gt", value: 5 },
        { columnId: FIXTURE_IDS.amount, operator: "colorIsNone" },
      ],
    };
    expect(columnColorFilter(current, P)).toEqual(["blue"]);
    expect(columnColorFilter(current, FIXTURE_IDS.amount)).toBe("none");
    expect(columnColorFilter(current, FIXTURE_IDS.notes)).toBeNull();
    expect(setColumnColorFilter(current, P, "none")).toEqual({
      op: "and",
      children: [
        { columnId: FIXTURE_IDS.amount, operator: "gt", value: 5 },
        { columnId: FIXTURE_IDS.amount, operator: "colorIsNone" },
        { columnId: P, operator: "colorIsNone" },
      ],
    });
  });

  it("null clears the column's color condition (an emptied root becomes null)", () => {
    const current: FilterNode = {
      op: "and",
      children: [
        { columnId: P, operator: "colorIs", value: ["blue"] },
        { columnId: FIXTURE_IDS.amount, operator: "gt", value: 5 },
      ],
    };
    expect(setColumnColorFilter(current, P, null)).toEqual({ op: "and", children: [{ columnId: FIXTURE_IDS.amount, operator: "gt", value: 5 }] });
    expect(setColumnColorFilter({ op: "and", children: [{ columnId: P, operator: "colorIsNone" }] }, P, null)).toBeNull();
    expect(setColumnColorFilter({ columnId: P, operator: "colorIsNone" }, P, null)).toBeNull();
  });

  it("wraps an OR root (or another bare condition) in a new AND", () => {
    const or: FilterNode = {
      op: "or",
      children: [
        { columnId: P, operator: "is", value: "paid" },
        { columnId: P, operator: "isEmpty" },
      ],
    };
    expect(columnColorFilter(or, P)).toBeNull();
    expect(setColumnColorFilter(or, P, ["green"])).toEqual({ op: "and", children: [or, { columnId: P, operator: "colorIs", value: ["green"] }] });
    expect(setColumnColorFilter(or, P, null)).toBe(or);
    const bare: FilterNode = { columnId: P, operator: "colorIs", value: ["red"] };
    expect(columnColorFilter(bare, P)).toEqual(["red"]);
    expect(setColumnColorFilter(bare, P, ["green"])).toEqual({ op: "and", children: [{ columnId: P, operator: "colorIs", value: ["green"] }] });
  });
});

describe("describeCondition", () => {
  it("reads color conditions with palette labels", () => {
    expect(describeCondition({ columnId: FIXTURE_IDS.payment, operator: "colorIs", value: ["red", "teal"] }, schema, registry)).toBe(
      "Payment status color is Red, Teal",
    );
    expect(describeCondition({ columnId: FIXTURE_IDS.payment, operator: "colorIsNone" }, schema, registry)).toBe(
      "Payment status has no color",
    );
  });
});

function setup(capabilities?: typeof COLORS_ON) {
  const onChange = vi.fn<(node: FilterNode | null) => void>();
  const r = renderUi(
    <FilterBuilder
      schema={schema}
      registry={registry}
      uiRegistry={buildStubUiRegistry()}
      access={buildFixtureAccess(schema)}
      value={{ op: "and", children: [{ columnId: FIXTURE_IDS.payment, operator: "isEmpty" }] }}
      onChange={onChange}
      debounceMs={0}
      {...(capabilities ? { capabilities } : {})}
    />,
  );
  return { ...r, onChange };
}

async function operatorNames(user: ReturnType<typeof setup>["user"]) {
  await user.click(screen.getByRole("combobox", { name: "Operator" }));
  const names = (await screen.findAllByRole("option")).map((o) => o.textContent);
  return names;
}

describe("FilterBuilder (filter by color)", () => {
  it("offers no color operators without the capability", async () => {
    const { user } = setup();
    expect(await operatorNames(user)).not.toContain("color is");
  });

  it("builds `color is` with the swatch multi-picker", async () => {
    const { user, onChange } = setup(COLORS_ON);
    const names = await operatorNames(user);
    expect(names).toEqual(expect.arrayContaining(["color is", "has no color"]));
    await user.click(screen.getByRole("option", { name: "color is" }));
    const picker = await screen.findByRole("combobox", { name: "Colors" });
    await user.click(picker);
    const list = await screen.findByRole("listbox");
    const red = within(list).getByRole("option", { name: "Red" });
    expect(red.querySelector('[data-color="red"]')).not.toBeNull();
    await user.click(red);
    await user.click(within(list).getByRole("option", { name: "Blue" }));
    expect(onChange).toHaveBeenLastCalledWith({
      op: "and",
      children: [{ columnId: FIXTURE_IDS.payment, operator: "colorIs", value: ["red", "blue"] }],
    });
  });
});
