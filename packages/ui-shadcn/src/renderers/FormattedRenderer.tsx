import { createDefaultRegistry } from "../internal/core-contracts";
import type { FieldTypeRegistry } from "../internal/core-contracts";
import type { UiRendererProps } from "../internal/grid-contracts";
import { SG_ROOT, cn } from "../lib/cn";

const NUMERIC = new Set(["number", "currency"]);

function renderFormatted(registry: FieldTypeRegistry, { value, column, config, fieldType }: UiRendererProps) {
  const id = fieldType ?? column.type;
  const type = registry.get(id);
  if (!type) return null;
  return (
    <span className={cn(SG_ROOT, "sg:block sg:cursor-default sg:truncate sg:tabular-nums", NUMERIC.has(id) && "sg:text-right")}>
      {type.format(value, config)}
    </span>
  );
}

/**
 * Builds a plain-text renderer from a field type registry: `fieldType.format(value, config)`.
 * Used for number, currency, date, datetime, text, email and phone.
 * Tabular numerals; numbers and currency are right-aligned.
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
