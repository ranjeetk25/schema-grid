import { ActionIcon, Button, Group, SegmentedControl, Stack, Text, Tooltip } from "@mantine/core";
import { IconPlus, IconX } from "@tabler/icons-react";
import type { ReactNode } from "react";
import type { DataSource, GridSchema } from "../internal/core-contracts";
import type { UiFieldTypeRegistry } from "../internal/grid-contracts";
import type { FilterDraftApi } from "./FilterBuilder";
import { FilterConditionRow } from "./FilterConditionRow";
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

const ICON = { size: 14, stroke: 1.75 } as const;

/** The leading word of a row: "Where" first, then the group's "and" / "or". */
export function leadWord(index: number, op: "and" | "or"): string {
  return index === 0 ? "Where" : op;
}

function Lead({ children }: { children: ReactNode }) {
  return <div className="sg-fb-lead">{children}</div>;
}

export function FilterGroupEditor({ group, depth, api, schema, uiRegistry, dataSource }: FilterGroupEditorProps) {
  const canAdd = api.canAddGroup(group.id);
  const nested = depth > 1;
  const groupError = api.errors.get(group.id)?.group;

  const opControl = (
    <SegmentedControl
      size="xs"
      data={OP_DATA}
      value={group.op}
      onChange={(v) => api.setGroupOp(group.id, v === "or" ? "or" : "and")}
    />
  );

  return (
    <Stack
      component="fieldset"
      gap={6}
      aria-label="Filter group"
      className={nested ? "sg-fb-group" : undefined}
      style={nested ? { margin: 0, minWidth: 0 } : { border: 0, padding: 0, margin: 0, minWidth: 0 }}
    >
      {groupError ? (
        <Text size="xs" c="red" role="alert">
          {groupError}
        </Text>
      ) : null}

      {group.children.length === 0 && !nested ? <div className="sg-fb-empty">Add a condition to filter rows</div> : null}
      {group.children.length === 0 && nested ? <div className="sg-fb-empty">Empty group</div> : null}

      {group.children.map((child, index) =>
        child.kind === "condition" ? (
          <FilterConditionRow
            key={child.id}
            condition={child}
            api={api}
            schema={schema}
            uiRegistry={uiRegistry}
            dataSource={dataSource}
            lead={leadWord(index, group.op)}
          />
        ) : (
          <div key={child.id} className="sg-fb-row">
            <Lead>{leadWord(index, group.op)}</Lead>
            <div className="sg-fb-value">
              <FilterGroupEditor
                group={child}
                depth={depth + 1}
                api={api}
                schema={schema}
                uiRegistry={uiRegistry}
                dataSource={dataSource}
              />
            </div>
          </div>
        ),
      )}

      <Group gap={4} justify="space-between" wrap="nowrap" mt={group.children.length > 0 ? 2 : 0}>
        <Group gap={2} wrap="nowrap">
          <Button
            size="xs"
            variant="subtle"
            color="gray"
            leftSection={<IconPlus {...ICON} />}
            onClick={() => api.addCondition(group.id)}
            data-sg-add-condition=""
            styles={{ section: { marginInlineEnd: 6 } }}
          >
            Add condition
          </Button>
          <Tooltip label={`Groups can nest at most ${api.maxDepth} levels deep`} disabled={canAdd} withinPortal={false}>
            <span>
              <Button
                size="xs"
                variant="subtle"
                color="gray"
                disabled={!canAdd}
                leftSection={<IconPlus {...ICON} />}
                onClick={() => api.addGroup(group.id)}
                styles={{ section: { marginInlineEnd: 6 }, root: canAdd ? undefined : { background: "transparent" } }}
              >
                Add group
              </Button>
            </span>
          </Tooltip>
        </Group>
        <Group gap={4} wrap="nowrap">
          {opControl}
          {nested ? (
            <Tooltip label="Remove group" withinPortal={false}>
              <ActionIcon size="md" variant="subtle" color="gray" aria-label="Remove group" onClick={() => api.remove(group.id)}>
                <IconX {...ICON} />
              </ActionIcon>
            </Tooltip>
          ) : null}
        </Group>
      </Group>
    </Stack>
  );
}
