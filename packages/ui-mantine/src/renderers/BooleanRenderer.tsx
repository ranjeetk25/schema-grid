import { Checkbox } from "@mantine/core";
import type { UiRendererProps } from "../internal/grid-contracts";

/**
 * A 16px checkbox look for boolean cells: accent when checked, a hairline box
 * when not, muted when the cell is read-only. Purely visual — it never takes
 * focus or clicks (the grid toggles the value in place through its edit
 * pipeline), so the input is inert and pointer events fall through to the cell.
 */
export function BooleanRenderer({ value, column, readOnly }: UiRendererProps<boolean, unknown>) {
  const checked = value === true;
  return (
    <span
      data-testid="boolean-cell"
      data-checked={checked || undefined}
      data-readonly={readOnly || undefined}
      style={{ display: "inline-flex", alignItems: "center", height: "100%", pointerEvents: "none" }}
    >
      <Checkbox
        size="xs"
        radius="xs"
        checked={checked}
        readOnly
        tabIndex={-1}
        aria-label={column.label}
        color={readOnly ? "gray" : undefined}
        onChange={() => {}}
        styles={{
          input: {
            cursor: "default",
            opacity: readOnly ? 0.55 : 1,
            ...(readOnly && checked ? { backgroundColor: "var(--mantine-color-dimmed)", borderColor: "var(--mantine-color-dimmed)" } : {}),
          },
        }}
      />
    </span>
  );
}
