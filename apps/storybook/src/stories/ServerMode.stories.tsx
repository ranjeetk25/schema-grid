import {
  Alert,
  Code,
  Loader,
  SegmentedControl,
  Stack,
  Text,
} from "@mantine/core";
import { createGridClient } from "@ranjeetk25/schema-grid-ag-grid";
import type { GridSchema } from "@ranjeetk25/schema-grid-core";
import { SchemaGridWorkbench, createMemoryViewStore } from "@ranjeetk25/schema-grid-ui-mantine";
import type { Meta, StoryObj } from "@storybook/react";
import { useEffect, useMemo, useState } from "react";
import { GRID_OPTIONS, Workbench, uiRegistry } from "../support/Workbench";
import { USERS, type UserKey, instrument, registry, resolver } from "../support/data";
import {
  DEMO_API_URL,
  createDemoDataSource,
  fetchSchema,
  putSchema,
} from "../support/demoApi";

/**
 * Story 4 — server (infinite) mode against apps/demo-api (Drizzle + MySQL).
 * Start it with `bun run db:up && bun run dev:api`. The API pins its clock to
 * the fixture's FIXTURE_NOW, so the §8 filter ("payment status is not Paid AND
 * call date is within yesterday") returns r2 and r3 (empty status). Saved
 * views persist in localStorage; add `&sgNow=<ISO>` to the iframe URL to
 * reopen them at another instant (sent as `x-now`), `&sgPoll=off` to stop
 * polling.
 */
const meta: Meta = { title: "4. Server mode (demo-api)" };
export default meta;

function ServerGrid() {
  const [role, setRole] = useState<UserKey>("admin");
  const user = USERS[role];
  // `?sgNow=<ISO>` on the iframe URL overrides the API clock (x-now), e.g. to reopen a view "the next day".
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const now = params.get("sgNow") ?? undefined;
  // `?sgPoll=off` disables the change-feed poll (two-browser conflict tests).
  const pollEnabled = params.get("sgPoll") !== "off";
  const client = useMemo(
    () => ({ user, ...(now ? { now } : {}) }),
    [user, now],
  );
  const [schema, setSchema] = useState<GridSchema | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setSchema(null);
    fetchSchema(client)
      .then((s) => live && setSchema(s))
      .catch(
        (e: unknown) =>
          live && setError(e instanceof Error ? e.message : String(e)),
      );
    return () => {
      live = false;
    };
  }, [client]);
  const ds = useMemo(() => instrument(createDemoDataSource(client)), [client]);

  if (error) {
    return (
      <Alert
        color="red"
        title="demo-api not reachable"
        data-testid="api-unreachable"
      >
        <Text size="sm">
          Could not load <Code>{DEMO_API_URL}/schema</Code>: {error}. Run{" "}
          <Code>bun run db:up</Code> and <Code>bun run dev:api</Code>.
        </Text>
      </Alert>
    );
  }
  if (!schema) return <Loader />;
  return (
    <Workbench
      key={role}
      title="Admissions"
      description="Server mode · demo-api"
      dataSource={ds}
      schema={schema}
      user={user}
      onRoleChange={setRole}
      mode="server"
      poll={{ intervalMs: 3000, enabled: pollEnabled }}
      persistViewsKey="schema-grid-demo-api-views"
      onSchemaChange={async (next) => {
        // PUT /schema is the registry's updateSchema: send the CURRENT version, the API bumps it.
        const saved = await putSchema(client, { ...next, schemaVersion: schema.schemaVersion });
        setSchema(saved);
        return saved;
      }}
    />
  );
}

export const DemoApi: StoryObj = {
  name: "demo-api",
  render: () => <ServerGrid />,
};

/**
 * The demo-api's `leads` grid: `defineGrid` + `createSqlViewDataSource` over a
 * plain MySQL table (1,200 rows, `maxPageSize` 200), rendered as the spec's
 * one-liner page: `<SchemaGridWorkbench client={createGridClient(...)} />`.
 * "+" columns persist in the API's schema store (values in the extension table).
 */
function LeadsGrid() {
  const user = USERS.admin;
  const client = useMemo(
    () =>
      createGridClient({
        baseUrl: `${DEMO_API_URL}/grid`,
        gridId: "leads",
        headers: () => ({ "x-user": user.id, "x-roles": user.roles.join(",") }),
      }),
    [user],
  );
  const viewStore = useMemo(() => createMemoryViewStore(), []);
  return (
    <div style={{ height: "100dvh" }}>
      <SchemaGridWorkbench
        client={client}
        user={user}
        resolver={resolver}
        registry={registry}
        uiRegistry={uiRegistry}
        title="Leads"
        subtitle="Existing table · defineGrid + createSqlViewDataSource"
        viewStore={viewStore}
        gridProps={{ gridOptions: GRID_OPTIONS }}
        testId="leads-workbench"
      />
    </div>
  );
}

export const Leads: StoryObj = {
  name: "leads (existing table)",
  render: () => <LeadsGrid />,
};
