import { Alert, Divider, Stack } from "@mantine/core";
import type { Dispatch } from "react";
import type { AccessMap } from "../internal/access";
import type { DataSource, FieldTypeRegistry, GridSchema } from "../internal/core-contracts";
import type { UiFieldTypeRegistry } from "../internal/grid-contracts";
import { CommonFields } from "./CommonFields";
import { FormulaEditor } from "./FormulaEditor";
import type { ColumnDraft, ColumnDraftAction, ColumnDraftErrors } from "./model";
import { ZodForm } from "./zod-form/ZodForm";

export interface ConfigStepProps {
  draft: ColumnDraft;
  dispatch: Dispatch<ColumnDraftAction>;
  schema: GridSchema;
  registry: FieldTypeRegistry;
  uiRegistry: UiFieldTypeRegistry;
  access: AccessMap;
  errors: ColumnDraftErrors;
  onFormulaValidityChange(valid: boolean): void;
  dataSource?: DataSource;
}

/** Common fields, then the type's config form (ZodForm) or, for formula columns, the formula editor. */
export function ConfigStep({
  draft,
  dispatch,
  schema,
  registry,
  uiRegistry,
  access,
  errors,
  onFormulaValidityChange,
  dataSource,
}: ConfigStepProps) {
  const fieldType = draft.type ? registry.get(draft.type) : undefined;
  return (
    <Stack gap="md">
      <CommonFields draft={draft} dispatch={dispatch} uiRegistry={uiRegistry} errors={errors} dataSource={dataSource} />
      <Divider />
      {draft.type === "formula" ? (
        <FormulaEditor
          schema={schema}
          access={access}
          value={draft.formula}
          onChange={(formula) => dispatch({ type: "setFormula", formula })}
          selfKey={draft.key || undefined}
          onValidityChange={onFormulaValidityChange}
        />
      ) : fieldType ? (
        <ZodForm
          schema={fieldType.configSchema}
          value={draft.config}
          onChange={(config) => dispatch({ type: "setConfig", config })}
        />
      ) : null}
      {errors.config && (
        <Alert color="red" variant="light">
          {errors.config}
        </Alert>
      )}
    </Stack>
  );
}
