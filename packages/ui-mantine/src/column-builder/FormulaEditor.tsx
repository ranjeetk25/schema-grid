import {
  Badge,
  Box,
  Button,
  Combobox,
  Group,
  Popover,
  ScrollArea,
  Stack,
  Text,
  Textarea,
  TextInput,
  UnstyledButton,
  useCombobox,
} from "@mantine/core";
import { IconMathFunction, IconSearch } from "@tabler/icons-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { type AccessMap, readableColumns } from "../internal/access";
import {
  type FormulaEnv,
  type FormulaNode,
  type FormulaResultType,
  type GridRow,
  type GridSchema,
  createDefaultRegistry,
  dependencies,
  evaluate,
  inferResultType,
  isFormulaError,
  parseFormula,
} from "../internal/core-contracts";
import { useEditorStyles } from "../editors/EditorCard";
import { fieldTypeMeta } from "./fieldTypeMeta";
import { formulaExamples, formulaFunctionDocs } from "./formulaHelp";

export interface FormulaEditorProps {
  schema: GridSchema;
  access: AccessMap;
  value: string;
  onChange(value: string): void;
  /** Key of the column being edited: excluded from autocomplete, and a self reference is an error. */
  selfKey?: string;
  onValidityChange?(valid: boolean): void;
  label?: string;
  /** Rows to evaluate the formula against for the live preview (the first 3 are used). */
  sampleRows?: readonly GridRow[];
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

let formulaFieldType: ReturnType<ReturnType<typeof createDefaultRegistry>["get"]> | undefined;
const formatResult = (value: unknown, resultType: FormulaResultType): string => {
  formulaFieldType ??= createDefaultRegistry().get("formula");
  if (value === null || value === undefined || value === "") return "—";
  return formulaFieldType?.format(value, { resultType }) ?? String(value);
};

const localEnv = (): FormulaEnv => ({
  now: new Date(),
  tz: typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC",
});

/** A short name for a sample row: its first text-like cell, else its id. */
function rowName(row: GridRow, schema: GridSchema): string {
  const textCol = [...schema.columns].sort((a, b) => a.order - b.order).find((c) => c.type === "text");
  const v = textCol ? row.cells[textCol.key] : undefined;
  return typeof v === "string" && v.trim() ? v : row.id;
}

const MONO = "var(--mantine-font-family-monospace)";

/**
 * Formula input with everything needed to write one: `{column}`
 * autocomplete, a row of column chips that insert a reference at the caret,
 * example formulas built from this table's columns, a Functions reference,
 * the inferred result type, and a live preview on sample rows.
 */
export function FormulaEditor({
  schema,
  access,
  value,
  onChange,
  selfKey,
  onValidityChange,
  label = "Formula",
  sampleRows,
}: FormulaEditorProps) {
  useEditorStyles();
  const combobox = useCombobox();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [token, setToken] = useState<{ start: number; query: string; caret: number } | null>(null);
  const pendingCaret = useRef<number | null>(null);
  const selection = useRef<{ start: number; end: number } | null>(null);

  const candidates = useMemo(() => readableColumns(schema, access).filter((c) => c.key !== selfKey), [schema, access, selfKey]);
  const matches = token
    ? candidates.filter((c) => {
        const q = token.query.trim().toLowerCase();
        return !q || c.key.toLowerCase().includes(q) || c.label.toLowerCase().includes(q);
      })
    : [];

  const check = useMemo(() => (value.trim() ? checkFormula(value, schema, access, selfKey) : null), [value, schema, access, selfKey]);
  const valid = check?.valid === true;
  const examples = useMemo(
    () => formulaExamples(schema, new Set(readableColumns(schema, access).map((c) => c.key)), selfKey),
    [schema, access, selfKey],
  );

  const preview = useMemo(() => {
    if (!check?.valid || !sampleRows || sampleRows.length === 0) return null;
    const ast = parseFormula(value);
    if (isFormulaError(ast)) return null;
    const env = localEnv();
    return sampleRows.slice(0, 3).map((row) => {
      const result = evaluate(ast, row, schema, env);
      return {
        id: row.id,
        name: rowName(row, schema),
        text: isFormulaError(result) ? "#ERROR" : formatResult(result, check.resultType),
        error: isFormulaError(result) ? result.message : undefined,
      };
    });
  }, [check, sampleRows, value, schema]);

  const lastValidity = useRef<boolean | null>(null);
  useEffect(() => {
    if (lastValidity.current !== valid) {
      lastValidity.current = valid;
      onValidityChange?.(valid);
    }
  }, [valid, onValidityChange]);

  useLayoutEffect(() => {
    if (pendingCaret.current !== null && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
  });

  const syncToken = (text: string, caret: number) => {
    const ref = openRefAt(text, caret);
    if (ref) {
      setToken({ ...ref, caret });
      combobox.openDropdown();
    } else {
      setToken(null);
      combobox.closeDropdown();
    }
  };

  const insert = (key: string) => {
    if (!token) return;
    const replacement = `{${key}}`;
    // Swallow an auto-typed "}" right after the caret.
    const after = value.slice(token.caret).replace(/^[^{}\s(),]*\}/, "");
    const next = value.slice(0, token.start) + replacement + after;
    pendingCaret.current = token.start + replacement.length;
    setToken(null);
    combobox.closeDropdown();
    onChange(next);
  };

  /** Inserts text at the last caret / selection in the textarea (or at the end). */
  const insertAtCaret = (text: string, caretOffset = text.length) => {
    const el = textareaRef.current;
    const sel = el && document.activeElement === el ? { start: el.selectionStart, end: el.selectionEnd } : selection.current;
    const start = sel?.start ?? value.length;
    const end = sel?.end ?? value.length;
    const next = value.slice(0, start) + text + value.slice(end);
    pendingCaret.current = start + caretOffset;
    onChange(next);
  };

  const rememberSelection = () => {
    const el = textareaRef.current;
    if (el) selection.current = { start: el.selectionStart, end: el.selectionEnd };
  };

  return (
    <Stack gap={10}>
      <Box pos="relative">
        <Combobox store={combobox} withinPortal={false} onOptionSubmit={insert} position="bottom-start">
          <Combobox.Target>
            <Textarea
              ref={textareaRef}
              label={label}
              description="Type { to insert a column, or click one below"
              placeholder="e.g. {fee} - {paid}"
              autosize
              minRows={2}
              value={value}
              error={check && !check.valid ? check.error : undefined}
              spellCheck={false}
              styles={{ input: { fontFamily: MONO, fontSize: 13 } }}
              onChange={(e) => {
                const text = e.currentTarget.value;
                onChange(text);
                syncToken(text, e.currentTarget.selectionStart ?? text.length);
              }}
              onClick={(e) => syncToken(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)}
              onSelect={rememberSelection}
              onKeyDown={(e) => {
                if (e.key === "Escape" && combobox.dropdownOpened) {
                  e.stopPropagation();
                  combobox.closeDropdown();
                }
              }}
              onBlur={() => {
                rememberSelection();
                combobox.closeDropdown();
              }}
            />
          </Combobox.Target>
          <Combobox.Dropdown hidden={!token || matches.length === 0}>
            <Combobox.Options>
              {matches.map((c) => (
                <Combobox.Option key={c.id} value={c.key} aria-label={`${c.label} ${c.key}`}>
                  <Group gap="xs" wrap="nowrap">
                    <Text size="sm">{c.label}</Text>
                    <Text size="xs" c="dimmed" ff="monospace">
                      {c.key}
                    </Text>
                  </Group>
                </Combobox.Option>
              ))}
            </Combobox.Options>
          </Combobox.Dropdown>
        </Combobox>
        <Box pos="absolute" top={0} right={0}>
          <FunctionsReference onPick={(name) => insertAtCaret(`${name}()`, name.length + 1)} />
        </Box>
      </Box>

      {candidates.length > 0 && (
        <Stack gap={4}>
          <Text size="xs" c="dimmed">
            Columns
          </Text>
          <Group gap={4} data-testid="formula-column-chips">
            {candidates.map((c) => {
              const Icon = fieldTypeMeta(c.type).icon;
              return (
                <UnstyledButton
                  key={c.id}
                  aria-label={`Insert ${c.label}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insertAtCaret(`{${c.key}}`)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    height: 24,
                    padding: "0 8px",
                    borderRadius: 6,
                    fontSize: 12,
                    border: "1px solid var(--mantine-color-default-border)",
                    background: "var(--mantine-color-body)",
                  }}
                >
                  <Icon size={12} stroke={1.75} style={{ color: "var(--mantine-color-dimmed)" }} aria-hidden />
                  {c.label}
                </UnstyledButton>
              );
            })}
          </Group>
        </Stack>
      )}

      {examples.length > 0 && (
        <Stack gap={4}>
          <Text size="xs" c="dimmed">
            Examples
          </Text>
          <Stack gap={2}>
            {examples.map((ex) => (
              <UnstyledButton
                key={ex.formula}
                aria-label={`Use example: ${ex.label}`}
                onClick={() => {
                  pendingCaret.current = ex.formula.length;
                  onChange(ex.formula);
                }}
                className="sg-cp-example"
              >
                <Text size="xs" fw={500} span>
                  {ex.label}
                </Text>
                <Text size="xs" c="dimmed" ff="monospace" span truncate>
                  {ex.formula}
                </Text>
              </UnstyledButton>
            ))}
          </Stack>
        </Stack>
      )}

      {check?.valid && (
        <Stack gap={6}>
          <Group gap={6}>
            <Text size="xs" c="dimmed">
              Result
            </Text>
            <Badge size="sm" variant="light" color="gray" aria-label="Result type">
              {check.resultType}
            </Badge>
          </Group>
          {preview && (
            <Box
              data-testid="formula-preview"
              style={{ border: "1px solid var(--mantine-color-default-border)", borderRadius: 8, overflow: "hidden" }}
            >
              <Text size="xs" c="dimmed" px={10} py={6} style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}>
                Preview on your data
              </Text>
              {preview.map((p, i) => (
                <Group
                  key={p.id}
                  justify="space-between"
                  wrap="nowrap"
                  px={10}
                  h={30}
                  style={i > 0 ? { borderTop: "1px solid var(--mantine-color-default-border)" } : undefined}
                >
                  <Text size="xs" c="dimmed" truncate>
                    {p.name}
                  </Text>
                  <Text size="sm" title={p.error} c={p.error ? "red" : undefined} style={{ fontVariantNumeric: "tabular-nums" }}>
                    {p.text}
                  </Text>
                </Group>
              ))}
            </Box>
          )}
        </Stack>
      )}
    </Stack>
  );
}

/** "Functions" popover: every core function with its signature and a one-liner; click inserts it. */
function FunctionsReference({ onPick }: { onPick(name: string): void }) {
  const [opened, setOpened] = useState(false);
  const [q, setQ] = useState("");
  const docs = useMemo(() => formulaFunctionDocs(), []);
  const shown = docs.filter((d) => !q.trim() || `${d.name} ${d.description}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Popover opened={opened} onChange={setOpened} position="bottom-end" width={320} withinPortal={false} shadow="md" radius="lg">
      <Popover.Target>
        <Button
          size="compact-xs"
          variant="subtle"
          color="gray"
          leftSection={<IconMathFunction size={14} stroke={1.75} />}
          onClick={() => setOpened((o) => !o)}
          aria-expanded={opened}
        >
          Functions
        </Button>
      </Popover.Target>
      <Popover.Dropdown p={4}>
        <TextInput
          size="xs"
          variant="unstyled"
          px={8}
          placeholder="Search functions"
          aria-label="Search functions"
          leftSection={<IconSearch size={12} stroke={1.75} />}
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
          data-autofocus
        />
        <ScrollArea.Autosize mah={280} type="auto">
          <ul aria-label="Functions" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {shown.map((d) => (
              <li key={d.name}>
                <UnstyledButton
                  className="sg-cp-fn"
                  onClick={() => {
                    onPick(d.name);
                    setOpened(false);
                  }}
                >
                  <Text size="xs" ff="monospace" fw={500}>
                    {d.signature}
                  </Text>
                  {d.description && (
                    <Text size="xs" c="dimmed">
                      {d.description}
                    </Text>
                  )}
                </UnstyledButton>
              </li>
            ))}
          </ul>
        </ScrollArea.Autosize>
      </Popover.Dropdown>
    </Popover>
  );
}
