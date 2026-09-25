import { Avatar, Box, Button, Group, Popover, Stack, Text } from "@mantine/core";
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

/** Up to two initials, e.g. "Priya (remote)" → "PR". */
export function initialsOf(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  const letters = words.length > 1 ? [words[0]?.[0], words[1]?.[0]] : [words[0]?.[0], words[0]?.[1]];
  return letters.filter(Boolean).join("").toUpperCase() || "?";
}

/**
 * Compact conflict card anchored to the conflicting cell (300px, 12px
 * padding): who changed it and when, their value on a subtle fill, then
 * "Keep theirs" and the primary "Overwrite". `withinPortal={false}` keeps it
 * inside the grid's scroll container so it moves with the cell.
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
      position="bottom-start"
      offset={4}
      shadow="md"
      radius="lg"
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
      <Popover.Dropdown aria-labelledby={headingId} w={300} p={12}>
        <Stack gap={10}>
          <Group gap={10} wrap="nowrap" align="flex-start">
            <Avatar size={24} radius="xl" color="gray" variant="light" aria-hidden styles={{ placeholder: { fontSize: 10 } }}>
              {initialsOf(who)}
            </Avatar>
            <Box style={{ minWidth: 0, flex: 1 }}>
              <Text component="h2" id={headingId} size="sm" fw={600} m={0} lh="18px">
                Edit conflict
              </Text>
              <Text size="xs" c="dimmed" lh="16px">
                {`Changed by ${who} · ${when}`}
              </Text>
            </Box>
          </Group>
          <Box>
            <Text size="xs" c="dimmed" mb={4}>
              {`Their ${column.label}`}
            </Text>
            <Box
              px={8}
              py={6}
              style={{ borderRadius: 6, background: "var(--mantine-color-default-hover)", fontSize: 13, minHeight: 32 }}
            >
              {theirs}
            </Box>
          </Box>
          <Group gap={6} justify="flex-end" wrap="nowrap">
            <Button size="xs" variant="default" onClick={() => onResolve("keepTheirs")}>
              Keep theirs
            </Button>
            <Button size="xs" onClick={() => onResolve("overwrite")}>
              Overwrite
            </Button>
          </Group>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
