import { ChevronRight, Lock } from "lucide-react";
import { type Dispatch, type Ref, useId, useState } from "react";
import type { ColumnDef, DataSource } from "../internal/core-contracts";
import { type UiFieldTypeRegistry, resolveEditorComponent } from "../internal/grid-contracts";
import { SG_ROOT, cn } from "../lib/cn";
import { Field } from "../ui/field";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";
import { Tooltip } from "../ui/tooltip";
import type { ColumnDraft, ColumnDraftAction, ColumnDraftErrors } from "./model";

export interface CommonFieldsProps {
  draft: ColumnDraft;
  dispatch: Dispatch<ColumnDraftAction>;
  uiRegistry: UiFieldTypeRegistry;
  errors?: ColumnDraftErrors;
  /** Passed to the default-value editor (user/link/dynamic selects need it). */
  dataSource?: DataSource;
  /** Called when a field loses focus (the form reveals its error from then on). */
  onFieldBlur?(field: "label" | "key"): void;
  autoFocus?: boolean;
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

/** Name input (15px) with the auto-derived key as a chip and an "Edit key" disclosure. */
export function NameField({
  draft,
  dispatch,
  errors = {},
  onFieldBlur,
  autoFocus = false,
  inputRef,
}: Pick<CommonFieldsProps, "draft" | "dispatch" | "errors" | "onFieldBlur" | "autoFocus"> & { inputRef?: Ref<HTMLInputElement> }) {
  const keyPanelId = useId();
  const editing = draft.mode === "edit";
  const [keyOpen, setKeyOpen] = useState(false);
  const showKeyInput = !editing && (keyOpen || !!errors.key);

  return (
    <div className="sg:flex sg:flex-col sg:gap-2">
      <Field label="Name" required error={errors.label}>
        {({ id, describedBy, invalid }) => (
          <Input
            ref={inputRef}
            id={id}
            autoFocus={autoFocus}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            aria-required
            placeholder="e.g. Payment status"
            value={draft.label}
            className="sg:h-9 sg:text-[15px] sg:font-medium"
            onChange={(e) => dispatch({ type: "setLabel", label: e.currentTarget.value })}
            onBlur={() => onFieldBlur?.("label")}
          />
        )}
      </Field>

      <div className="sg:flex sg:min-w-0 sg:items-center sg:gap-1.5 sg:text-xs sg:text-muted-foreground">
        <span>Key</span>
        {draft.key ? (
          <code
            data-testid="column-key"
            className="sg:truncate sg:rounded-xs sg:bg-muted sg:px-1.5 sg:py-px sg:font-mono sg:text-2xs sg:text-foreground"
          >
            {draft.key}
          </code>
        ) : (
          <span className="sg:text-faint-foreground">generated from the name</span>
        )}
        {editing ? (
          <Tooltip content="Keys can't change: formulas and stored data depend on them">
            <button
              type="button"
              aria-label="Key is locked"
              className="sg:inline-flex sg:cursor-default sg:rounded-xs sg:outline-none sg:focus-visible:ring-[3px] sg:focus-visible:ring-ring"
            >
              <Lock aria-hidden className="sg:size-3" />
            </button>
          </Tooltip>
        ) : (
          <button
            type="button"
            aria-expanded={showKeyInput}
            aria-controls={keyPanelId}
            onClick={() => setKeyOpen((o) => !o)}
            className={cn(
              "sg:ml-auto sg:inline-flex sg:shrink-0 sg:items-center sg:gap-0.5 sg:rounded-xs sg:text-xs sg:text-muted-foreground sg:outline-none",
              "sg:hover:text-foreground sg:focus-visible:ring-[3px] sg:focus-visible:ring-ring",
            )}
          >
            <ChevronRight aria-hidden className={cn("sg:size-3 sg:transition-transform sg:duration-150", showKeyInput && "sg:rotate-90")} />
            Edit key
          </button>
        )}
      </div>

      {showKeyInput ? (
        <div id={keyPanelId}>
          <Field label="Key" error={errors.key} description="Used in formulas as {key}. Lowercase letters, digits and _.">
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                aria-invalid={invalid || undefined}
                spellCheck={false}
                value={draft.key}
                className="sg:font-mono sg:text-xs"
                onChange={(e) => dispatch({ type: "setKey", key: e.currentTarget.value })}
                onBlur={() => onFieldBlur?.("key")}
              />
            )}
          </Field>
        </div>
      ) : null}
    </div>
  );
}

function SwitchRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange(v: boolean): void;
}) {
  const id = useId();
  const helpId = `${id}-help`;
  return (
    <div className="sg:flex sg:items-start sg:justify-between sg:gap-4">
      <div className="sg:flex sg:flex-col sg:gap-0.5">
        <Label htmlFor={id}>{label}</Label>
        {description ? (
          <p id={helpId} className="sg:text-xs sg:text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      <Switch id={id} aria-describedby={description ? helpId : undefined} checked={checked} onCheckedChange={onChange} className="sg:mt-0.5" />
    </div>
  );
}

/** Required, default value (the type's own editor in form mode) and indexed. */
export function ColumnOptionsFields({ draft, dispatch, uiRegistry, dataSource }: Pick<CommonFieldsProps, "draft" | "dispatch" | "uiRegistry" | "dataSource">) {
  const defaultLabelId = useId();
  const isFormula = draft.type === "formula";
  const DefaultEditor = draft.type && !isFormula ? resolveEditorComponent(uiRegistry.get(draft.type).editor) : undefined;
  const column = draftAsColumn(draft);

  return (
    <div className="sg:flex sg:flex-col sg:gap-4">
      {!isFormula ? (
        <SwitchRow
          label="Required"
          description="Rows can't be saved without a value"
          checked={draft.required}
          onChange={(required) => dispatch({ type: "setRequired", required })}
        />
      ) : null}
      {DefaultEditor ? (
        <div className="sg:flex sg:flex-col sg:gap-1.5">
          <span id={defaultLabelId} className="sg:text-sm sg:font-medium sg:text-foreground">
            Default value
          </span>
          {/* biome-ignore lint/a11y/useSemanticElements: wraps an arbitrary editor widget */}
          <div role="group" aria-labelledby={defaultLabelId}>
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
          </div>
          <p className="sg:text-xs sg:text-muted-foreground">Pre-filled for new rows</p>
        </div>
      ) : null}
      <SwitchRow
        label="Indexed"
        description="Speeds up filtering and sorting on large tables"
        checked={draft.indexed}
        onChange={(indexed) => dispatch({ type: "setIndexed", indexed })}
      />
    </div>
  );
}

/** Name + key, then required / default value / indexed. */
export function CommonFields({ draft, dispatch, uiRegistry, errors = {}, dataSource, onFieldBlur, autoFocus }: CommonFieldsProps) {
  return (
    <div className={cn(SG_ROOT, "sg:flex sg:flex-col sg:gap-5")}>
      <NameField draft={draft} dispatch={dispatch} errors={errors} onFieldBlur={onFieldBlur} autoFocus={autoFocus} />
      <ColumnOptionsFields draft={draft} dispatch={dispatch} uiRegistry={uiRegistry} dataSource={dataSource} />
    </div>
  );
}
