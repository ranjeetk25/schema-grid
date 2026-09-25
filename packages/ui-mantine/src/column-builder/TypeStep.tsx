import { SimpleGrid, Text, UnstyledButton } from "@mantine/core";
import type { FieldTypeId, FieldTypeRegistry } from "../internal/core-contracts";
import { fieldTypeMeta, sortFieldTypes } from "./fieldTypeMeta";

export interface TypeStepProps {
  registry: FieldTypeRegistry;
  value: FieldTypeId | null;
  onChange(type: FieldTypeId): void;
  /** Edit mode: the type cannot change. */
  locked?: boolean;
}

/**
 * Grid of compact field-type cards (icon, label, one-line description).
 * Each card is named by its label. `ColumnPanel` uses the searchable
 * `TypePicker` instead; this remains for hosts that want a card grid.
 */
export function TypeStep({ registry, value, onChange, locked = false }: TypeStepProps) {
  return (
    <SimpleGrid
      component="fieldset"
      cols={{ base: 2, sm: 4 }}
      spacing={8}
      aria-label="Field type"
      style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
    >
      {sortFieldTypes(registry.list()).map((t) => {
        const selected = t.id === value;
        const meta = fieldTypeMeta(t.id);
        const Icon = meta.icon;
        return (
          <UnstyledButton
            key={t.id}
            aria-pressed={selected}
            aria-label={t.label}
            disabled={locked && !selected}
            onClick={() => !locked && onChange(t.id)}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              minHeight: 72,
              padding: "10px 12px",
              border: `1px solid ${selected ? "var(--mantine-primary-color-filled)" : "var(--mantine-color-default-border)"}`,
              borderRadius: "var(--mantine-radius-lg)",
              background: selected ? "var(--mantine-primary-color-light)" : "var(--mantine-color-body)",
              opacity: locked && !selected ? 0.5 : 1,
              cursor: locked ? "default" : "pointer",
            }}
          >
            <Icon size={16} stroke={1.75} style={{ color: selected ? "var(--mantine-primary-color-filled)" : "var(--mantine-color-dimmed)" }} aria-hidden />
            <Text size="sm" fw={500} lh={1.3}>
              {t.label}
            </Text>
            <Text size="xs" c="dimmed" lh={1.3} lineClamp={2}>
              {meta.description}
            </Text>
          </UnstyledButton>
        );
      })}
    </SimpleGrid>
  );
}
