import { Button, Code, Text } from "@mantine/core";
import type { Meta, StoryObj } from "@storybook/react";
import { useMemo, useState } from "react";
import { Workbench } from "../support/Workbench";
import {
  USERS,
  createMemoryDataSource,
  createStorySchema,
  exposeToTests,
  instrument,
} from "../support/data";
import { remoteEdit, withRemoteActor } from "../support/scripted";

/**
 * Story 6 — conflict prompt. "Remote edit" writes r1's Name as another user
 * behind the grid's back (no polling), so the grid's next edit of r1 carries a
 * stale base version → `onConflict` → `ConflictPopover` anchored to the cell:
 * "Keep theirs" adopts the remote value, "Overwrite" re-submits yours.
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
        <>
          <Button
            color="grape"
            onClick={async () => {
              const n = remoteCount + 1;
              remoteRows.add("r1");
              await remoteEdit(memory, "r1", { name: `Asha (remote ${n})` });
              setRemoteCount(n);
            }}
          >
            Remote edit r1 Name
          </Button>
          <Text size="xs" c="dimmed">
            Remote edits: <Code data-testid="remote-count">{remoteCount}</Code>
          </Text>
        </>
      )}
    />
  );
}

export const KeepTheirsOrOverwrite: StoryObj = {
  name: "Keep theirs / overwrite",
  render: () => <ConflictDemo />,
};
