import { SchemaGrid } from "@ranjeetk25/schema-grid-ag-grid";
import { type Access, type ActorRef, type ColumnPermissions, resolveColumnAccess } from "@ranjeetk25/schema-grid-core";
import { Badge, PermissionsStep, type UserDirectory, useGridThemeFromShadcn } from "@ranjeetk25/schema-grid-ui-shadcn";
import type { Meta, StoryObj } from "@storybook/react";
import { useMemo, useState } from "react";
import { GRID_OPTIONS, uiRegistry } from "../support/Workbench";
import { USERS, type UserKey, createMemoryDataSource, createPermissionMatrixSchema, instrument, registry, resolver } from "../support/shared";

/**
 * Story 2 — the same schema seen by admin, counsellor and viewer. `fee` is
 * read-only for non-admins, `notes` hidden from non-admins, every other column
 * editable by admin/counsellor only; formula `balance` is always read-only.
 */
const meta: Meta = { title: "2. Permissions" };
export default meta;

const VARIANT: Record<Access, "primary" | "neutral" | "outline"> = { edit: "primary", read: "neutral", hidden: "outline" };

function AccessTable() {
  const schema = useMemo(() => createPermissionMatrixSchema(), []);
  const maps = (Object.keys(USERS) as UserKey[]).map((k) => [k, resolveColumnAccess(schema, resolver, USERS[k])] as const);
  return (
    <div className="sg:overflow-hidden sg:rounded-lg sg:border sg:border-border">
      <table data-testid="access-matrix" className="sg:w-full sg:text-sm">
        <thead className="sg:bg-subtle sg:text-left sg:text-muted-foreground">
          <tr>
            <th className="sg:h-9 sg:px-3 sg:font-medium">Column</th>
            {maps.map(([k]) => (
              <th key={k} className="sg:h-9 sg:px-3 sg:font-medium sg:capitalize">
                {k}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {schema.columns.map((c) => (
            <tr key={c.id} className="sg:border-t sg:border-border">
              <td className="sg:h-9 sg:px-3">{c.label}</td>
              {maps.map(([k, m]) => {
                const a = m.get(c.id) ?? "hidden";
                return (
                  <td key={k} className="sg:px-3" data-testid={`access-${k}-${c.key}`}>
                    <Badge variant={VARIANT[a]}>{a}</Badge>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RoleGrid({ who }: { who: UserKey }) {
  const schema = useMemo(() => createPermissionMatrixSchema(), []);
  const user = USERS[who];
  const ds = useMemo(() => instrument(createMemoryDataSource({ schema, user })), [schema, user]);
  const { theme } = useGridThemeFromShadcn();
  return (
    <section className="sg:flex sg:flex-col sg:gap-2" data-testid={`grid-${who}`}>
      <h3 className="sg:flex sg:items-baseline sg:gap-2 sg:text-sm sg:font-semibold sg:capitalize">
        {who}
        <span className="sg:text-xs sg:font-normal sg:text-muted-foreground">{user.roles.join(", ")}</span>
      </h3>
      <SchemaGrid
        schema={schema}
        dataSource={ds}
        user={user}
        registry={registry}
        resolver={resolver}
        uiRegistry={uiRegistry}
        height={240}
        theme={theme}
        gridOptions={GRID_OPTIONS}
      />
    </section>
  );
}

export const Matrix: StoryObj = {
  render: () => (
    <div className="sg-ui sg:flex sg:flex-col sg:gap-6">
      <AccessTable />
      <RoleGrid who="admin" />
      <RoleGrid who="counsellor" />
      <RoleGrid who="viewer" />
    </div>
  ),
};
export const Admin: StoryObj = { render: () => <RoleGrid who="admin" /> };
export const Counsellor: StoryObj = { render: () => <RoleGrid who="counsellor" /> };
export const Viewer: StoryObj = { render: () => <RoleGrid who="viewer" /> };

/** A fake host directory (v0.4 `userDirectory`): search by name, resolve known ids. */
const PEOPLE: ActorRef[] = [
  { id: "u-priya", name: "Priya Sharma" },
  { id: "u-rahul", name: "Rahul Verma" },
  { id: "u-asha", name: "Asha Iyer" },
  { id: "u-vikram", name: "Vikram Singh" },
];
const fakeDirectory: UserDirectory = {
  search: async (query) => PEOPLE.filter((p) => p.name?.toLowerCase().includes(query.trim().toLowerCase())),
  resolve: async (ids) => PEOPLE.filter((p) => ids.includes(p.id)),
};

function PerPersonAccess() {
  // "u-left" is not in the directory: it shows as the raw id, marked "unknown user".
  const [value, setValue] = useState<ColumnPermissions>({ read: "all", edit: { roles: ["finance_team"], users: ["u-priya", "u-left"] } });
  return (
    <div className="sg-ui sg:flex sg:max-w-md sg:flex-col sg:gap-4">
      <PermissionsStep value={value} onChange={setValue} roles={["admin", "counsellor", "finance_team"]} userDirectory={fakeDirectory} />
      <code data-testid="per-person-value" className="sg:text-xs sg:text-muted-foreground">
        {JSON.stringify(value)}
      </code>
    </div>
  );
}

/** v0.4: the "Who can access" section with People pickers (per-person permissions). */
export const PerPerson: StoryObj = { render: () => <PerPersonAccess /> };
