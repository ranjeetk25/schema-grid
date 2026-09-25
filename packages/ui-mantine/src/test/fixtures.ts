import type { ComponentType } from "react";
import { createElement } from "react";
import { vi } from "vitest";
import {
  type Access,
  type ColumnDef,
  type DataSource,
  type GridSchema,
  type LinkRef,
  type Option,
  createDefaultRegistry,
  createRolePermissionResolver,
  resolveColumnAccess,
} from "../internal/core-contracts";
import {
  type UiEditorProps,
  type UiFieldTypeRegistry,
  type UiFilterInputProps,
  type UiRendererProps,
  createUiFieldTypeRegistry,
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

export const PAYMENT_OPTIONS = [
  { label: "Paid", value: "paid", color: "green" },
  { label: "Pending", value: "pending", color: "yellow" },
  { label: "Failed", value: "failed", color: "red" },
];

const column = (c: Omit<ColumnDef, "createdAt" | "updatedAt">): ColumnDef => ({
  createdAt: FIXTURE_NOW,
  updatedAt: FIXTURE_NOW,
  ...c,
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
        config: { currency: "INR", locale: "en-IN", decimalScale: 0, fixedDecimalScale: false },
        order: 2,
      }),
      column({ id: FIXTURE_IDS.notes, key: "notes", label: "Notes", type: "longText", config: {}, order: 3 }),
      column({ id: FIXTURE_IDS.owner, key: "owner", label: "Owner", type: "user", config: { multiple: false }, order: 4 }),
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
      column({ id: FIXTURE_IDS.total, key: "total", label: "Total", type: "formula", config: {}, formula: "{amount} * 2", order: 7 }),
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

export const FIXTURE_USERS: Option[] = [
  { label: "Asha Rao", value: "u_asha", avatarUrl: "https://example.com/asha.png" },
  { label: "Vikram Singh", value: "u_vikram" },
];

export const FIXTURE_LINKS: LinkRef[] = [
  { id: "r_1", label: "Lead #1" },
  { id: "r_2", label: "Lead #2" },
];

export function buildStubDataSource() {
  return {
    getOptions: vi.fn(async (_columnId: string, _search?: string): Promise<Option[]> => FIXTURE_USERS),
    createOption: vi.fn(async (_columnId: string, label: string): Promise<Option> => ({
      label,
      value: label.toLowerCase().replace(/\s+/g, "_"),
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

const StubFilter: ComponentType<UiFilterInputProps> = ({ value, onChange }) =>
  createElement("input", {
    "data-testid": "stub-filter",
    value: value == null ? "" : String(value),
    onChange: (e: { target: { value: string } }) => onChange(e.target.value),
  });

/** Minimal UI registry: every built-in id gets a plain renderer/editor/filter. */
export function buildStubUiRegistry(): UiFieldTypeRegistry {
  const reg = createUiFieldTypeRegistry();
  for (const t of createDefaultRegistry().list()) {
    reg.register(t.id, {
      renderer: StubRenderer,
      editor: t.id === "formula" ? undefined : StubEditor,
      filterComponent: StubFilter,
    });
  }
  return reg;
}
