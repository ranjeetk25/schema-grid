import { Alert, Divider, Stack } from "@mantine/core";
import { type Dispatch, useState } from "react";
import type { AccessMap } from "../internal/access";
import type { DataSource, FieldTypeRegistry, GridSchema } from "../internal/core-contracts";
import type { UiFieldTypeRegistry } from "../internal/grid-contracts";
import { CommonFields } from "./CommonFields";
import { FormulaEditor } from "./FormulaEditor";
import type { ColumnDraft, ColumnDraftAction, ColumnDraftErrors } from "./model";
import { ZodForm } from "./zod-form/ZodForm";
import { isPathTouched } from "./zod-form/humanizeZodIssue";

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
  /** Roles for option lists' "Who can set" control (v0.3). */
  roles?: string[];
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
  roles,
}: ConfigStepProps) {
  const fieldType = draft.type ? registry.get(draft.type) : undefined;
  // Errors appear per field, and only for fields the user has left.
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set());
  const fieldErrors = Object.fromEntries(Object.entries(errors.configFields ?? {}).filter(([path]) => isPathTouched(path, touched)));
  const hasFieldErrors = Object.keys(errors.configFields ?? {}).some((path) => path !== "");
  const rootError = errors.configFields?.[""] && !hasFieldErrors && touched.size > 0 ? errors.configFields[""] : undefined;
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
          errors={fieldErrors}
          onFieldBlur={(path) => setTouched((prev) => (prev.has(path) ? prev : new Set(prev).add(path)))}
          {...(roles ? { roles } : {})}
        />
      ) : null}
      {rootError && (
        <Alert color="red" variant="light">
          {rootError}
        </Alert>
      )}
    </Stack>
  );
}
