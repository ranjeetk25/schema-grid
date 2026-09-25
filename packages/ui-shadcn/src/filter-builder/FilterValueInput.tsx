import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import {
  type ColumnDef,
  type DataSource,
  type FieldTypeId,
  type FilterOperatorDef,
  type FilterPrimitive,
  type FilterValue,
  type GridSchema,
  RELATIVE_DATE_PRESETS,
  type RelativeDate,
  type RelativeDateKind,
  resolveFormulaOperandTypeId,
} from "../internal/core-contracts";
import { type UiFieldTypeRegistry, filterInputFor } from "../internal/grid-contracts";
import { getSelectOptions, optionToneStyle } from "../internal/options";
import { cn } from "../lib/cn";
import { Input } from "../ui/input";
import { ErrorText, MultiPicker, NumberField, type PickerItem, SelectField, TagsInput, ToneDot } from "./pickers";

export interface FilterValueInputProps {
  column: ColumnDef;
  operator: FilterOperatorDef;
  value: FilterValue | null | undefined;
  onChange(value: FilterValue | null | undefined): void;
  /** ag-grid UI registry; its ui-shadcn editor widgets render `single`/range values for non-option types. */
  registry: UiFieldTypeRegistry;
  dataSource?: DataSource;
  /** @deprecated Unused: formula columns resolve through `config.resultType`. */
  schema?: GridSchema;
  error?: string;
}

/** Picker labels per relative-date kind (core `RELATIVE_DATE_PRESETS`). */
export const RELATIVE_DATE_LABELS: Record<RelativeDateKind, string> = Object.fromEntries(
  RELATIVE_DATE_PRESETS.map((p) => [p.kind, p.label]),
) as Record<RelativeDateKind, string>;

const RELATIVE_ITEMS: PickerItem[] = RELATIVE_DATE_PRESETS.map((p) => ({ value: p.kind as string, label: p.label }));
const N_PRESETS: readonly RelativeDateKind[] = RELATIVE_DATE_PRESETS.filter((p) => p.needsN).map((p) => p.kind);

const OPTION_TYPES = new Set<FieldTypeId>(["select", "creatableSelect", "multiSelect"]);
const NUMERIC_TYPES = new Set<FieldTypeId>(["number", "currency"]);
const DATE_TYPES = new Set<FieldTypeId>(["date", "datetime"]);

/** The type a filter value is typed as: formula columns resolve through `config.resultType` (as core does). */
export function effectiveFilterType(column: ColumnDef): FieldTypeId {
  if (column.type !== "formula") return column.type;
  const rt = (column.config as { resultType?: unknown } | null)?.resultType;
  return resolveFormulaOperandTypeId(typeof rt === "string" ? rt : undefined);
}

const asPrimitive = (v: unknown): FilterPrimitive =>
  typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? v : null;

const asRange = (v: unknown): { from: FilterPrimitive; to: FilterPrimitive } =>
  v && typeof v === "object" && "from" in v && "to" in v
    ? { from: asPrimitive((v as { from: unknown }).from), to: asPrimitive((v as { to: unknown }).to) }
    : { from: null, to: null };

const asRelative = (v: unknown): RelativeDate | null =>
  v && typeof v === "object" && "relative" in v ? (v as RelativeDate) : null;

const isMeValue = (v: unknown) => !!v && typeof v === "object" && (v as { me?: unknown }).me === true;

const optionItems = (column: ColumnDef): PickerItem[] =>
  getSelectOptions(column.config).map((o) => ({ value: o.id, label: o.label, icon: <ToneDot style={optionToneStyle(o)} /> }));

function MeInput({ value, onChange }: { value: unknown; onChange: (v: FilterValue) => void }) {
  const emitted = useRef(false);
  const already = isMeValue(value);
  useEffect(() => {
    if (!already && !emitted.current) {
      emitted.current = true;
      onChange({ me: true });
    }
  }, [already, onChange]);
  return <span className="sg:flex sg:h-8 sg:items-center sg:px-1 sg:text-sm sg:text-muted-foreground">Current user</span>;
}

function useUserOptions(enabled: boolean, column: ColumnDef, dataSource?: DataSource) {
  const [options, setOptions] = useState<PickerItem[]>([]);
  useEffect(() => {
    if (!enabled || !dataSource?.getOptions) return;
    let alive = true;
    dataSource.getOptions(column.id).then(
      (opts) => {
        if (alive) setOptions(opts.map((o) => ({ value: o.id, label: o.label })));
      },
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [enabled, column.id, dataSource]);
  return options;
}

/** Control + inline error stacked; the error is wired through `aria-describedby`. */
function Stack({ children, error, errorId }: { children: ReactNode; error?: string; errorId: string }) {
  return (
    <div className="sg:flex sg:min-w-0 sg:flex-col sg:gap-1">
      {children}
      <ErrorText id={errorId} error={error} />
    </div>
  );
}

/**
 * The value editor of one filter condition, chosen by `operator.valueKind`.
 * Dropdowns portal to <body> carrying `sg-ui ag-custom-component-popup`, and
 * are Radix layers nested in the React tree of any enclosing popover, so
 * picking an option never counts as an outside click.
 */
export function FilterValueInput(props: FilterValueInputProps) {
  const { column, operator, value, onChange, registry, dataSource, error } = props;
  const type = effectiveFilterType(column);
  const isOptionType = OPTION_TYPES.has(type);
  const userOptions = useUserOptions(operator.valueKind === "multi" && type === "user", column, dataSource);
  const errorId = useId();
  const invalid = Boolean(error);
  const describedBy = error ? errorId : undefined;

  const registryInput = (v: FilterValue | null | undefined, emit: (v: FilterValue | null) => void): ReactNode => {
    const Filter = filterInputFor(registry, type);
    return Filter ? <Filter column={column} operator={operator} value={v} onChange={emit} dataSource={dataSource} /> : null;
  };

  switch (operator.valueKind) {
    case "none":
      return null;

    case "me":
      return <MeInput value={value} onChange={onChange} />;

    case "single": {
      if (type === "select" || type === "creatableSelect") {
        return (
          <Stack error={error} errorId={errorId}>
            <SelectField
              aria-label="Value"
              placeholder="Select a value"
              items={optionItems(column)}
              value={typeof value === "string" ? value : null}
              onChange={(v) => onChange(v)}
              invalid={invalid}
              describedBy={describedBy}
            />
          </Stack>
        );
      }
      const custom = registryInput(value, onChange);
      if (custom) {
        return (
          <Stack error={error} errorId={errorId}>
            {custom}
          </Stack>
        );
      }
      if (NUMERIC_TYPES.has(type)) {
        return (
          <Stack error={error} errorId={errorId}>
            <NumberField
              aria-label="Value"
              placeholder="Enter a number"
              value={typeof value === "number" ? value : null}
              onChange={(n) => onChange(n)}
              invalid={invalid}
              describedBy={describedBy}
            />
          </Stack>
        );
      }
      return (
        <Stack error={error} errorId={errorId}>
          <Input
            aria-label="Value"
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            placeholder={DATE_TYPES.has(type) ? "YYYY-MM-DD" : "Enter a value"}
            value={value == null ? "" : String(asPrimitive(value) ?? "")}
            onChange={(e) => onChange(e.currentTarget.value)}
          />
        </Stack>
      );
    }

    case "multi": {
      const current = Array.isArray(value) ? value.map((v) => String(v)) : [];
      if (isOptionType || type === "user") {
        return (
          <Stack error={error} errorId={errorId}>
            <MultiPicker
              aria-label="Values"
              placeholder="Select values"
              items={type === "user" ? userOptions : optionItems(column)}
              value={current}
              onChange={(v) => onChange(v)}
              invalid={invalid}
              describedBy={describedBy}
            />
          </Stack>
        );
      }
      return (
        <Stack error={error} errorId={errorId}>
          <TagsInput
            aria-label="Values"
            placeholder="Type and press Enter"
            value={current}
            onChange={(v) => onChange(v)}
            invalid={invalid}
            describedBy={describedBy}
          />
        </Stack>
      );
    }

    case "range": {
      const range = asRange(value);
      const isDate = DATE_TYPES.has(type);
      const emit = (part: "from" | "to", v: FilterPrimitive) =>
        onChange(part === "from" ? { from: v, to: range.to } : { from: range.from, to: v });
      const side = (part: "from" | "to", label: string): ReactNode => {
        const v = range[part];
        if (NUMERIC_TYPES.has(type)) {
          return (
            <NumberField
              aria-label={label}
              placeholder={label}
              value={typeof v === "number" ? v : null}
              onChange={(n) => emit(part, n)}
              invalid={invalid}
              className="sg:min-w-0 sg:flex-1"
            />
          );
        }
        if (isDate) {
          const custom = registryInput(v, (next) => emit(part, asPrimitive(next)));
          if (custom) {
            return (
              // biome-ignore lint/a11y/useSemanticElements: a labelled group around a third-party widget
              <div role="group" aria-label={label} className="sg:min-w-0 sg:flex-1">
                {custom}
              </div>
            );
          }
        }
        return (
          <Input
            aria-label={label}
            aria-invalid={invalid || undefined}
            placeholder={isDate ? "YYYY-MM-DD" : label}
            value={v == null ? "" : String(v)}
            onChange={(e) => emit(part, e.currentTarget.value === "" ? null : e.currentTarget.value)}
            className="sg:min-w-0 sg:flex-1"
          />
        );
      };
      return (
        <Stack error={error} errorId={errorId}>
          <div className="sg:flex sg:min-w-0 sg:items-center sg:gap-1.5">
            {side("from", "From")}
            <span aria-hidden className="sg:shrink-0 sg:text-xs sg:text-muted-foreground">
              and
            </span>
            {side("to", "To")}
          </div>
        </Stack>
      );
    }

    case "relativeDate": {
      const rd = asRelative(value);
      const preset = rd?.relative ?? null;
      const needsN = preset !== null && N_PRESETS.includes(preset);
      return (
        <Stack error={error} errorId={errorId}>
          <div className="sg:flex sg:min-w-0 sg:items-center sg:gap-1.5">
            <SelectField
              aria-label="Relative date"
              placeholder="Pick a range"
              items={RELATIVE_ITEMS}
              value={preset}
              invalid={invalid}
              describedBy={describedBy}
              className={cn("sg:min-w-0", needsN ? "sg:flex-1" : "sg:w-full")}
              onChange={(p) => {
                const nextPreset = p as RelativeDateKind;
                const keepN = N_PRESETS.includes(nextPreset) && typeof rd?.n === "number";
                onChange(keepN ? { relative: nextPreset, n: rd?.n as number } : { relative: nextPreset });
              }}
            />
            {needsN && preset ? (
              <NumberField
                aria-label="N"
                placeholder="N"
                integer
                min={1}
                value={typeof rd?.n === "number" ? rd.n : null}
                onChange={(n) => onChange(n === null ? { relative: preset } : { relative: preset, n })}
                className="sg:w-16 sg:shrink-0"
              />
            ) : null}
          </div>
        </Stack>
      );
    }
  }
}
