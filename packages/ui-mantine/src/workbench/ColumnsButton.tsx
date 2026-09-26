/**
 * Toolbar "Columns" button (v0.3): a popover to show / hide and reorder the
 * listable columns of the current view. Pure model in `./columnPicker`.
 */
import { ActionIcon, Badge, Box, Button, Checkbox, Group, Popover, ScrollArea, Text, TextInput, Tooltip } from "@mantine/core";
import { useState } from "react";
import { ColumnTypeIcon } from "../filter-builder/columnTypeIcon";
import { IconChevronDown, IconChevronUp, IconColumns, IconSearch } from "../internal/icons";
import {
  type ColumnPickerItem,
  filterPickerColumns,
  hiddenCount,
  movePickerColumn,
  setAllPickerColumns,
  togglePickerColumn,
} from "./columnPicker";

export interface ColumnsButtonProps {
  items: ColumnPickerItem[];
  onChange(items: ColumnPickerItem[]): void;
}

export function ColumnsButton({ items, onChange }: ColumnsButtonProps) {
  const [opened, setOpened] = useState(false);
  const [search, setSearch] = useState("");
  const hidden = hiddenCount(items);
  const visible = filterPickerColumns(items, search);
  const label = hidden > 0 ? `Columns (${hidden} hidden)` : "Columns";
  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position="bottom-end"
      width={300}
      shadow="md"
      radius="lg"
      transitionProps={{ duration: 120 }}
      trapFocus
    >
      <Popover.Target>
        <Tooltip label="Columns" disabled={opened}>
          <ActionIcon
            variant="subtle"
            color="gray"
            size="lg"
            aria-label={label}
            aria-expanded={opened}
            data-testid="columns-button"
            onClick={() => setOpened((o) => !o)}
            style={{ position: "relative" }}
          >
            <IconColumns size={16} stroke={1.75} />
            {hidden > 0 ? (
              <Badge
                size="xs"
                circle
                variant="light"
                color="gray"
                data-testid="columns-hidden-count"
                style={{ position: "absolute", top: 1, right: 1, pointerEvents: "none", fontVariantNumeric: "tabular-nums" }}
              >
                {hidden}
              </Badge>
            ) : null}
          </ActionIcon>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown p={8} aria-label="Columns">
        <TextInput
          size="xs"
          aria-label="Search columns"
          placeholder="Search columns"
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          leftSection={<IconSearch size={14} stroke={1.75} />}
          mb={6}
        />
        <Group justify="space-between" px={4} mb={4}>
          <Text fz="xs" c="dimmed" data-testid="columns-summary">
            {hidden > 0 ? `${hidden} hidden` : "All columns shown"}
          </Text>
          <Group gap={4}>
            <Button size="compact-xs" variant="subtle" color="gray" onClick={() => onChange(setAllPickerColumns(items, true))} disabled={hidden === 0}>
              Show all
            </Button>
            <Button
              size="compact-xs"
              variant="subtle"
              color="gray"
              onClick={() => onChange(setAllPickerColumns(items, false))}
              disabled={hidden === items.length}
            >
              Hide all
            </Button>
          </Group>
        </Group>
        <ScrollArea.Autosize mah={320} type="auto">
          <Box component="ul" m={0} p={0} style={{ listStyle: "none" }} aria-label="Column list">
            {visible.map((item) => {
              const index = items.findIndex((i) => i.id === item.id);
              return (
                <Group key={item.id} component="li" gap={6} wrap="nowrap" h={30} px={4} style={{ borderRadius: 6 }} className="sg-columns-row">
                  <Checkbox
                    size="xs"
                    checked={item.visible}
                    onChange={() => onChange(togglePickerColumn(items, item.id))}
                    aria-label={item.label}
                    styles={{ body: { alignItems: "center" }, label: { display: "flex", alignItems: "center", gap: 6, fontSize: 13 } }}
                    label={
                      <>
                        <span style={{ color: "var(--mantine-color-dimmed)", display: "inline-flex" }}>
                          <ColumnTypeIcon type={item.type} />
                        </span>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.label}</span>
                      </>
                    }
                    style={{ flex: 1, minWidth: 0 }}
                  />
                  <Group gap={0} wrap="nowrap" style={{ flex: "none" }}>
                    <ActionIcon
                      size="sm"
                      variant="subtle"
                      color="gray"
                      aria-label={`Move ${item.label} up`}
                      disabled={index <= 0}
                      onClick={() => onChange(movePickerColumn(items, item.id, -1))}
                    >
                      <IconChevronUp size={14} stroke={1.75} />
                    </ActionIcon>
                    <ActionIcon
                      size="sm"
                      variant="subtle"
                      color="gray"
                      aria-label={`Move ${item.label} down`}
                      disabled={index === -1 || index >= items.length - 1}
                      onClick={() => onChange(movePickerColumn(items, item.id, 1))}
                    >
                      <IconChevronDown size={14} stroke={1.75} />
                    </ActionIcon>
                  </Group>
                </Group>
              );
            })}
            {visible.length === 0 ? (
              <Text fz="xs" c="dimmed" ta="center" py={12}>
                No matching columns
              </Text>
            ) : null}
          </Box>
        </ScrollArea.Autosize>
      </Popover.Dropdown>
    </Popover>
  );
}
