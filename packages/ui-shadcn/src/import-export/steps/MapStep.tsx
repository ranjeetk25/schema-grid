import { ArrowRightIcon, SparklesIcon } from "lucide-react";
import type { ColumnDef } from "../../internal/core-contracts";
import type { ColumnMapping, ImportMode } from "../../internal/io-contracts";
import { cn } from "../../lib/cn";
import { Field } from "../../ui/field";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "../../ui/select";
import { Tooltip } from "../../ui/tooltip";
import type { MappingErrors } from "../import-model";
import { ChoiceGroup } from "../parts";

const SKIP = "__skip__";

const MODE_OPTIONS: { label: string; value: ImportMode }[] = [
  { label: "Create", value: "create" },
  { label: "Update", value: "update" },
  { label: "Upsert", value: "upsert" },
];

const MODE_HELP: Record<ImportMode, string> = {
  create: "Every file row becomes a new record.",
  update: "Existing records are matched on the key column and updated; unmatched rows are rejected.",
  upsert: "Matching records are updated; the rest are added as new records.",
};

export interface MapStepProps {
  headers: string[];
  mapping: ColumnMapping[];
  targets: ColumnDef[];
  /** Id of a read-only key column offered only to match existing rows. */
  matchOnlyColumnId?: string | null;
  keyColumns: ColumnDef[];
  keyColumnId: string | null;
  mode: ImportMode;
  errors: MappingErrors;
  /** First data row, for a sample value under each file column. */
  sampleRow?: string[];
  onMappingChange(headerIndex: number, columnId: string | null): void;
  onKeyColumnChange(columnId: string | null): void;
  onModeChange(mode: ImportMode): void;
}

const headerLabel = (header: string, index: number) => (header.trim() === "" ? `column ${index + 1}` : header);

export function MapStep({
  headers,
  mapping,
  targets,
  matchOnlyColumnId = null,
  keyColumns,
  keyColumnId,
  mode,
  errors,
  sampleRow,
  onMappingChange,
  onKeyColumnChange,
  onModeChange,
}: MapStepProps) {
  const mappedCount = mapping.filter((m) => m.columnId != null).length;

  return (
    <div className="sg:flex sg:flex-col sg:gap-5">
      <div className="sg:grid sg:gap-4 sg:sm:grid-cols-2">
        <div className="sg:flex sg:flex-col sg:gap-1.5">
          <span aria-hidden className="sg:text-sm sg:font-medium">
            Import mode
          </span>
          <ChoiceGroup label="Import mode" value={mode} options={MODE_OPTIONS} onChange={onModeChange} className="sg:self-start" />
          <p className="sg:m-0 sg:text-xs sg:text-muted-foreground">{MODE_HELP[mode]}</p>
        </div>
        {mode !== "create" ? (
          <Field label="Key column" description="Existing rows are matched on this column" error={errors.keyColumn ?? undefined}>
            {({ id, describedBy, invalid }) => (
              <Select value={keyColumnId ?? ""} onValueChange={(v) => onKeyColumnChange(v === "" ? null : v)}>
                <SelectTrigger id={id} aria-describedby={describedBy} aria-invalid={invalid || undefined}>
                  <SelectValue placeholder="Choose a column" />
                </SelectTrigger>
                <SelectContent>
                  {keyColumns.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
        ) : null}
      </div>

      <div className="sg:overflow-hidden sg:rounded-lg sg:border sg:border-border">
        <table className="sg:w-full sg:border-collapse sg:text-sm">
          <thead className="sg:bg-subtle">
            <tr className="sg:border-b sg:border-border">
              <th scope="col" className="sg:h-9 sg:px-4 sg:text-left sg:text-xs sg:font-medium sg:text-muted-foreground">
                File column
              </th>
              <th scope="col" className="sg:w-8">
                <span className="sg:sr-only">maps to</span>
              </th>
              <th scope="col" className="sg:h-9 sg:px-4 sg:text-left sg:text-xs sg:font-medium sg:text-muted-foreground">
                <span className="sg:flex sg:items-center sg:justify-between sg:gap-2">
                  Imports into
                  <span className="sg:font-normal sg:tabular-nums sg:text-faint-foreground">{`${mappedCount} of ${headers.length} mapped`}</span>
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {headers.map((header, index) => {
              const entry = mapping.find((m) => m.headerIndex === index);
              const value = entry?.columnId ?? SKIP;
              const auto = entry?.columnId != null && entry.confidence > 0 && entry.confidence < 1;
              const error = errors.byIndex[index];
              const errorId = `sg-import-map-error-${index}`;
              const blank = header.trim() === "";
              const sample = sampleRow?.[index]?.trim();
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: headers may repeat; the position is the identity
                <tr key={index} className="sg:border-b sg:border-border sg:last:border-b-0">
                  <td className="sg:px-4 sg:py-2.5 sg:align-top">
                    <div className="sg:flex sg:min-w-0 sg:flex-col sg:gap-0.5 sg:pt-1">
                      <span className={cn("sg:truncate sg:font-medium", blank ? "sg:text-faint-foreground sg:italic" : "sg:text-foreground")}>
                        {blank ? `(blank, column ${index + 1})` : header}
                      </span>
                      {sample ? <span className="sg:truncate sg:text-xs sg:text-muted-foreground">{`e.g. ${sample}`}</span> : null}
                    </div>
                  </td>
                  <td className="sg:py-2.5 sg:align-top">
                    <ArrowRightIcon aria-hidden className="sg:mt-2 sg:size-3.5 sg:text-faint-foreground" />
                  </td>
                  <td className="sg:px-4 sg:py-2.5 sg:align-top">
                    <div className="sg:flex sg:flex-col sg:gap-1">
                      <div className="sg:flex sg:items-center sg:gap-2">
                        <Select value={value} onValueChange={(v) => onMappingChange(index, v === SKIP ? null : v)}>
                          <SelectTrigger
                            aria-label={`Map ${headerLabel(header, index)}`}
                            aria-invalid={error ? true : undefined}
                            aria-describedby={error ? errorId : undefined}
                            className={cn("sg:min-w-0 sg:flex-1", value === SKIP && "sg:text-muted-foreground")}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={SKIP}>Skip</SelectItem>
                            {targets.length > 0 ? <SelectSeparator /> : null}
                            {targets.map((c) => (
                              <SelectItem key={c.id} value={c.id}>
                                {c.id === matchOnlyColumnId ? `${c.label} (key, match only)` : c.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {auto ? (
                          <Tooltip content="Matched automatically from the header">
                            <span
                              // biome-ignore lint/a11y/noNoninteractiveTabindex: focusable so keyboard users can reach the tooltip
                              tabIndex={0}
                              className="sg:inline-flex sg:h-5 sg:shrink-0 sg:items-center sg:gap-1 sg:rounded-sm sg:bg-muted sg:px-1.5 sg:text-2xs sg:font-medium sg:text-muted-foreground sg:outline-none sg:focus-visible:ring-[3px] sg:focus-visible:ring-ring"
                            >
                              <SparklesIcon aria-hidden className="sg:size-3" />
                              Auto
                            </span>
                          </Tooltip>
                        ) : null}
                      </div>
                      {error ? (
                        <p id={errorId} className="sg:m-0 sg:text-xs sg:text-danger">
                          {error}
                        </p>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {errors.general ? <p className="sg:m-0 sg:text-sm sg:text-danger">{errors.general}</p> : null}
    </div>
  );
}
