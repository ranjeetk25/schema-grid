import { XIcon } from "lucide-react";
import { useId } from "react";
import type { DataSource, GridSchema } from "../internal/core-contracts";
import type { UiFieldTypeRegistry } from "../internal/grid-contracts";
import { cn } from "../lib/cn";
import { Button } from "../ui/button";
import { Tooltip } from "../ui/tooltip";
import type { FilterDraftApi } from "./FilterBuilder";
import { FilterValueInput } from "./FilterValueInput";
import type { DraftCondition } from "./model";
import { ComboboxPicker, ErrorText, FieldTypeIcon, SelectField } from "./pickers";

export interface FilterConditionRowProps {
  condition: DraftCondition;
  api: FilterDraftApi;
  schema: GridSchema;
  uiRegistry: UiFieldTypeRegistry;
  dataSource?: DataSource;
  /** Leading label: "Where" for the first row, then the group's conjunction. Default "Where". */
  conjunction?: string;
  /** Accessible name of the row. Default "Condition". */
  label?: string;
}

/** Width of the leading Where/and/or column; nested cards and error lines align to it. */
export const CONJUNCTION_WIDTH = "sg:w-12";

/**
 * One Notion/Linear-style inline condition:
 * [Where/and/or] [column picker] [operator] [value] [remove].
 */
export function FilterConditionRow({
  condition,
  api,
  schema,
  uiRegistry,
  dataSource,
  conjunction = "Where",
  label = "Condition",
}: FilterConditionRowProps) {
  const errors = api.errors.get(condition.id);
  const operators = api.operatorsForColumnId(condition.columnId);
  const operator = operators.find((o) => o.id === condition.operator);
  const column = condition.columnId ? schema.columns.find((c) => c.id === condition.columnId) : undefined;
  const invalid = Boolean(errors?.column || errors?.operator || errors?.value);
  const errorId = useId();
  const rowError = errors?.column ?? errors?.operator;

  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset would restyle the row; a labelled group is the intent
    <div role="group" aria-label={label} data-invalid={invalid || undefined} className="sg:flex sg:min-w-0 sg:flex-col sg:gap-1">
      <div className="sg:flex sg:min-w-0 sg:items-start sg:gap-1.5">
        <span
          data-slot="conjunction"
          className={cn(CONJUNCTION_WIDTH, "sg:flex sg:h-8 sg:shrink-0 sg:items-center sg:text-sm sg:text-muted-foreground")}
        >
          {conjunction}
        </span>
        <ComboboxPicker
          aria-label="Column"
          placeholder="Column"
          searchPlaceholder="Search columns…"
          emptyText="No columns found"
          className="sg:w-40 sg:shrink-0"
          items={api.columns.map((c) => ({ value: c.id, label: c.label, icon: <FieldTypeIcon type={c.type} /> }))}
          value={condition.columnId}
          onChange={(v) => api.updateCondition(condition.id, { columnId: v })}
          invalid={Boolean(errors?.column)}
          describedBy={errors?.column ? errorId : undefined}
        />
        <SelectField
          aria-label="Operator"
          placeholder="Operator"
          className="sg:w-32 sg:shrink-0"
          disabled={!column}
          items={operators.map((o) => ({ value: o.id, label: o.label }))}
          value={condition.operator}
          onChange={(v) => api.updateCondition(condition.id, { operator: v })}
          invalid={Boolean(errors?.operator)}
          describedBy={errors?.operator ? errorId : undefined}
        />
        <div className="sg:min-w-0 sg:flex-1">
          {column && operator ? (
            <FilterValueInput
              column={column}
              operator={operator}
              value={condition.value}
              schema={schema}
              registry={uiRegistry}
              dataSource={dataSource}
              error={errors?.value}
              onChange={(v) => api.updateCondition(condition.id, { value: v })}
            />
          ) : null}
        </div>
        <Tooltip content="Remove condition">
          <Button
            variant="subtle"
            size="icon"
            aria-label="Remove condition"
            className="sg:shrink-0"
            onClick={() => api.remove(condition.id)}
          >
            <XIcon aria-hidden className="sg:size-3.5" />
          </Button>
        </Tooltip>
      </div>
      {rowError ? (
        <div className="sg:flex sg:gap-1.5">
          <span aria-hidden className={cn(CONJUNCTION_WIDTH, "sg:shrink-0")} />
          <ErrorText id={errorId} error={rowError} />
        </div>
      ) : null}
    </div>
  );
}
