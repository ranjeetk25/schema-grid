import { Pill } from "@mantine/core";
import { type FieldTypeRegistry, type FilterNode, type GridSchema, isFilterGroup } from "../internal/core-contracts";
import { describeNode } from "./describeFilter";

export interface FilterChipsProps {
  schema: GridSchema;
  registry: FieldTypeRegistry;
  value: FilterNode | null;
  onChange(node: FilterNode | null): void;
}

/** One removable pill per top-level child of the filter (nested groups are summarised). */
export function FilterChips({ schema, registry, value, onChange }: FilterChipsProps) {
  if (!value) return null;
  const root = isFilterGroup(value) ? value : { op: "and" as const, children: [value] };
  if (root.children.length === 0) return null;

  const removeAt = (index: number) => {
    const children = root.children.filter((_, i) => i !== index);
    onChange(children.length === 0 ? null : { op: root.op, children });
  };

  return (
    <Pill.Group>
      {root.children.map((child, i) => {
        const label = describeNode(child, schema, registry);
        return (
          <Pill
            key={`${i}:${label}`}
            withRemoveButton
            onRemove={() => removeAt(i)}
            // Mantine hides the remove button from AT and the tab order by default; standalone chips need it.
            removeButtonProps={{ "aria-label": `Remove filter: ${label}`, "aria-hidden": false, tabIndex: 0 }}
          >
            {label}
          </Pill>
        );
      })}
    </Pill.Group>
  );
}
