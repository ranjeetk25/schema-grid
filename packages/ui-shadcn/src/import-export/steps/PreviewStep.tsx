import { TriangleAlertIcon } from "lucide-react";
import type { ColumnDef } from "../../internal/core-contracts";
import type { ColumnMapping, ParsedTable, UnknownOptionsPolicy, ValidationReport } from "../../internal/io-contracts";
import { cn } from "../../lib/cn";
import { Tooltip } from "../../ui/tooltip";
import { summarizePreview } from "../import-model";
import { ChoiceGroup, InlineAlert, Spinner } from "../parts";

const POLICY_OPTIONS: { label: string; value: UnknownOptionsPolicy }[] = [
  { label: "Create options", value: "create" },
  { label: "Reject rows", value: "reject" },
];

const POLICY_HELP: Record<UnknownOptionsPolicy, string> = {
  create: "New values are added to the column's options when the import runs.",
  reject: "Rows with a value that is not an existing option are skipped.",
};

export interface PreviewStepProps {
  parsed: ParsedTable;
  mapping: ColumnMapping[];
  /** Columns the mapping may point at (labels for the table header). */
  columns: ColumnDef[];
  preview: ValidationReport | null;
  loading: boolean;
  error: string | null;
  unknownOptions: UnknownOptionsPolicy;
  onPolicyChange(policy: UnknownOptionsPolicy): void;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function StatTile({ value, label, sentence, tone }: { value: number; label: string; sentence: string; tone: "success" | "danger" | "warning" | "neutral" }) {
  return (
    <div className="sg:flex sg:flex-col sg:gap-1 sg:rounded-lg sg:bg-subtle sg:px-4 sg:py-3">
      <span className="sg:sr-only">{sentence}</span>
      <span aria-hidden className="sg:flex sg:items-center sg:gap-1.5 sg:text-xs sg:text-muted-foreground">
        <span
          className={cn(
            "sg:size-1.5 sg:rounded-full",
            tone === "success" && "sg:bg-success",
            tone === "danger" && "sg:bg-danger",
            tone === "warning" && "sg:bg-warning",
            tone === "neutral" && "sg:bg-faint-foreground",
          )}
        />
        {label}
      </span>
      <span
        aria-hidden
        className={cn(
          "sg:text-xl sg:leading-7 sg:font-semibold sg:tracking-[-0.01em] sg:tabular-nums",
          tone === "danger" ? "sg:text-danger" : "sg:text-foreground",
        )}
      >
        {value.toLocaleString()}
      </span>
    </div>
  );
}

const cellBase = "sg:h-9 sg:max-w-60 sg:truncate sg:border-b sg:border-border sg:px-3 sg:text-left sg:whitespace-nowrap";

export function PreviewStep({ parsed, mapping, columns, preview, loading, error, unknownOptions, onPolicyChange }: PreviewStepProps) {
  if (loading && !preview) {
    return (
      <output className="sg:flex sg:items-center sg:justify-center sg:gap-2 sg:py-16 sg:text-sm sg:text-muted-foreground">
        <Spinner />
        Validating rows…
      </output>
    );
  }
  if (error) return <InlineAlert title="Preview failed">{error}</InlineAlert>;
  if (!preview) return null;

  const byId = new Map(columns.map((c) => [c.id, c]));
  const mapped = mapping.filter((m): m is ColumnMapping & { columnId: string } => m.columnId != null);
  const summary = summarizePreview(preview);
  const showPolicy = summary.unknownOptions > 0 || unknownOptions === "reject";
  const unmappedRequired = preview.summary.unmappedRequired.map((id) => byId.get(id)?.label ?? id);

  const body = preview.rows.map((row) => (
    <tr key={row.index} className="sg:hover:bg-subtle">
      {row.rowError ? (
        <td data-row-error="true" className={cn(cellBase, "sg:max-w-none sg:bg-danger-subtle sg:py-1.5 sg:whitespace-normal")}>
          <span className="sg:block sg:tabular-nums sg:text-muted-foreground">{row.sourceRow}</span>
          <span className="sg:block sg:text-xs sg:text-danger">{row.rowError}</span>
        </td>
      ) : (
        <td className={cn(cellBase, "sg:tabular-nums sg:text-faint-foreground")}>{row.sourceRow}</td>
      )}
      {mapped.map((m) => {
        const cell = row.cells[m.columnId];
        const raw = cell?.raw ?? parsed.rows[row.index]?.[m.headerIndex] ?? "";
        if (cell?.error) {
          return (
            <td key={m.headerIndex} data-row={row.index} data-column={m.columnId} data-error="true" className={cn(cellBase, "sg:bg-danger-subtle")}>
              <Tooltip content={cell.error}>
                <span
                  aria-invalid="true"
                  // biome-ignore lint/a11y/noNoninteractiveTabindex: focusable so keyboard users can reach the error tooltip
                  tabIndex={0}
                  className="sg:block sg:truncate sg:rounded-xs sg:text-danger sg:underline sg:decoration-dotted sg:underline-offset-4 sg:outline-none sg:focus-visible:ring-[3px] sg:focus-visible:ring-ring"
                >
                  {raw === "" ? " " : raw}
                </span>
              </Tooltip>
            </td>
          );
        }
        if (cell?.skip) {
          return (
            <td key={m.headerIndex} data-row={row.index} data-column={m.columnId} data-skip="true" className={cn(cellBase, "sg:text-faint-foreground sg:italic")}>
              unchanged
            </td>
          );
        }
        return (
          <td key={m.headerIndex} data-row={row.index} data-column={m.columnId} className={cn(cellBase, "sg:tabular-nums")}>
            {raw}
          </td>
        );
      })}
    </tr>
  ));

  return (
    <div className="sg:flex sg:flex-col sg:gap-5">
      <div className="sg:grid sg:grid-cols-3 sg:gap-3">
        <StatTile value={summary.valid} label="Valid rows" sentence={plural(summary.valid, "valid row")} tone="success" />
        <StatTile
          value={summary.invalid}
          label="Invalid rows"
          sentence={plural(summary.invalid, "invalid row")}
          tone={summary.invalid > 0 ? "danger" : "neutral"}
        />
        <StatTile
          value={summary.unknownOptions}
          label="Unknown options"
          sentence={plural(summary.unknownOptions, "unknown value")}
          tone={summary.unknownOptions > 0 ? "warning" : "neutral"}
        />
      </div>

      {unmappedRequired.length > 0 ? (
        <p className="sg:m-0 sg:flex sg:items-start sg:gap-2 sg:text-sm sg:text-warning">
          <TriangleAlertIcon aria-hidden className="sg:mt-0.5 sg:size-3.5 sg:shrink-0" />
          {`Required columns not in the file: ${unmappedRequired.join(", ")}`}
        </p>
      ) : null}

      {showPolicy ? (
        <div className="sg:flex sg:flex-col sg:gap-1.5">
          <span aria-hidden className="sg:text-sm sg:font-medium">
            Values that are not existing options
          </span>
          <ChoiceGroup
            label="Unknown option values"
            value={unknownOptions}
            options={POLICY_OPTIONS}
            onChange={onPolicyChange}
            disabled={loading}
            className="sg:self-start"
          />
          <p className="sg:m-0 sg:text-xs sg:text-muted-foreground">{POLICY_HELP[unknownOptions]}</p>
        </div>
      ) : null}

      <div className="sg:flex sg:flex-col sg:gap-2">
        {parsed.rows.length > preview.rows.length ? (
          <p className="sg:m-0 sg:text-xs sg:text-muted-foreground sg:tabular-nums">
            {`Previewing the first ${preview.rows.length} of ${parsed.rows.length} rows.`}
          </p>
        ) : null}
        <div
          aria-busy={loading || undefined}
          className={cn(
            "sg:max-h-80 sg:overflow-auto sg:rounded-lg sg:border sg:border-border sg:transition-opacity sg:duration-150",
            loading && "sg:opacity-60",
          )}
        >
          <table className="sg:w-full sg:border-separate sg:border-spacing-0 sg:text-sm">
            <thead>
              <tr>
                <th scope="col" className={cn(cellBase, "sg:sticky sg:top-0 sg:z-10 sg:w-14 sg:bg-subtle sg:text-xs sg:font-medium sg:text-muted-foreground")}>
                  Row
                </th>
                {mapped.map((m) => (
                  <th
                    key={m.headerIndex}
                    scope="col"
                    className={cn(cellBase, "sg:sticky sg:top-0 sg:z-10 sg:bg-subtle sg:text-xs sg:font-medium sg:text-muted-foreground")}
                  >
                    {byId.get(m.columnId)?.label ?? m.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>{body}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
