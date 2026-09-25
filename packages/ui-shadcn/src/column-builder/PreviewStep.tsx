import { useEffect, useId, useState } from "react";
import type { FieldTypeId, FieldTypeRegistry } from "../internal/core-contracts";
import { type UiFieldTypeRegistry, resolveEditorComponent, resolveRendererWidget } from "../internal/grid-contracts";
import { getSelectOptions } from "../internal/options";
import { SG_ROOT, cn } from "../lib/cn";
import { draftAsColumn } from "./CommonFields";
import type { ColumnDraft } from "./model";

export interface PreviewStepProps {
  draft: ColumnDraft;
  registry: FieldTypeRegistry;
  uiRegistry: UiFieldTypeRegistry;
}

const isBlank = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

/** The type's default value when it is meaningful, else a representative sample. */
export function sampleValueFor(type: FieldTypeId, config: unknown, registry: FieldTypeRegistry): unknown {
  const options = getSelectOptions(config).map((o) => o.id);
  switch (type) {
    case "select":
    case "creatableSelect":
      return options[0] ?? null;
    case "multiSelect":
      return options.slice(0, 2);
    case "boolean":
      return true;
    case "number":
      return 42;
    case "currency":
      return 123456;
    case "text":
      return "Sample text";
    case "longText":
      return "A longer sample\nspanning two lines";
    case "date":
      return "2026-01-15";
    case "datetime":
      return "2026-01-15T09:30:00.000Z";
    case "url":
      return "https://example.com";
    case "email":
      return "name@example.com";
    case "phone":
      return "+91 98765 43210";
    case "user":
      return { id: "u_sample", name: "Asha Rao" };
    case "link":
      return [{ id: "r_sample", label: "Record 1" }];
    default: {
      const fieldType = registry.get(type);
      const d = fieldType?.defaultValue(fieldType.configSchema.safeParse(config).data ?? fieldType.defaultConfig);
      return isBlank(d) ? null : d;
    }
  }
}

/** Live preview: the type's renderer showing a sample, and its inline editor bound to it. */
export function PreviewStep({ draft, registry, uiRegistry }: PreviewStepProps) {
  const editorLabelId = useId();
  const type = draft.type ?? "text";
  const [value, setValue] = useState<unknown>(() => sampleValueFor(type, draft.config, registry));
  useEffect(() => {
    setValue(sampleValueFor(type, draft.config, registry));
  }, [type, draft.config, registry]);

  const column = draftAsColumn(draft);
  const entry = uiRegistry.get(type);
  const Editor = resolveEditorComponent(entry.editor);
  const Renderer = resolveRendererWidget(entry.renderer);
  const fieldType = registry.get(type);

  return (
    <div className={cn(SG_ROOT, "sg:flex sg:flex-col sg:gap-5")}>
      <div className="sg:overflow-hidden sg:rounded-lg sg:border sg:border-border">
        <div className="sg:flex sg:h-9 sg:items-center sg:border-b sg:border-border sg:bg-subtle sg:px-3 sg:text-sm sg:font-medium sg:text-foreground">
          <span className="sg:truncate">{draft.label.trim() || "Untitled"}</span>
        </div>
        <div data-testid="preview-cell" className="sg:flex sg:min-h-9 sg:items-center sg:gap-2 sg:px-3 sg:text-sm">
          {Renderer ? (
            <Renderer value={value} column={column} config={draft.config} fieldType={type} />
          ) : (
            <span>{fieldType ? fieldType.format(value, draft.config) : String(value ?? "")}</span>
          )}
        </div>
      </div>
      {type === "formula" ? (
        <p className="sg:text-sm sg:text-muted-foreground">Formula columns are computed from other columns and cannot be edited.</p>
      ) : Editor ? (
        <div className="sg:flex sg:flex-col sg:gap-1.5">
          <span id={editorLabelId} className="sg:text-sm sg:font-medium sg:text-foreground">
            Try the editor
          </span>
          {/* biome-ignore lint/a11y/useSemanticElements: wraps an arbitrary editor widget */}
          <div role="group" aria-labelledby={editorLabelId}>
            <Editor
              value={value}
              onChange={setValue}
              onCommit={(v) => {
                if (v !== undefined) setValue(v);
              }}
              onCancel={() => {}}
              column={column}
              config={draft.config}
              autoFocus={false}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
