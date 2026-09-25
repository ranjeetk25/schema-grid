import { createDefaultRegistry } from "../internal/core-contracts";
import type { FieldTypeRegistry } from "../internal/core-contracts";
import type { UiRendererProps } from "../internal/grid-contracts";
import { CELL_BOX_STYLE } from "./CellBox";

const NUMERIC_TYPES = new Set(["number", "currency"]);

function renderFormatted(registry: FieldTypeRegistry, { value, column, config, fieldType }: UiRendererProps) {
  const id = fieldType ?? column.type;
  const type = registry.get(id);
  if (!type) return null;
  return (
    <span style={{ ...CELL_BOX_STYLE, display: "block", lineHeight: "inherit", textOverflow: "ellipsis", fontVariantNumeric: NUMERIC_TYPES.has(id) ? "tabular-nums" : undefined }}>
      {type.format(value, config)}
    </span>
  );
}

/**
 * Builds a plain-text renderer from a field type registry: `fieldType.format(value, config)`.
 * Used for number, currency, date, datetime, text, email and phone.
 */
export function createFormattedRenderer(registry: FieldTypeRegistry) {
  return function FormattedRendererWithRegistry(props: UiRendererProps) {
    return renderFormatted(registry, props);
  };
}

let lazyDefaultRegistry: FieldTypeRegistry | undefined;
function getDefaultRegistry(): FieldTypeRegistry {
  if (!lazyDefaultRegistry) lazyDefaultRegistry = createDefaultRegistry();
  return lazyDefaultRegistry;
}

/** `FormattedRenderer` built on a lazily-created default field type registry. */
export function FormattedRenderer(props: UiRendererProps) {
  return renderFormatted(getDefaultRegistry(), props);
}
