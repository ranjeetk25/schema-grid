/**
 * Column show / hide picker model (v0.3). Framework-free (copied verbatim by ui-shadcn).
 *
 * Items come from the live view (`handle.captureView()` → `columnState`, in
 * display order) intersected with the schema and the user's access:
 * permission-hidden columns are NEVER listed; `ColumnDef.hidden` columns are
 * listed and start hidden. The result of an edit is an AG `applyColumnState`
 * payload (`toColumnState`), so the grid emits `onViewChange` and the change
 * lives in the current view's `columnState` (saved with the view, undone by
 * switching views).
 */
import type { Access, ColumnDef, GridSchema, ViewDef } from "@ranjeetk25/schema-grid-core";

export interface ColumnPickerItem {
  id: string;
  label: string;
  type: string;
  visible: boolean;
}

const readable = (access: ReadonlyMap<string, Access>, id: string): boolean => {
  const a = access.get(id);
  return a === "read" || a === "edit";
};

/** Listable columns in display order with their current visibility. */
export function listPickerColumns(schema: GridSchema, access: ReadonlyMap<string, Access>, view: ViewDef | null): ColumnPickerItem[] {
  const byId = new Map(schema.columns.map((c) => [c.id, c]));
  const items: ColumnPickerItem[] = [];
  const seen = new Set<string>();
  const push = (column: ColumnDef, visible: boolean) => {
    if (seen.has(column.id) || !readable(access, column.id)) return;
    seen.add(column.id);
    items.push({ id: column.id, label: column.label || column.id, type: column.type, visible });
  };
  for (const state of [...(view?.columnState ?? [])].sort((a, b) => a.order - b.order)) {
    const column = byId.get(state.id);
    if (column) push(column, !state.hidden);
  }
  for (const column of [...schema.columns].sort((a, b) => a.order - b.order)) push(column, !column.hidden);
  return items;
}

export function filterPickerColumns(items: readonly ColumnPickerItem[], search: string): ColumnPickerItem[] {
  const needle = search.trim().toLowerCase();
  return needle === "" ? [...items] : items.filter((i) => i.label.toLowerCase().includes(needle));
}

export function hiddenCount(items: readonly ColumnPickerItem[]): number {
  return items.filter((i) => !i.visible).length;
}

export function togglePickerColumn(items: readonly ColumnPickerItem[], id: string): ColumnPickerItem[] {
  return items.map((i) => (i.id === id ? { ...i, visible: !i.visible } : i));
}

export function setAllPickerColumns(items: readonly ColumnPickerItem[], visible: boolean): ColumnPickerItem[] {
  return items.map((i) => (i.visible === visible ? i : { ...i, visible }));
}

/** Swaps the item with its neighbour; out-of-range moves return the same array. */
export function movePickerColumn(items: readonly ColumnPickerItem[], id: string, delta: -1 | 1): ColumnPickerItem[] {
  const index = items.findIndex((i) => i.id === id);
  const target = index + delta;
  if (index === -1 || target < 0 || target >= items.length) return [...items];
  const next = [...items];
  const a = next[index] as ColumnPickerItem;
  next[index] = next[target] as ColumnPickerItem;
  next[target] = a;
  return next;
}

/** AG Grid `applyColumnState({ state, applyOrder: true })` payload for the items, in order. */
export function toColumnState(items: readonly ColumnPickerItem[]): { colId: string; hide: boolean }[] {
  return items.map((i) => ({ colId: i.id, hide: !i.visible }));
}

/** "id:1,id:0,…" — order + visibility of the listable columns; equal for two views that show the same columns the same way. */
export function columnSignature(items: readonly ColumnPickerItem[]): string {
  return items.map((i) => `${i.id}:${i.visible ? 1 : 0}`).join(",");
}
