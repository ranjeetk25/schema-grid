import type { ChangeFeedEntry, GridRow } from "@masai/schema-grid-core";
import { Button, RemoteChangedBadge } from "@masai/schema-grid-ui-shadcn";
import type { Meta, StoryObj } from "@storybook/react";
import { UserRoundPenIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Workbench } from "../support/Workbench";
import {
  FIXTURE_NOW,
  USERS,
  createMemoryDataSource,
  createStorySchema,
  exposeToTests,
  instrument,
  remoteEdit,
  withRemoteActor,
} from "../support/shared";

/**
 * Story 7 — polling sync. The grid polls `getChanges` every 500 ms; "Remote
 * edit" changes r2's Paid as another user, which the next poll applies with a
 * flash, and the RemoteChangedBadge shows who.
 */
const meta: Meta = { title: "7. Polling sync" };
export default meta;

function PollingDemo() {
  const schema = useMemo(() => createStorySchema(), []);
  const memory = useMemo(() => createMemoryDataSource({ schema }), [schema]);
  const remoteRows = useMemo(() => new Set<string>(), []);
  const ds = useMemo(() => {
    const d = instrument(withRemoteActor(memory, remoteRows));
    exposeToTests("polling", {
      snapshot: () => memory.snapshot(),
      remoteEdit: async (rowId: string, cells: Record<string, unknown>) => {
        remoteRows.add(rowId);
        return remoteEdit(memory, rowId, cells);
      },
    });
    return d;
  }, [memory, remoteRows]);
  const [last, setLast] = useState<GridRow | null>(null);
  const [paid, setPaid] = useState(60000);
  const onRemoteChanges = useCallback((entry: ChangeFeedEntry) => {
    const row = entry.rows.find((r) => r.updatedBy);
    if (row) setLast(row);
  }, []);
  return (
    <Workbench
      dataSource={ds}
      schema={schema}
      user={USERS.admin}
      height={300}
      poll={{ intervalMs: 500, enabled: true }}
      onRemoteChanges={onRemoteChanges}
      toolbar={() => (
        <Button
          variant="ghost"
          onClick={async () => {
            const next = paid + 1000;
            remoteRows.add("r2");
            await remoteEdit(memory, "r2", { paid: next });
            setPaid(next);
          }}
        >
          <UserRoundPenIcon />
          Remote edit r2 Paid
        </Button>
      )}
      status={
        last ? (
          <span className="sg:inline-flex sg:items-center sg:gap-1.5" data-testid="remote-badge">
            Row {last.id} <RemoteChangedBadge updatedBy={last.updatedBy} updatedAt={last.updatedAt} now={FIXTURE_NOW} />
          </span>
        ) : null
      }
    />
  );
}

export const PollingHighlight: StoryObj = { name: "Polling highlight", render: () => <PollingDemo /> };
