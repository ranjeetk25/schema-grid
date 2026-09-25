import { Button, Code, Group, Text } from "@mantine/core";
import type { ChangeFeedEntry, GridRow } from "@masai/schema-grid-core";
import { RemoteChangedBadge } from "@masai/schema-grid-ui-mantine";
import type { Meta, StoryObj } from "@storybook/react";
import { useCallback, useMemo, useState } from "react";
import { Workbench } from "../support/Workbench";
import {
  FIXTURE_NOW,
  USERS,
  createMemoryDataSource,
  createStorySchema,
  exposeToTests,
  instrument,
} from "../support/data";
import { remoteEdit, withRemoteActor } from "../support/scripted";

/**
 * Story 7 — polling sync. The grid polls `getChanges` every 500 ms; "Remote
 * edit" changes r2's Paid as another user, which the next poll applies with a
 * flash + `sg-cell-remote-changed`, and the RemoteChangedBadge shows who.
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
        <Group gap="xs">
          <Button
            color="grape"
            onClick={async () => {
              const next = paid + 1000;
              remoteRows.add("r2");
              await remoteEdit(memory, "r2", { paid: next });
              setPaid(next);
            }}
          >
            Remote edit r2 Paid
          </Button>
          {last ? (
            <Group gap={4} data-testid="remote-badge">
              <Text size="xs">Row {last.id}:</Text>
              <RemoteChangedBadge
                updatedBy={last.updatedBy}
                updatedAt={last.updatedAt}
                now={FIXTURE_NOW}
              />
            </Group>
          ) : (
            <Text size="xs" c="dimmed">
              No remote changes yet <Code>{paid}</Code>
            </Text>
          )}
        </Group>
      )}
    />
  );
}

export const PollingHighlight: StoryObj = {
  name: "Polling highlight",
  render: () => <PollingDemo />,
};
