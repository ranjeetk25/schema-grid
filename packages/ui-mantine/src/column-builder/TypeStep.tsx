import { SimpleGrid, Text, UnstyledButton } from "@mantine/core";
import type { FieldTypeId, FieldTypeRegistry } from "../internal/core-contracts";

export interface TypeStepProps {
  registry: FieldTypeRegistry;
  value: FieldTypeId | null;
  onChange(type: FieldTypeId): void;
  /** Edit mode: the type cannot change. */
  locked?: boolean;
}

/** Grid of selectable field-type cards from `registry.list()`. */
export function TypeStep({ registry, value, onChange, locked = false }: TypeStepProps) {
  return (
    <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs" role="group" aria-label="Field type">
      {registry.list().map((t) => {
        const selected = t.id === value;
        return (
          <UnstyledButton
            key={t.id}
            aria-pressed={selected}
            aria-label={t.label}
            disabled={locked && !selected}
            onClick={() => !locked && onChange(t.id)}
            p="sm"
            style={{
              border: `1px solid ${selected ? "var(--mantine-primary-color-filled)" : "var(--mantine-color-default-border)"}`,
              borderRadius: "var(--mantine-radius-md)",
              background: selected ? "var(--mantine-primary-color-light)" : undefined,
              opacity: locked && !selected ? 0.5 : 1,
              cursor: locked ? "default" : "pointer",
            }}
          >
            <Text size="sm" fw={selected ? 600 : 400}>
              {t.label}
            </Text>
            <Text size="xs" c="dimmed" ff="monospace">
              {t.id}
            </Text>
          </UnstyledButton>
        );
      })}
    </SimpleGrid>
  );
}
