import { Box, Button, Group, Popover, Stack, Text } from "@mantine/core";
import { type ReactNode, useId } from "react";
import type { ChangeConflict, ColumnDef, FieldTypeRegistry } from "../internal/core-contracts";
import { type ConflictResolution, type UiFieldTypeRegistry, resolveRendererWidget } from "../internal/grid-contracts";
import { formatRelativeTime } from "../internal/relative-time";

export interface ConflictPopoverProps {
  conflict: ChangeConflict;
  column: ColumnDef;
  registry: FieldTypeRegistry;
  uiRegistry: UiFieldTypeRegistry;
  now?: Date | string | number;
  opened: boolean;
  /** Wire to ag-grid's `resolve` from `events.onConflict(conflict, resolve)` (see `useMantineConflictPrompt`). */
  onResolve(resolution: ConflictResolution): void | Promise<void>;
  /** Escape / outside click: dismiss without resolving. */
  onClose?(): void;
  /** The cell anchor. */
  children: ReactNode;
}

/**
 * Anchored to the conflicting cell. `withinPortal={false}` keeps it inside
 * the grid's scroll container so it moves with the cell.
 */
export function ConflictPopover({
  conflict,
  column,
  registry,
  uiRegistry,
  now,
  opened,
  onResolve,
  onClose,
  children,
}: ConflictPopoverProps) {
  const headingId = `sg-conflict-heading-${useId()}`;
  const who = conflict.updatedBy?.name ?? "someone";
  const when = formatRelativeTime(conflict.updatedAt, now ?? new Date());
  const Renderer = resolveRendererWidget(uiRegistry.get(column.type).renderer);
  const fieldType = registry.get(column.type);
  const theirs = Renderer ? (
    <Renderer value={conflict.serverValue} column={column} config={column.config} fieldType={column.type} />
  ) : (
    <Text size="sm">{fieldType ? fieldType.format(conflict.serverValue, column.config) : String(conflict.serverValue ?? "")}</Text>
  );

  return (
    <Popover
      opened={opened}
      onClose={onClose}
      onDismiss={onClose}
      withinPortal={false}
      closeOnEscape
      trapFocus={false}
      position="bottom"
      withArrow
      shadow="md"
    >
      <Popover.Target>
        <Box component="span" style={{ display: "inline-block" }}>
          {children}
        </Box>
      </Popover.Target>
      {/*
        Mantine gives the dropdown role="dialog" and aria-labelledby → the
        anchor (an unlabelled cell wrapper); point it at our own heading.
      */}
      <Popover.Dropdown aria-labelledby={headingId}>
        <Stack gap="xs" maw={280}>
          <Text component="h2" id={headingId} size="sm" fw={600} m={0}>
            Edit conflict
          </Text>
          <Text size="sm">{`Changed by ${who} ${when}:`}</Text>
          <Box>{theirs}</Box>
          <Group gap="xs" justify="flex-end">
            <Button size="xs" variant="default" onClick={() => onResolve("keepTheirs")}>
              Keep theirs
            </Button>
            <Button size="xs" color="orange" onClick={() => onResolve("overwrite")}>
              Overwrite
            </Button>
          </Group>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
