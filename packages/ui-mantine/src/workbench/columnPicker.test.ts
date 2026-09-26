import { type Access, type ViewDef, createRolePermissionResolver, resolveColumnAccess } from "@ranjeetk25/schema-grid-core";
import { FIXTURE_COLUMN_IDS as C, FIXTURE_USERS, createFixtureSchema } from "@ranjeetk25/schema-grid-core/testing";
import { describe, expect, it } from "vitest";
import {
  filterPickerColumns,
  hiddenCount,
  listPickerColumns,
  movePickerColumn,
  setAllPickerColumns,
  toColumnState,
  togglePickerColumn,
} from "./columnPicker";

const schema = createFixtureSchema();
const resolver = createRolePermissionResolver();
const adminAccess = resolveColumnAccess(schema, resolver, { id: "u1", roles: [...FIXTURE_USERS.admin.roles] });
const counsellorAccess = resolveColumnAccess(schema, resolver, { id: "u2", roles: [...FIXTURE_USERS.counsellor.roles] });

describe("listPickerColumns", () => {
  it("lists readable columns in schema order with schema `hidden` respected when there is no view", () => {
    const hiddenSchema = { ...schema, columns: schema.columns.map((c) => (c.id === C.fee ? { ...c, hidden: true } : c)) };
    const items = listPickerColumns(hiddenSchema, adminAccess, null);
    expect(items.map((i) => i.id)).toEqual([...schema.columns].sort((a, b) => a.order - b.order).map((c) => c.id));
    expect(items.find((i) => i.id === C.fee)?.visible).toBe(false);
    expect(items.find((i) => i.id === C.name)).toMatchObject({ label: "Name", type: "text", visible: true });
  });

  it("never lists permission-hidden columns", () => {
    expect(counsellorAccess.get(C.notes)).toBe("hidden");
    const items = listPickerColumns(schema, counsellorAccess, null);
    expect(items.some((i) => i.id === C.notes)).toBe(false);
  });

  it("follows the view's column order and hidden flags, appending columns the view does not know", () => {
    const view: ViewDef = {
      id: "v",
      name: "V",
      filter: null,
      sort: [],
      groupBy: [],
      pageSize: 50,
      columnState: [
        { id: C.fee, hidden: true, width: 100, pinned: null, order: 0 },
        { id: C.name, hidden: false, width: 100, pinned: null, order: 1 },
        { id: "ghost", hidden: false, width: 100, pinned: null, order: 2 },
      ],
    };
    const items = listPickerColumns(schema, adminAccess, view);
    expect(items.slice(0, 2).map((i) => [i.id, i.visible])).toEqual([
      [C.fee, false],
      [C.name, true],
    ]);
    expect(items.some((i) => i.id === "ghost")).toBe(false);
    expect(items).toHaveLength(schema.columns.length);
  });
});

describe("edits", () => {
  const items = listPickerColumns(schema, adminAccess, null);

  it("filters by label, counts hidden, toggles, shows / hides all", () => {
    expect(filterPickerColumns(items, "  pay ").map((i) => i.id)).toEqual([C.status]);
    expect(hiddenCount(items)).toBe(0);
    const toggled = togglePickerColumn(items, C.fee);
    expect(hiddenCount(toggled)).toBe(1);
    expect(hiddenCount(setAllPickerColumns(items, false))).toBe(items.length);
    expect(hiddenCount(setAllPickerColumns(toggled, true))).toBe(0);
  });

  it("moves an item up / down within bounds", () => {
    const first = items[0] as (typeof items)[number];
    const second = items[1] as (typeof items)[number];
    expect(movePickerColumn(items, second.id, -1).slice(0, 2).map((i) => i.id)).toEqual([second.id, first.id]);
    expect(movePickerColumn(items, first.id, -1).map((i) => i.id)).toEqual(items.map((i) => i.id));
    expect(movePickerColumn(items, "nope", 1).map((i) => i.id)).toEqual(items.map((i) => i.id));
  });

  it("produces an AG column-state payload in order", () => {
    const state = toColumnState(togglePickerColumn(items, C.fee));
    expect(state.find((s) => s.colId === C.fee)).toEqual({ colId: C.fee, hide: true });
    expect(state.map((s) => s.colId)).toEqual(items.map((i) => i.id));
  });

  it("access maps with unknown ids are ignored", () => {
    const access = new Map<string, Access>([["nope", "edit"]]);
    expect(listPickerColumns(schema, access, null)).toEqual([]);
  });
});
