import { Braces, CircleAlert } from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { type AccessMap, readableColumns } from "../internal/access";
import {
  type ColumnDef,
  DEFAULT_TIME_ZONE,
  type FormulaNode,
  type FormulaResultType,
  type FormulaValue,
  type GridRow,
  type GridSchema,
  dependencies,
  evaluate,
  inferResultType,
  isFormulaError,
  parseFormula,
} from "../internal/core-contracts";
import { SG_ROOT, cn } from "../lib/cn";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "../ui/command";
import { Label } from "../ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Textarea } from "../ui/textarea";
import { formulaFunctionDocs } from "./formula-docs";

export interface FormulaEditorProps {
  schema: GridSchema;
  access: AccessMap;
  value: string;
  onChange(value: string): void;
  /** Key of the column being edited: excluded from autocomplete, and a self reference is an error. */
  selfKey?: string;
  onValidityChange?(valid: boolean): void;
  label?: string;
  /** Rows to evaluate the formula on for the live preview (first 3). Hidden when absent. */
  sampleRows?: GridRow[];
  /** Render popovers in place (inside AG Grid popups). */
  portalled?: boolean;
}

export type FormulaCheck = { valid: true; resultType: FormulaResultType } | { valid: false; error: string };

/** Parse + reference checks: unknown/hidden columns, self reference, and cycles through other formulas. */
export function checkFormula(src: string, schema: GridSchema, access: AccessMap, selfKey?: string): FormulaCheck {
  const ast = parseFormula(src);
  if (isFormulaError(ast)) {
    return { valid: false, error: ast.start === undefined ? ast.message : `${ast.message} (at position ${ast.start})` };
  }
  const readable = new Map(readableColumns(schema, access).map((c) => [c.key, c]));
  for (const key of dependencies(ast)) {
    if (selfKey && key === selfKey) return { valid: false, error: "A formula cannot reference itself" };
    if (!readable.has(key)) return { valid: false, error: `Unknown column "${key}"` };
  }
  if (selfKey && reaches(ast, selfKey, schema, new Set())) {
    return { valid: false, error: "Circular reference through another formula column" };
  }
  const resultType = inferResultType(ast, schema);
  if (isFormulaError(resultType)) {
    return {
      valid: false,
      error: resultType.start === undefined ? resultType.message : `${resultType.message} (at position ${resultType.start})`,
    };
  }
  return { valid: true, resultType };
}

function reaches(ast: FormulaNode, target: string, schema: GridSchema, seen: Set<string>): boolean {
  for (const key of dependencies(ast)) {
    if (key === target) return true;
    if (seen.has(key)) continue;
    seen.add(key);
    const col = schema.columns.find((c) => c.key === key);
    if (col?.type === "formula" && col.formula) {
      const sub = parseFormula(col.formula);
      if (!isFormulaError(sub) && reaches(sub, target, schema, seen)) return true;
    }
  }
  return false;
}

/** Text between an unclosed "{" and the caret, or null when the caret is not inside a ref. */
function openRefAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const m = /\{([^{}]*)$/.exec(before);
  return m ? { start: caret - m[0].length, query: m[1] ?? "" } : null;
}

const NUMERIC = new Set(["number", "currency"]);
const DATES = new Set(["date", "datetime"]);

/** One-click examples built from the columns this grid actually has (only ones that type-check). */
function presetExamples(columns: ColumnDef[], schema: GridSchema, access: AccessMap, selfKey?: string): string[] {
  const num = columns.find((c) => NUMERIC.has(c.type) || (c.type === "formula" && (c.config as { resultType?: string })?.resultType === "number"));
  const date = columns.find((c) => DATES.has(c.type));
  const text = columns.find((c) => c.type === "text" || c.type === "longText");
  const out: string[] = [];
  if (num) out.push(`{${num.key}} * 1.18`, `IF({${num.key}} > 1000, "High", "Low")`);
  if (date) out.push(`DATEDIFF({${date.key}}, TODAY(), "days")`);
  if (text) out.push(`UPPER({${text.key}})`);
  return out.filter((f) => checkFormula(f, schema, access, selfKey).valid);
}

function formatPreviewValue(v: FormulaValue | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number") return v.toLocaleString(undefined, { maximumFractionDigits: 4 });
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return v.map(formatCell).join(", ") || "—";
  if (typeof v === "object") {
    const o = v as { label?: unknown; name?: unknown; id?: unknown };
    return String(o.label ?? o.name ?? o.id ?? "—");
  }
  if (typeof v === "number") return v.toLocaleString();
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

const chipClasses = cn(
  "sg:inline-flex sg:h-6 sg:max-w-full sg:items-center sg:gap-1 sg:rounded-sm sg:border sg:border-border sg:bg-background sg:px-1.5 sg:text-xs sg:text-muted-foreground",
  "sg:transition-colors sg:duration-150 sg:outline-none sg:hover:border-input-hover sg:hover:text-foreground",
  "sg:focus-visible:ring-[3px] sg:focus-visible:ring-ring",
);

export function FormulaEditor({
  schema,
  access,
  value,
  onChange,
  selfKey,
  onValidityChange,
  label = "Formula",
  sampleRows,
  portalled = true,
}: FormulaEditorProps) {
  const id = useId();
  const listboxId = `${id}-refs`;
  const helpId = `${id}-help`;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [token, setToken] = useState<{ start: number; query: string; caret: number } | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [functionsOpen, setFunctionsOpen] = useState(false);
  const pendingCaret = useRef<number | null>(null);
  // Remember the caret while focus is on a chip / popover.
  const lastSelection = useRef<{ start: number; end: number }>({ start: value.length, end: value.length });
  // Errors wait until the user types, unless the formula was pre-filled (edit mode).
  const [dirty, setDirty] = useState(() => value.trim() !== "");

  const readable = useMemo(() => readableColumns(schema, access).filter((c) => c.key !== selfKey), [schema, access, selfKey]);
  const matches = token
    ? readable.filter((c) => {
        const q = token.query.trim().toLowerCase();
        return !q || c.key.toLowerCase().includes(q) || c.label.toLowerCase().includes(q);
      })
    : [];
  const listOpen = token !== null && matches.length > 0;
  const examples = useMemo(() => presetExamples(readable, schema, access, selfKey), [readable, schema, access, selfKey]);
  const functions = useMemo(() => formulaFunctionDocs(), []);

  const check = useMemo(() => (value.trim() ? checkFormula(value, schema, access, selfKey) : null), [value, schema, access, selfKey]);
  const valid = check?.valid === true;
  const error = dirty && check && !check.valid ? check.error : undefined;

  const lastValidity = useRef<boolean | null>(null);
  useEffect(() => {
    if (lastValidity.current !== valid) {
      lastValidity.current = valid;
      onValidityChange?.(valid);
    }
  }, [valid, onValidityChange]);

  useLayoutEffect(() => {
    if (pendingCaret.current !== null && textareaRef.current) {
      const caret = pendingCaret.current;
      pendingCaret.current = null;
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(caret, caret);
      lastSelection.current = { start: caret, end: caret };
    }
  });

  const syncToken = (text: string, caret: number) => {
    const ref = openRefAt(text, caret);
    setToken(ref ? { ...ref, caret } : null);
    setActiveIndex(0);
  };

  const emit = (next: string, caret: number) => {
    pendingCaret.current = caret;
    setDirty(true);
    onChange(next);
  };

  const acceptRef = (key: string) => {
    if (!token) return;
    const replacement = `{${key}}`;
    // Swallow an auto-typed "}" right after the caret.
    const after = value.slice(token.caret).replace(/^[^{}\s(),]*\}/, "");
    const next = value.slice(0, token.start) + replacement + after;
    setToken(null);
    emit(next, token.start + replacement.length);
  };

  /** Inserts text at the remembered caret; `caretOffset` places the caret inside the insertion. */
  const insertAtCaret = (text: string, caretOffset = text.length) => {
    const { start, end } = lastSelection.current;
    const s = Math.min(start, value.length);
    const e = Math.min(Math.max(end, s), value.length);
    emit(value.slice(0, s) + text + value.slice(e), s + caretOffset);
  };

  const rememberSelection = () => {
    const el = textareaRef.current;
    if (el) lastSelection.current = { start: el.selectionStart ?? value.length, end: el.selectionEnd ?? value.length };
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!listOpen) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const delta = e.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((i) => (i + delta + matches.length) % matches.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      const pick = matches[activeIndex];
      if (pick) {
        e.preventDefault();
        acceptRef(pick.key);
      }
    } else if (e.key === "Escape") {
      // Close the suggestions, not the surrounding panel/dialog.
      e.preventDefault();
      e.stopPropagation();
      setToken(null);
    }
  };

  const activeOptionId = listOpen ? `${id}-opt-${activeIndex}` : undefined;
  const preview = sampleRows?.length && valid ? sampleRows.slice(0, 3) : null;
  const ast = useMemo(() => (preview ? parseFormula(value) : null), [preview, value]);
  const refs = ast && !isFormulaError(ast) ? dependencies(ast).slice(0, 2) : [];
  const env = useMemo(() => ({ now: new Date(), tz: DEFAULT_TIME_ZONE }), []);

  return (
    <div className={cn(SG_ROOT, "sg:flex sg:flex-col sg:gap-3")}>
      <div className="sg:flex sg:flex-col sg:gap-1.5">
        <div className="sg:flex sg:items-center sg:justify-between sg:gap-2">
          <Label htmlFor={id}>{label}</Label>
          <Popover open={functionsOpen} onOpenChange={setFunctionsOpen}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="xs" onMouseDown={rememberSelection} className="sg:text-muted-foreground">
                <Braces />
                Functions
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" portalled={portalled} className="sg:w-80 sg:p-0" aria-label="Formula functions">
              <Command>
                <CommandInput placeholder="Search functions…" />
                <CommandList className="sg:max-h-64">
                  <CommandEmpty>No function matches</CommandEmpty>
                  {functions.map((fn) => (
                    <CommandItem
                      key={fn.name}
                      value={fn.name}
                      keywords={[fn.description]}
                      onSelect={() => {
                        setFunctionsOpen(false);
                        insertAtCaret(`${fn.name}()`, fn.name.length + 1);
                      }}
                      className="sg:flex-col sg:items-start sg:gap-0 sg:py-1.5"
                    >
                      <span className="sg:font-mono sg:text-xs sg:text-foreground">{fn.signature}</span>
                      {fn.description ? <span className="sg:text-xs sg:text-muted-foreground">{fn.description}</span> : null}
                    </CommandItem>
                  ))}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>

        <div className="sg:relative">
          <Textarea
            ref={textareaRef}
            id={id}
            value={value}
            rows={3}
            spellCheck={false}
            autoComplete="off"
            placeholder="{amount} * 1.18"
            aria-autocomplete="list"
            aria-controls={listOpen ? listboxId : undefined}
            aria-activedescendant={activeOptionId}
            aria-invalid={error ? true : undefined}
            aria-describedby={helpId}
            className="sg:min-h-[72px] sg:resize-y sg:font-mono sg:text-sm sg:leading-6"
            onChange={(e) => {
              const text = e.currentTarget.value;
              setDirty(true);
              onChange(text);
              syncToken(text, e.currentTarget.selectionStart ?? text.length);
            }}
            onSelect={rememberSelection}
            onClick={(e) => syncToken(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)}
            onKeyDown={onKeyDown}
            onBlur={() => {
              rememberSelection();
              setToken(null);
            }}
          />
          {listOpen ? (
            // biome-ignore lint/a11y/useFocusableInteractive: focus stays in the textarea
            <div
              id={listboxId}
              // biome-ignore lint/a11y/useSemanticElements: an ARIA listbox driven by the textarea (aria-activedescendant)
              role="listbox"
              aria-label="Columns"
              className="sg:absolute sg:top-full sg:left-0 sg:z-50 sg:mt-1 sg:max-h-56 sg:w-full sg:overflow-y-auto sg:rounded-lg sg:bg-popover sg:p-1 sg:shadow-popover"
            >
              {matches.map((c, i) => (
                <div
                  key={c.id}
                  id={`${id}-opt-${i}`}
                  // biome-ignore lint/a11y/useSemanticElements: listbox option; <option> cannot hold rich content
                  role="option"
                  aria-selected={i === activeIndex}
                  aria-label={`${c.label} ${c.key}`}
                  tabIndex={-1}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => acceptRef(c.key)}
                  onKeyDown={() => {}}
                  className={cn(
                    "sg:flex sg:h-[30px] sg:cursor-default sg:items-center sg:justify-between sg:gap-2 sg:rounded-md sg:px-2 sg:text-sm",
                    i === activeIndex && "sg:bg-muted",
                  )}
                >
                  <span className="sg:truncate">{c.label}</span>
                  <span className="sg:font-mono sg:text-xs sg:text-faint-foreground">{c.key}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div id={helpId} className="sg:flex sg:min-h-5 sg:items-center sg:justify-between sg:gap-2">
          {error ? (
            <p role="alert" className="sg:flex sg:items-start sg:gap-1 sg:text-xs sg:text-danger">
              <CircleAlert aria-hidden className="sg:mt-px sg:size-3.5 sg:shrink-0" />
              {error}
            </p>
          ) : (
            <p className="sg:text-xs sg:text-muted-foreground">
              Type <span className="sg:font-mono">{"{"}</span> to insert a column
            </p>
          )}
          {check?.valid ? (
            <span className="sg:inline-flex sg:shrink-0 sg:items-center sg:gap-1.5 sg:text-xs sg:text-muted-foreground">
              Result
              <Badge variant="primary" aria-label="Result type">
                {check.resultType}
              </Badge>
            </span>
          ) : null}
        </div>
      </div>

      {readable.length ? (
        <div className="sg:flex sg:flex-col sg:gap-1.5">
          <span id={`${id}-cols`} className="sg:text-xs sg:font-medium sg:text-muted-foreground">
            Columns
          </span>
          <fieldset aria-labelledby={`${id}-cols`} className="sg:m-0 sg:flex sg:min-w-0 sg:flex-wrap sg:gap-1 sg:border-0 sg:p-0">
            {readable.map((c) => (
              <button
                key={c.id}
                type="button"
                aria-label={`Insert ${c.label}`}
                title={`{${c.key}}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => insertAtCaret(`{${c.key}}`)}
                className={chipClasses}
              >
                <span className="sg:truncate">{c.label}</span>
              </button>
            ))}
          </fieldset>
        </div>
      ) : null}

      {examples.length ? (
        <div className="sg:flex sg:flex-col sg:gap-1.5">
          <span className="sg:text-xs sg:font-medium sg:text-muted-foreground">Examples</span>
          <div className="sg:flex sg:flex-wrap sg:gap-1">
            {examples.map((ex) => (
              <button
                key={ex}
                type="button"
                aria-label={`Use example ${ex}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => (value.trim() ? insertAtCaret(ex) : emit(ex, ex.length))}
                className={cn(chipClasses, "sg:font-mono")}
              >
                {ex}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {preview && ast && !isFormulaError(ast) ? (
        <div className="sg:overflow-hidden sg:rounded-md sg:border sg:border-border">
          <table aria-label="Formula preview" className="sg:w-full sg:border-collapse sg:text-xs sg:tabular-nums">
            <thead className="sg:bg-subtle sg:text-muted-foreground">
              <tr>
                {refs.map((k) => (
                  <th key={k} scope="col" className="sg:h-7 sg:px-2.5 sg:text-left sg:font-medium">
                    {schema.columns.find((c) => c.key === k)?.label ?? k}
                  </th>
                ))}
                <th scope="col" className="sg:h-7 sg:px-2.5 sg:text-right sg:font-medium sg:text-foreground">
                  Result
                </th>
              </tr>
            </thead>
            <tbody>
              {preview.map((row) => {
                const result = evaluate(ast, row, schema, env);
                const failed = isFormulaError(result);
                return (
                  <tr key={row.id} className="sg:border-t sg:border-border">
                    {refs.map((k) => (
                      <td key={k} className="sg:h-7 sg:max-w-32 sg:truncate sg:px-2.5 sg:text-muted-foreground">
                        {formatCell(row.cells[k])}
                      </td>
                    ))}
                    <td className={cn("sg:h-7 sg:px-2.5 sg:text-right sg:font-medium", failed ? "sg:text-danger" : "sg:text-foreground")}>
                      {failed ? result.message : formatPreviewValue(result)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
