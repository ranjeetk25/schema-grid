import { Box, Button, CloseButton, Group, Text, Tooltip } from "@mantine/core";
import { IconX } from "@tabler/icons-react";
import { type FieldTypeRegistry, type FilterNode, type GridSchema, isFilterGroup } from "../internal/core-contracts";
import type { AccessMap } from "../internal/access";
import { describeConditionParts, describeNode } from "./describeFilter";

export interface FilterChipsProps {
  schema: GridSchema;
  registry: FieldTypeRegistry;
  /** The APPLIED filter (not a builder draft). */
  value: FilterNode | null;
  onChange(node: FilterNode | null): void;
  /** When given, conditions on hidden columns read "Hidden column" instead of leaking the label. */
  access?: AccessMap;
  /** Show "Clear all" from this many chips on. Default 2. */
  clearAllFrom?: number;
}

const CHIP_STYLE = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  height: 24,
  maxWidth: 360,
  paddingInline: "8px 4px",
  borderRadius: 6,
  background: "var(--mantine-color-default-hover)",
  fontSize: 12,
  lineHeight: "24px",
  whiteSpace: "nowrap",
} as const;

/**
 * One light, removable chip per top-level child of the APPLIED filter
 * (nested groups are summarised): column and operator muted, value in 500.
 * Each chip's remove button is named "Remove filter: <description>"; a
 * subtle "Clear all" appears from `clearAllFrom` chips on.
 */
export function FilterChips({ schema, registry, value, onChange, access, clearAllFrom = 2 }: FilterChipsProps) {
  if (!value) return null;
  const root = isFilterGroup(value) ? value : { op: "and" as const, children: [value] };
  if (root.children.length === 0) return null;

  const removeAt = (index: number) => {
    const children = root.children.filter((_, i) => i !== index);
    onChange(children.length === 0 ? null : { op: root.op, children });
  };

  return (
    <Group
      component="ul"
      gap={6}
      wrap="wrap"
      align="center"
      aria-label="Active filters"
      style={{ listStyle: "none", margin: 0, padding: 0 }}
    >
      {root.children.map((child, i) => {
        const label = describeNode(child, schema, registry, access);
        const parts = isFilterGroup(child) ? null : describeConditionParts(child, schema, registry, access);
        return (
          <Box component="li" key={`${i}:${label}`} style={CHIP_STYLE} data-sg-filter-chip="">
            <Text component="span" size="xs" truncate style={{ minWidth: 0 }} title={label}>
              {parts ? (
                <>
                  <Text component="span" inherit c="dimmed">
                    {parts.label}
                  </Text>
                  {parts.operator ? (
                    <Text component="span" inherit c="dimmed">{` ${parts.operator}`}</Text>
                  ) : null}
                  {parts.value ? (
                    <Text component="span" inherit fw={500}>{` ${parts.value}`}</Text>
                  ) : null}
                </>
              ) : (
                <Text component="span" inherit fw={500}>
                  {label}
                </Text>
              )}
            </Text>
            <Tooltip label="Remove filter" withinPortal={false}>
              <CloseButton
                size={18}
                radius={4}
                aria-label={`Remove filter: ${label}`}
                onClick={() => removeAt(i)}
                icon={<IconX size={12} stroke={2} aria-hidden />}
                style={{ color: "var(--mantine-color-dimmed)", flex: "none" }}
              />
            </Tooltip>
          </Box>
        );
      })}
      {root.children.length >= clearAllFrom ? (
        <li style={{ display: "inline-flex" }}>
        <Button
          size="compact-xs"
          variant="subtle"
          color="gray"
          onClick={() => onChange(null)}
          styles={{ root: { fontWeight: 500, color: "var(--mantine-color-dimmed)" } }}
        >
          Clear all
        </Button>
        </li>
      ) : null}
    </Group>
  );
}
