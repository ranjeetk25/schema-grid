import { ActionIcon, Button, Group, Paper, SegmentedControl, Stack, Text, Tooltip } from "@mantine/core";
import type { DataSource, GridSchema } from "../internal/core-contracts";
import type { UiFieldTypeRegistry } from "../internal/grid-contracts";
import type { FilterDraftApi } from "./FilterBuilder";
import { CloseIcon, FilterConditionRow } from "./FilterConditionRow";
import type { DraftGroup } from "./model";

export interface FilterGroupEditorProps {
  group: DraftGroup;
  /** Depth of this group; the root is 1. */
  depth: number;
  api: FilterDraftApi;
  schema: GridSchema;
  uiRegistry: UiFieldTypeRegistry;
  dataSource?: DataSource;
}

const OP_DATA = [
  { label: "AND", value: "and" },
  { label: "OR", value: "or" },
];

export function FilterGroupEditor({ group, depth, api, schema, uiRegistry, dataSource }: FilterGroupEditorProps) {
  const canAdd = api.canAddGroup(group.id);
  const nested = depth > 1;

  const body = (
    <Stack
      component="fieldset"
      gap="xs"
      aria-label="Filter group"
      style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
    >
      <Group justify="space-between" wrap="nowrap">
        <SegmentedControl
          size="xs"
          data={OP_DATA}
          value={group.op}
          onChange={(v) => api.setGroupOp(group.id, v === "or" ? "or" : "and")}
        />
        {nested ? (
          <ActionIcon variant="subtle" color="gray" aria-label="Remove group" onClick={() => api.remove(group.id)}>
            <CloseIcon />
          </ActionIcon>
        ) : null}
      </Group>

      {group.children.length === 0 ? (
        <Text size="sm" c="dimmed">
          No conditions
        </Text>
      ) : null}

      {group.children.map((child) =>
        child.kind === "condition" ? (
          <FilterConditionRow
            key={child.id}
            condition={child}
            api={api}
            schema={schema}
            uiRegistry={uiRegistry}
            dataSource={dataSource}
          />
        ) : (
          <FilterGroupEditor
            key={child.id}
            group={child}
            depth={depth + 1}
            api={api}
            schema={schema}
            uiRegistry={uiRegistry}
            dataSource={dataSource}
          />
        ),
      )}

      <Group gap="xs">
        <Button size="xs" variant="light" onClick={() => api.addCondition(group.id)}>
          Add condition
        </Button>
        <Tooltip
          label={`Groups can nest at most ${api.maxDepth} levels deep`}
          disabled={canAdd}
          withinPortal={false}
        >
          <span>
            <Button size="xs" variant="subtle" disabled={!canAdd} onClick={() => api.addGroup(group.id)}>
              Add group
            </Button>
          </span>
        </Tooltip>
      </Group>
    </Stack>
  );

  return nested ? (
    <Paper withBorder p="xs" radius="sm">
      {body}
    </Paper>
  ) : (
    body
  );
}
