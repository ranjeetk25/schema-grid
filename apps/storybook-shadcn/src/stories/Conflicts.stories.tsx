import { Button } from "@masai/schema-grid-ui-shadcn";
import type { Meta, StoryObj } from "@storybook/react";
import { UserRoundPenIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Workbench } from "../support/Workbench";
import { USERS, createMemoryDataSource, createStorySchema, exposeToTests, instrument, remoteEdit, withRemoteActor } from "../support/shared";

/**
 * Story 6 — conflict prompt. "Remote edit" writes r1's Name as another user
 * behind the grid's back, so the grid's next edit of r1 carries a stale base
 * version → `onConflict` → `ConflictPopover` anchored to the cell: "Keep
 * theirs" adopts the remote value, "Overwrite" re-submits yours.
 */
const meta: Meta = { title: "6. Conflict prompt" };
export default meta;

function ConflictDemo() {
  const schema = useMemo(() => createStorySchema(), []);
  const memory = useMemo(() => createMemoryDataSource({ schema }), [schema]);
  const remoteRows = useMemo(() => new Set<string>(), []);
  const ds = useMemo(() => {
    const d = instrument(withRemoteActor(memory, remoteRows));
    exposeToTests("conflict", { snapshot: () => memory.snapshot() });
    return d;
  }, [memory, remoteRows]);
  const [remoteCount, setRemoteCount] = useState(0);
  return (
    <Workbench
      dataSource={ds}
      schema={schema}
      user={USERS.admin}
      height={300}
      toolbar={() => (
        <Button
          variant="ghost"
          onClick={async () => {
            const n = remoteCount + 1;
            remoteRows.add("r1");
            await remoteEdit(memory, "r1", { name: `Asha (remote ${n})` });
            setRemoteCount(n);
          }}
        >
          <UserRoundPenIcon />
          Remote edit r1 Name
        </Button>
      )}
      status={
        remoteCount > 0 ? <span data-testid="remote-count">{remoteCount === 1 ? "1 remote edit" : `${remoteCount} remote edits`}</span> : null
      }
    />
  );
}

export const KeepTheirsOrOverwrite: StoryObj = { name: "Keep theirs / overwrite", render: () => <ConflictDemo /> };
