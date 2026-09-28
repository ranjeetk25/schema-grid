/** v0.4 filter by color: "color is" / "has no color" in the builder when `capabilities.cellColors.filter`. */
import { screen, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { FilterNode, GridSchema } from "../internal/core-contracts";
import {
  FIXTURE_IDS,
  buildFixtureAccess,
  buildFixtureRegistry,
  buildFixtureSchema,
  buildStubUiRegistry,
} from "../test/fixtures";
import { renderWithMantine } from "../test/render";
import { describeCondition } from "./describeFilter";
import { FilterBuilder } from "./FilterBuilder";
import {
  filterableColumns,
  fromDraft,
  operatorsFor,
  toDraft,
  updateCondition,
} from "./model";
import { isComplete } from "./liveFilter";

const base = buildFixtureSchema();
/** `notes` is `filterable: false`: only the color operators apply to it. */
const schema: GridSchema = {
  ...base,
  columns: base.columns.map((c) =>
    c.id === FIXTURE_IDS.notes ? { ...c, filterable: false } : c,
  ),
};
const registry = buildFixtureRegistry();
const access = buildFixtureAccess(schema);
const COLORS = { cellColors: { read: true, write: true, filter: true } };
const NO_COLORS = { cellColors: { read: true, write: true, filter: false } };
const col = (id: string) => {
  const c = schema.columns.find((x) => x.id === id);
  if (!c) throw new Error(id);
  return c;
};

const inputs = (name: string): HTMLInputElement[] =>
  within(document.body)
    .getAllByLabelText(name)
    .filter((e): e is HTMLInputElement => e.tagName === "INPUT");

async function pick(user: UserEvent, field: string, option: string) {
  const el = inputs(field).at(-1);
  if (!el) throw new Error(field);
  await user.click(el);
  await user.click(await screen.findByRole("option", { name: option }));
}

describe("model: color operators", () => {
  it("operatorsFor appends color is / has no color only when the capabilities allow", () => {
    const pay = col(FIXTURE_IDS.payment);
    expect(operatorsFor(pay, registry).map((o) => o.id)).not.toContain(
      "colorIs",
    );
    expect(
      operatorsFor(pay, registry, NO_COLORS).map((o) => o.id),
    ).not.toContain("colorIs");
    const ids = operatorsFor(pay, registry, COLORS).map((o) => o.id);
    expect(ids.slice(-2)).toEqual(["colorIs", "colorIsNone"]);
    expect(ids).toContain("is");
  });

  it("a filterable:false column offers only the color operators, and only with the capability", () => {
    expect(
      operatorsFor(col(FIXTURE_IDS.notes), registry, COLORS).map((o) => o.id),
    ).toEqual(["colorIs", "colorIsNone"]);
    expect(filterableColumns(schema, access).map((c) => c.id)).not.toContain(
      FIXTURE_IDS.notes,
    );
    expect(
      filterableColumns(schema, access, COLORS).map((c) => c.id),
    ).toContain(FIXTURE_IDS.notes);
    // Hidden columns stay out either way.
    expect(
      filterableColumns(schema, access, COLORS).map((c) => c.id),
    ).not.toContain(FIXTURE_IDS.secret);
  });

  it("picking colorIs starts with an empty color list; the AST round-trips", () => {
    const ctx = { schema, registry, capabilities: COLORS };
    let d = toDraft(null);
    d = {
      ...d,
      children: [
        {
          kind: "condition",
          id: "c1",
          columnId: FIXTURE_IDS.payment,
          operator: "is",
          value: null,
        },
      ],
    };
    d = updateCondition(d, "c1", { operator: "colorIs" }, ctx);
    expect(d.children[0]).toMatchObject({ operator: "colorIs", value: [] });
    d = updateCondition(d, "c1", { value: ["red"] }, ctx);
    expect(fromDraft(d, ctx)).toEqual({
      op: "and",
      children: [
        { columnId: FIXTURE_IDS.payment, operator: "colorIs", value: ["red"] },
      ],
    });
    d = updateCondition(d, "c1", { operator: "colorIsNone" }, ctx);
    expect(fromDraft(d, ctx)).toEqual({
      op: "and",
      children: [{ columnId: FIXTURE_IDS.payment, operator: "colorIsNone" }],
    });
  });

  it("isComplete accepts color conditions with at least one color", () => {
    const ctx = { schema, registry };
    expect(
      isComplete(
        { columnId: FIXTURE_IDS.notes, operator: "colorIs", value: ["red"] },
        ctx,
      ),
    ).toBe(true);
    expect(
      isComplete(
        { columnId: FIXTURE_IDS.notes, operator: "colorIs", value: [] },
        ctx,
      ),
    ).toBe(false);
    expect(
      isComplete({ columnId: FIXTURE_IDS.notes, operator: "colorIsNone" }, ctx),
    ).toBe(true);
  });

  it("describeCondition names the colors", () => {
    expect(
      describeCondition(
        {
          columnId: FIXTURE_IDS.payment,
          operator: "colorIs",
          value: ["red", "blue"],
        },
        schema,
        registry,
      ),
    ).toBe("Payment status color is Red, Blue");
    expect(
      describeCondition(
        { columnId: FIXTURE_IDS.payment, operator: "colorIsNone" },
        schema,
        registry,
      ),
    ).toBe("Payment status has no color");
  });
});

function setup(capabilities?: typeof COLORS, value: FilterNode | null = null) {
  const onChange = vi.fn<(node: FilterNode | null) => unknown>();
  const r = renderWithMantine(
    <FilterBuilder
      debounceMs={0}
      schema={schema}
      registry={registry}
      uiRegistry={buildStubUiRegistry()}
      access={access}
      value={value}
      onChange={onChange}
      {...(capabilities ? { capabilities } : {})}
    />,
  );
  return { ...r, onChange };
}

describe("FilterBuilder: filter by color", () => {
  it("offers color is / has no color with a swatch picker and emits colorIs", async () => {
    const { user, onChange } = setup(COLORS);
    await user.click(screen.getByRole("button", { name: "Add condition" }));
    await pick(user, "Column", "Payment status");
    await pick(user, "Operator", "color is");
    const group = screen.getByRole("group", { name: "Colors" });
    await user.click(within(group).getByRole("checkbox", { name: "Red" }));
    await user.click(within(group).getByRole("checkbox", { name: "Blue" }));
    expect(onChange).toHaveBeenLastCalledWith({
      op: "and",
      children: [
        {
          columnId: FIXTURE_IDS.payment,
          operator: "colorIs",
          value: ["red", "blue"],
        },
      ],
    });
    await user.click(within(group).getByRole("checkbox", { name: "Red" }));
    expect(onChange).toHaveBeenLastCalledWith({
      op: "and",
      children: [
        { columnId: FIXTURE_IDS.payment, operator: "colorIs", value: ["blue"] },
      ],
    });
  });

  it("offers a filterable:false column for color only", async () => {
    const { user, onChange } = setup(COLORS);
    await user.click(screen.getByRole("button", { name: "Add condition" }));
    await pick(user, "Column", "Notes");
    expect(inputs("Operator").at(-1)?.value).toBe("color is");
    await pick(user, "Operator", "has no color");
    expect(onChange).toHaveBeenLastCalledWith({
      op: "and",
      children: [{ columnId: FIXTURE_IDS.notes, operator: "colorIsNone" }],
    });
  });

  it("without the capability there are no color operators", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Add condition" }));
    await pick(user, "Column", "Payment status");
    const op = inputs("Operator").at(-1);
    if (!op) throw new Error("no operator");
    await user.click(op);
    const names = screen.getAllByRole("option").map((o) => o.textContent);
    expect(names).toContain("is");
    expect(names).not.toContain("color is");
  });

  it("renders an existing color condition with its colors checked", () => {
    setup(COLORS, {
      op: "and",
      children: [
        {
          columnId: FIXTURE_IDS.payment,
          operator: "colorIs",
          value: ["green"],
        },
      ],
    });
    expect(inputs("Operator").map((i) => i.value)).toEqual(["color is"]);
    expect(screen.getByRole("checkbox", { name: "Green" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Red" })).not.toBeChecked();
  });
});
