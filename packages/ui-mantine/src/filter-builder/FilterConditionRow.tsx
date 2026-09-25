import { ActionIcon, Select, type SelectProps, Tooltip } from "@mantine/core";
import { IconChevronDown, IconX } from "@tabler/icons-react";
import { useEffect, useRef } from "react";
import type { DataSource, GridSchema } from "../internal/core-contracts";
import type { UiFieldTypeRegistry } from "../internal/grid-contracts";
import type { FilterDraftApi } from "./FilterBuilder";
import { FilterValueInput } from "./FilterValueInput";
import { ColumnTypeIcon } from "./columnTypeIcon";
import type { DraftCondition } from "./model";

/** @deprecated Use `IconX` from `@tabler/icons-react`. Kept for backwards compatibility. */
export function CloseIcon() {
  return <IconX size={14} stroke={1.75} aria-hidden />;
}

export interface FilterConditionRowProps {
  condition: DraftCondition;
  api: FilterDraftApi;
  schema: GridSchema;
  uiRegistry: UiFieldTypeRegistry;
  dataSource?: DataSource;
  /** Leading word ("Where", "and", "or"). Omit for no lead column. */
  lead?: string;
}

const COMBOBOX: SelectProps["comboboxProps"] = { withinPortal: false, offset: 4, shadow: "md", radius: "lg" };
const CHEVRON = <IconChevronDown size={12} stroke={1.75} aria-hidden />;

/** One condition on one line: lead word · column pill · operator pill · value · remove. */
export function FilterConditionRow({ condition, api, schema, uiRegistry, dataSource, lead }: FilterConditionRowProps) {
  const errors = api.errors.get(condition.id);
  const operators = api.operatorsForColumnId(condition.columnId);
  const operator = operators.find((o) => o.id === condition.operator);
  const column = condition.columnId ? schema.columns.find((c) => c.id === condition.columnId) : undefined;
  const typeById = new Map(api.columns.map((c) => [c.id, c.type]));
  const columnData = api.columns.map((c) => ({ value: c.id, label: c.label }));
  const columnRef = useRef<HTMLInputElement>(null);

  // A freshly added row focuses its column picker.
  // biome-ignore lint/correctness/useExhaustiveDependencies: focus once, when this row is the one just added.
  useEffect(() => {
    if (api.lastAddedId === condition.id && !condition.columnId) columnRef.current?.focus();
  }, []);

  return (
    <div className="sg-fb-row" data-incomplete={column && operator ? undefined : ""}>
      {lead !== undefined ? <div className="sg-fb-lead">{lead}</div> : null}
      <Select
        ref={columnRef}
        aria-label="Column"
        placeholder="Column"
        searchable
        allowDeselect={false}
        w={156}
        style={{ flex: "none" }}
        data={columnData}
        value={condition.columnId}
        onChange={(v) => {
          if (v) api.updateCondition(condition.id, { columnId: v });
        }}
        leftSection={column ? <ColumnTypeIcon type={column.type} /> : undefined}
        leftSectionPointerEvents="none"
        rightSection={CHEVRON}
        rightSectionPointerEvents="none"
        renderOption={({ option }) => (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span style={{ display: "inline-flex", color: "var(--mantine-color-dimmed)" }}>
              <ColumnTypeIcon type={typeById.get(option.value)} />
            </span>
            {option.label}
          </span>
        )}
        error={errors?.column}
        comboboxProps={{ ...COMBOBOX, width: 220, position: "bottom-start" }}
      />
      <Select
        aria-label="Operator"
        placeholder="Operator"
        allowDeselect={false}
        w={124}
        style={{ flex: "none" }}
        disabled={!column}
        data={operators.map((o) => ({ value: o.id, label: o.label }))}
        value={condition.operator}
        onChange={(v) => {
          if (v) api.updateCondition(condition.id, { operator: v });
        }}
        rightSection={CHEVRON}
        rightSectionPointerEvents="none"
        error={errors?.operator}
        comboboxProps={{ ...COMBOBOX, width: 180, position: "bottom-start" }}
      />
      <div className="sg-fb-value">
        {column && operator ? (
          <FilterValueInput
            column={column}
            operator={operator}
            value={condition.value}
            schema={schema}
            registry={uiRegistry}
            dataSource={dataSource}
            error={errors?.value}
            size="xs"
            onChange={(v) => api.updateCondition(condition.id, { value: v })}
          />
        ) : null}
      </div>
      <Tooltip label="Remove condition" withinPortal={false}>
        <ActionIcon
          size="md"
          variant="subtle"
          color="gray"
          aria-label="Remove condition"
          onClick={() => api.remove(condition.id)}
          style={{ flex: "none", marginTop: 2 }}
        >
          <IconX size={14} stroke={1.75} />
        </ActionIcon>
      </Tooltip>
    </div>
  );
}
