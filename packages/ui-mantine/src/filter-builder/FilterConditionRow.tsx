import { ActionIcon, Box, Group, Select } from "@mantine/core";
import type { DataSource, GridSchema } from "../internal/core-contracts";
import type { UiFieldTypeRegistry } from "../internal/grid-contracts";
import type { FilterDraftApi } from "./FilterBuilder";
import { FilterValueInput } from "./FilterValueInput";
import type { DraftCondition } from "./model";

export function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

export interface FilterConditionRowProps {
  condition: DraftCondition;
  api: FilterDraftApi;
  schema: GridSchema;
  uiRegistry: UiFieldTypeRegistry;
  dataSource?: DataSource;
}

const COMBOBOX = { withinPortal: false } as const;

/** One condition: column Select, operator Select, value input, remove button. */
export function FilterConditionRow({ condition, api, schema, uiRegistry, dataSource }: FilterConditionRowProps) {
  const errors = api.errors.get(condition.id);
  const columnData = api.columns.map((c) => ({ value: c.id, label: c.label }));
  const operators = api.operatorsForColumnId(condition.columnId);
  const operator = operators.find((o) => o.id === condition.operator);
  const column = condition.columnId ? schema.columns.find((c) => c.id === condition.columnId) : undefined;

  return (
    <Group gap="xs" wrap="nowrap" align="flex-start">
      <Select
        aria-label="Column"
        placeholder="Column"
        searchable
        allowDeselect={false}
        w={180}
        data={columnData}
        value={condition.columnId}
        onChange={(v) => {
          if (v) api.updateCondition(condition.id, { columnId: v });
        }}
        error={errors?.column}
        comboboxProps={COMBOBOX}
      />
      <Select
        aria-label="Operator"
        placeholder="Operator"
        allowDeselect={false}
        w={150}
        disabled={!column}
        data={operators.map((o) => ({ value: o.id, label: o.label }))}
        value={condition.operator}
        onChange={(v) => {
          if (v) api.updateCondition(condition.id, { operator: v });
        }}
        error={errors?.operator}
        comboboxProps={COMBOBOX}
      />
      <Box style={{ flex: 1, minWidth: 0 }}>
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
      </Box>
      <ActionIcon variant="subtle" color="gray" mt={6} aria-label="Remove condition" onClick={() => api.remove(condition.id)}>
        <CloseIcon />
      </ActionIcon>
    </Group>
  );
}
