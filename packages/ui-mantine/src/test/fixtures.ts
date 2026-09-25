import type { ComponentType } from "react";
import { createElement } from "react";
import { vi } from "vitest";
import {
  type Access,
  type ColumnDef,
  type ChangeBatch,
  type ChangeResult,
  type DataSource,
  type GridRow,
  type GridQuery,
  type GridSchema,
  type LinkRef,
  type Option,
  type QueryResult,
  type UserOption,
  createDefaultRegistry,
  createRolePermissionResolver,
  resolveColumnAccess,
} from "../internal/core-contracts";
import {
  type UiEditorProps,
  type UiFieldTypeRegistry,
  type UiRendererProps,
  type WidgetEntry,
  createDefaultUiRegistry,
  extendWithWidgets,
} from "../internal/grid-contracts";

export const FIXTURE_NOW = "2026-09-25T10:00:00.000Z";

export const FIXTURE_IDS = {
  payment: "col_payment",
  call: "col_call",
  amount: "col_amount",
  notes: "col_notes",
  owner: "col_owner",
  website: "col_website",
  secret: "col_secret",
  total: "col_total",
} as const;

export const PAYMENT_OPTIONS: Option[] = [
  { id: "paid", label: "Paid", color: "green" },
  { id: "pending", label: "Pending", color: "yellow" },
  { id: "failed", label: "Failed", color: "red" },
];

const DEFAULTS = createDefaultRegistry();

/** Fixture column whose config is the type's full `defaultConfig` overlaid with `c.config`. */
const column = (c: Omit<ColumnDef, "createdAt" | "updatedAt">): ColumnDef => ({
  createdAt: FIXTURE_NOW,
  updatedAt: FIXTURE_NOW,
  ...c,
  config: { ...(DEFAULTS.get(c.type)?.defaultConfig as object), ...(c.config as object) },
});

export function buildFixtureSchema(): GridSchema {
  return {
    id: "admissions",
    schemaVersion: 1,
    columns: [
      column({ id: FIXTURE_IDS.payment, key: "payment_status", label: "Payment status", type: "select", config: { options: PAYMENT_OPTIONS }, order: 0 }),
      column({ id: FIXTURE_IDS.call, key: "call_status", label: "Call status", type: "date", config: {}, order: 1 }),
      column({
        id: FIXTURE_IDS.amount,
        key: "amount",
        label: "Amount",
        type: "currency",
        config: { currencyCode: "INR", locale: "en-IN", precision: 0 },
        order: 2,
      }),
      column({ id: FIXTURE_IDS.notes, key: "notes", label: "Notes", type: "longText", config: {}, order: 3 }),
      column({ id: FIXTURE_IDS.owner, key: "owner", label: "Owner", type: "user", config: {}, order: 4 }),
      column({ id: FIXTURE_IDS.website, key: "website", label: "Website", type: "url", config: {}, order: 5 }),
      column({
        id: FIXTURE_IDS.secret,
        key: "secret",
        label: "Secret",
        type: "text",
        config: {},
        order: 6,
        permissions: { read: { roles: ["admin"] }, edit: { roles: ["admin"] } },
      }),
      column({ id: FIXTURE_IDS.total, key: "total", label: "Total", type: "formula", config: { resultType: "number" }, formula: "{amount} * 2", order: 7 }),
    ],
  };
}

export const FIXTURE_USER = { id: "u_1", roles: ["counsellor"] };

/** `secret` → hidden, `total` (formula) → read, everything else → edit. */
export function buildFixtureAccess(schema: GridSchema = buildFixtureSchema()): Map<string, Access> {
  return resolveColumnAccess(schema, createRolePermissionResolver(), FIXTURE_USER);
}

export const buildFixtureRegistry = createDefaultRegistry;

export function fixtureColumn(id: string, schema: GridSchema = buildFixtureSchema()): ColumnDef {
  const c = schema.columns.find((col) => col.id === id);
  if (!c) throw new Error(`fixture column ${id} missing`);
  return c;
}

export const FIXTURE_USERS: UserOption[] = [
  { id: "u_asha", label: "Asha Rao", avatarUrl: "https://example.com/asha.png" },
  { id: "u_vikram", label: "Vikram Singh" },
];

export const FIXTURE_LINKS: LinkRef[] = [
  { id: "r_1", label: "Lead #1" },
  { id: "r_2", label: "Lead #2" },
];

/** A full core `DataSource` whose option/lookup methods return fixtures; row methods are inert. */
export function buildStubDataSource() {
  return {
    fetch: vi.fn(async (_query: GridQuery): Promise<QueryResult<GridRow>> => ({ rows: [] })),
    applyChanges: vi.fn(async (_batch: ChangeBatch): Promise<ChangeResult> => ({ applied: [], conflicts: [], errors: [] })),
    createRows: vi.fn(async (_partials: unknown[]): Promise<GridRow[]> => []),
    deleteRows: vi.fn(async (_ids: string[]): Promise<void> => {}),
    getOptions: vi.fn(async (_columnId: string, _search?: string): Promise<Option[]> => FIXTURE_USERS),
    createOption: vi.fn(async (_columnId: string, label: string): Promise<Option> => ({
      id: label.toLowerCase().replace(/\s+/g, "_"),
      label,
    })),
    lookup: vi.fn(async (_columnId: string, _search: string): Promise<LinkRef[]> => FIXTURE_LINKS),
  } satisfies DataSource;
}

const StubRenderer: ComponentType<UiRendererProps> = ({ value }) =>
  createElement("span", { "data-testid": "stub-renderer" }, value == null ? "" : String(value));

const StubEditor: ComponentType<UiEditorProps> = ({ value, onChange }) =>
  createElement("input", {
    "data-testid": "stub-editor",
    value: value == null ? "" : String(value),
    onChange: (e: { target: { value: string } }) => onChange(e.target.value),
  });

/**
 * A real ag-grid `UiFieldTypeRegistry` whose every built-in id has a plain
 * stub renderer and inline stub editor widget (formula: renderer only).
 */
export function buildStubUiRegistry(): UiFieldTypeRegistry<GridRow> {
  const widgets: Record<string, WidgetEntry> = {};
  for (const t of createDefaultRegistry().list()) {
    widgets[t.id] = { renderer: StubRenderer, editor: t.id === "formula" ? null : StubEditor };
  }
  return extendWithWidgets(createDefaultUiRegistry<GridRow>(), widgets);
}
