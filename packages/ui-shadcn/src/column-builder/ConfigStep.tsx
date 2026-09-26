import { Lightbulb } from "lucide-react";
import { type Dispatch, useMemo } from "react";
import type { AccessMap } from "../internal/access";
import type { DataSource, FieldTypeRegistry, GridRow, GridSchema } from "../internal/core-contracts";
import type { UiFieldTypeRegistry } from "../internal/grid-contracts";
import { SG_ROOT, cn } from "../lib/cn";
import { CommonFields } from "./CommonFields";
import { FormulaEditor } from "./FormulaEditor";
import type { ColumnDraft, ColumnDraftAction, ColumnDraftErrors } from "./model";
import { fieldTypeMeta } from "./type-meta";
import { ZodForm } from "./zod-form/ZodForm";
import { introspectZod } from "./zod-form/introspect";

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
  /** Rows for the formula live preview. */
  sampleRows?: GridRow[];
  /** Roles for option lists' "Who can set" control (v0.3). */
  roles?: string[];
}

/** Sample inputs for the live format preview of number-like and date types. */
const FORMAT_SAMPLES: Record<string, unknown> = {
  number: 1234567.891,
  currency: 1234567.891,
  date: "2026-01-15",
  datetime: "2026-01-15T09:30:00.000Z",
};

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** `fieldType.format(sample, config)` for types with a meaningful format, or null. */
export function formatPreview(draft: ColumnDraft, registry: FieldTypeRegistry): string | null {
  if (!draft.type || !(draft.type in FORMAT_SAMPLES)) return null;
  const fieldType = registry.get(draft.type);
  if (!fieldType) return null;
  const merged = { ...asRecord(fieldType.defaultConfig), ...draft.config };
  const parsed = fieldType.configSchema.safeParse(merged);
  if (!parsed.success) return null;
  try {
    const out = fieldType.format(FORMAT_SAMPLES[draft.type], parsed.data);
    return out || null;
  } catch {
    return null;
  }
}

export interface TypeConfigFieldsProps extends Omit<ConfigStepProps, "uiRegistry" | "dataSource"> {
  /** Show the muted "what this type is for" hint (default true). */
  showHint?: boolean;
  portalled?: boolean;
}

/** The type-specific settings: formula editor, or the type's `configSchema` form + a live format preview. */
export function TypeConfigFields({
  draft,
  dispatch,
  schema,
  registry,
  access,
  errors,
  onFormulaValidityChange,
  sampleRows,
  roles,
  showHint = true,
  portalled,
}: TypeConfigFieldsProps) {
  const fieldType = draft.type ? registry.get(draft.type) : undefined;
  const hasSettings = useMemo(() => {
    if (!fieldType) return false;
    const d = introspectZod(fieldType.configSchema);
    return d.kind !== "object" || d.children.length > 0;
  }, [fieldType]);
  if (!draft.type || !fieldType) return null;

  const meta = fieldTypeMeta(draft.type, fieldType);
  const preview = formatPreview(draft, registry);

  return (
    <div className="sg:flex sg:flex-col sg:gap-4">
      {showHint ? (
        <div className="sg:flex sg:gap-2 sg:rounded-md sg:bg-subtle sg:px-3 sg:py-2.5 sg:text-xs sg:text-muted-foreground">
          <Lightbulb aria-hidden className="sg:mt-px sg:size-3.5 sg:shrink-0 sg:text-faint-foreground" />
          <p>
            {meta.hint}
            {meta.example ? (
              <>
                {" "}
                <span className="sg:text-faint-foreground">e.g.</span> <span className="sg:text-foreground">{meta.example}</span>
              </>
            ) : null}
          </p>
        </div>
      ) : null}

      {draft.type === "formula" ? (
        <FormulaEditor
          schema={schema}
          access={access}
          value={draft.formula}
          onChange={(formula) => dispatch({ type: "setFormula", formula })}
          selfKey={draft.key || undefined}
          onValidityChange={onFormulaValidityChange}
          sampleRows={sampleRows}
          portalled={portalled}
        />
      ) : hasSettings ? (
        <ZodForm
          schema={fieldType.configSchema}
          value={draft.config}
          onChange={(config) => dispatch({ type: "setConfig", config })}
          {...(roles ? { roles } : {})}
        />
      ) : null}

      {preview ? (
        <div className="sg:flex sg:items-baseline sg:justify-between sg:gap-3 sg:border-t sg:border-border sg:pt-3 sg:text-xs">
          <span className="sg:text-muted-foreground">Looks like</span>
          <output aria-label="Format preview" className="sg:text-sm sg:font-medium sg:text-foreground sg:tabular-nums">
            {preview}
          </output>
        </div>
      ) : null}

      {errors.config ? (
        <p role="alert" className="sg:text-xs sg:text-danger">
          {errors.config}
        </p>
      ) : null}
    </div>
  );
}

/** Common fields, then the type's settings (formula editor or config form), with a guidance column. */
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
  sampleRows,
  roles,
}: ConfigStepProps) {
  return (
    <div className={cn(SG_ROOT, "sg:flex sg:flex-col sg:gap-6")}>
      <CommonFields draft={draft} dispatch={dispatch} uiRegistry={uiRegistry} errors={errors} dataSource={dataSource} />
      <div className="sg:border-t sg:border-border sg:pt-5">
        <TypeConfigFields
          draft={draft}
          dispatch={dispatch}
          schema={schema}
          registry={registry}
          access={access}
          errors={errors}
          onFormulaValidityChange={onFormulaValidityChange}
          sampleRows={sampleRows}
          {...(roles ? { roles } : {})}
        />
      </div>
    </div>
  );
}
