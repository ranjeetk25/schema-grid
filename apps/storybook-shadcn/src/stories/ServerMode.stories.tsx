import type { GridSchema } from "@ranjeetk25/schema-grid-core";
import { ToggleGroup, ToggleGroupItem } from "@ranjeetk25/schema-grid-ui-shadcn";
import type { Meta, StoryObj } from "@storybook/react";
import { CircleAlertIcon, LoaderCircleIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Workbench } from "../support/Workbench";
import { DEMO_API_URL, USERS, type UserKey, createDemoDataSource, fetchSchema, instrument, putSchema } from "../support/shared";

/**
 * Story 4 — server (infinite) mode against apps/demo-api (Drizzle + MySQL).
 * Start it with `bun run db:up && bun run dev:api`. `&sgNow=<ISO>` on the
 * iframe URL overrides the API clock, `&sgPoll=off` stops polling.
 */
const meta: Meta = { title: "4. Server mode (demo-api)" };
export default meta;

function ServerGrid() {
  const [role, setRole] = useState<UserKey>("admin");
  const user = USERS[role];
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const now = params.get("sgNow") ?? undefined;
  const pollEnabled = params.get("sgPoll") !== "off";
  const client = useMemo(() => ({ user, ...(now ? { now } : {}) }), [user, now]);
  const [schema, setSchema] = useState<GridSchema | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setSchema(null);
    fetchSchema(client)
      .then((s) => live && setSchema(s))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [client]);
  const ds = useMemo(() => instrument(createDemoDataSource(client)), [client]);

  if (error) {
    return (
      <div
        role="alert"
        data-testid="api-unreachable"
        className="sg-ui sg:flex sg:max-w-xl sg:gap-3 sg:rounded-lg sg:border sg:border-border sg:bg-subtle sg:p-4"
      >
        <CircleAlertIcon className="sg:mt-0.5 sg:size-4 sg:text-danger" />
        <div className="sg:flex sg:flex-col sg:gap-1">
          <p className="sg:text-sm sg:font-medium">demo-api is not reachable</p>
          <p className="sg:text-sm sg:text-muted-foreground">
            Could not load <code className="sg:font-mono sg:text-xs">{DEMO_API_URL}/schema</code> ({error}). Run{" "}
            <code className="sg:font-mono sg:text-xs">bun run db:up</code> and <code className="sg:font-mono sg:text-xs">bun run dev:api</code>.
          </p>
        </div>
      </div>
    );
  }
  if (!schema) {
    return (
      <div className="sg-ui sg:flex sg:items-center sg:gap-2 sg:text-sm sg:text-muted-foreground">
        <LoaderCircleIcon className="sg:size-4 sg:animate-spin" /> Loading schema…
      </div>
    );
  }
  return (
    <div className="sg-ui sg:flex sg:flex-col sg:gap-3">
      <div className="sg:flex sg:items-center sg:gap-2">
        <span className="sg:text-xs sg:text-muted-foreground">Viewing as</span>
        <ToggleGroup type="single" value={role} onValueChange={(v) => v && setRole(v as UserKey)} aria-label="Viewing as">
          {(["admin", "counsellor", "viewer"] as const).map((r) => (
            <ToggleGroupItem key={r} value={r} className="sg:capitalize">
              {r}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
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
    </div>
  );
}

export const DemoApi: StoryObj = { name: "demo-api", render: () => <ServerGrid /> };
