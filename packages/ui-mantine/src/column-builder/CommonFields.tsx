import { Input, Stack, Switch, TextInput } from "@mantine/core";
import type { Dispatch } from "react";
import type { ColumnDef, DataSource } from "../internal/core-contracts";
import { type UiFieldTypeRegistry, resolveEditorComponent } from "../internal/grid-contracts";
import type { ColumnDraft, ColumnDraftAction, ColumnDraftErrors } from "./model";

export interface CommonFieldsProps {
  draft: ColumnDraft;
  dispatch: Dispatch<ColumnDraftAction>;
  uiRegistry: UiFieldTypeRegistry;
  errors?: ColumnDraftErrors;
  /** Passed to the default-value editor (user/link/dynamic selects need it). */
  dataSource?: DataSource;
}

const noop = () => {};

/** A transient ColumnDef for rendering type widgets against the in-progress draft. */
export function draftAsColumn(draft: ColumnDraft): ColumnDef {
  return {
    id: draft.original?.id ?? "__draft__",
    key: draft.key || "__draft__",
    label: draft.label,
    type: draft.type ?? "text",
    config: draft.config,
    order: draft.original?.order ?? 0,
    createdAt: draft.original?.createdAt ?? "",
    updatedAt: draft.original?.updatedAt ?? "",
  };
}

export function CommonFields({ draft, dispatch, uiRegistry, errors = {}, dataSource }: CommonFieldsProps) {
  const isFormula = draft.type === "formula";
  const DefaultEditor = draft.type && !isFormula ? resolveEditorComponent(uiRegistry.get(draft.type).editor) : undefined;
  const column = draftAsColumn(draft);

  return (
    <Stack gap="sm">
      <TextInput
        label="Label"
        required
        value={draft.label}
        error={errors.label}
        onChange={(e) => dispatch({ type: "setLabel", label: e.currentTarget.value })}
        data-autofocus
      />
      <TextInput
        label="Key"
        required
        value={draft.key}
        error={errors.key}
        disabled={draft.mode === "edit"}
        description={
          draft.mode === "edit"
            ? "Keys cannot change: formulas and stored data depend on them"
            : "Used in formulas and storage; generated from the label"
        }
        onChange={(e) => dispatch({ type: "setKey", key: e.currentTarget.value })}
      />
      {!isFormula && (
        <Switch
          label="Required"
          checked={draft.required}
          onChange={(e) => dispatch({ type: "setRequired", required: e.currentTarget.checked })}
        />
      )}
      {DefaultEditor && (
        <Input.Wrapper label="Default value" description="Pre-filled for new rows">
          <DefaultEditor
            value={draft.defaultValue ?? null}
            onChange={(value) => dispatch({ type: "setDefault", value })}
            onCommit={(value) => {
              if (value !== undefined) dispatch({ type: "setDefault", value });
            }}
            onCancel={noop}
            column={column}
            config={draft.config}
            autoFocus={false}
            dataSource={dataSource}
          />
        </Input.Wrapper>
      )}
      <Switch
        label="Indexed"
        description="Speeds up filtering and sorting on large tables"
        checked={draft.indexed}
        onChange={(e) => dispatch({ type: "setIndexed", indexed: e.currentTarget.checked })}
      />
    </Stack>
  );
}
