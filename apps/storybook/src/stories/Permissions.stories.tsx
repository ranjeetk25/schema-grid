import { Badge, Stack, Table, Text, Title } from "@mantine/core";
import { SchemaGrid } from "@masai/schema-grid-ag-grid";
import { type Access, resolveColumnAccess } from "@masai/schema-grid-core";
import type { Meta, StoryObj } from "@storybook/react";
import { useMemo } from "react";
import { GRID_OPTIONS, uiRegistry } from "../support/Workbench";
import {
  USERS,
  type UserKey,
  createMemoryDataSource,
  createPermissionMatrixSchema,
  instrument,
  registry,
  resolver,
} from "../support/data";

/**
 * Story 2 — the same schema seen by admin, counsellor and viewer.
 * `fee` is read-only for non-admins, `notes` is hidden from non-admins,
 * every other column is editable by admin/counsellor only (viewer: read-only),
 * formula `balance` is always read-only.
 */
const meta: Meta = { title: "2. Permissions" };
export default meta;

const COLORS: Record<Access, string> = {
  edit: "green",
  read: "blue",
  hidden: "gray",
};

function AccessTable() {
  const schema = useMemo(() => createPermissionMatrixSchema(), []);
  const maps = (Object.keys(USERS) as UserKey[]).map(
    (k) => [k, resolveColumnAccess(schema, resolver, USERS[k])] as const,
  );
  return (
    <Table
      withTableBorder
      withColumnBorders
      data-testid="access-matrix"
      fz="xs"
    >
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Column</Table.Th>
          {maps.map(([k]) => (
            <Table.Th key={k}>{k}</Table.Th>
          ))}
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {schema.columns.map((c) => (
          <Table.Tr key={c.id}>
            <Table.Td>{c.label}</Table.Td>
            {maps.map(([k, m]) => {
              const a = m.get(c.id) ?? "hidden";
              return (
                <Table.Td key={k} data-testid={`access-${k}-${c.key}`}>
                  <Badge size="xs" color={COLORS[a]}>
                    {a}
                  </Badge>
                </Table.Td>
              );
            })}
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

function RoleGrid({ who }: { who: UserKey }) {
  const schema = useMemo(() => createPermissionMatrixSchema(), []);
  const user = USERS[who];
  const ds = useMemo(
    () => instrument(createMemoryDataSource({ schema, user })),
    [schema, user],
  );
  return (
    <Stack gap={4} data-testid={`grid-${who}`}>
      <Title order={5}>
        {who}{" "}
        <Text span size="xs" c="dimmed">
          ({user.roles.join(", ")})
        </Text>
      </Title>
      <SchemaGrid
        schema={schema}
        dataSource={ds}
        user={user}
        registry={registry}
        resolver={resolver}
        uiRegistry={uiRegistry}
        height={240}
        gridOptions={GRID_OPTIONS}
      />
    </Stack>
  );
}

export const Matrix: StoryObj = {
  render: () => (
    <Stack>
      <AccessTable />
      <RoleGrid who="admin" />
      <RoleGrid who="counsellor" />
      <RoleGrid who="viewer" />
    </Stack>
  ),
};
export const Admin: StoryObj = { render: () => <RoleGrid who="admin" /> };
export const Counsellor: StoryObj = {
  render: () => <RoleGrid who="counsellor" />,
};
export const Viewer: StoryObj = { render: () => <RoleGrid who="viewer" /> };
