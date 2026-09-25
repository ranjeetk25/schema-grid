import {
  Alert,
  Code,
  Loader,
  SegmentedControl,
  Stack,
  Text,
} from "@mantine/core";
import type { GridSchema } from "@masai/schema-grid-core";
import type { Meta, StoryObj } from "@storybook/react";
import { useEffect, useMemo, useState } from "react";
import { Workbench } from "../support/Workbench";
import { USERS, type UserKey, instrument } from "../support/data";
import {
  DEMO_API_URL,
  createHttpDataSource,
  fetchSchema,
  putSchema,
} from "../support/httpDataSource";

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
  const ds = useMemo(() => instrument(createHttpDataSource(client)), [client]);

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
    <Stack gap="xs">
      <SegmentedControl
        data={["admin", "counsellor", "viewer"]}
        value={role}
        onChange={(v) => setRole(v as UserKey)}
        w={320}
      />
      <Workbench
        key={role}
        dataSource={ds}
        schema={schema}
        user={user}
        mode="server"
        height={420}
        poll={{ intervalMs: 3000, enabled: pollEnabled }}
        persistViewsKey="schema-grid-demo-api-views"
        onSchemaChange={async (next) => {
          const saved = await putSchema(client, next);
          setSchema(saved);
          return saved;
        }}
      />
    </Stack>
  );
}

export const DemoApi: StoryObj = {
  name: "demo-api",
  render: () => <ServerGrid />,
};
