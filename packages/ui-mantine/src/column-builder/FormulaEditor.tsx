import { Badge, Combobox, Group, Stack, Text, Textarea, useCombobox } from "@mantine/core";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { type AccessMap, readableColumns } from "../internal/access";
import {
  type FormulaResultType,
  type GridSchema,
  dependencies,
  inferResultType,
  isFormulaError,
  parseFormula,
} from "../internal/core-contracts";

export interface FormulaEditorProps {
  schema: GridSchema;
  access: AccessMap;
  value: string;
  onChange(value: string): void;
  /** Key of the column being edited: excluded from autocomplete, and a self reference is an error. */
  selfKey?: string;
  onValidityChange?(valid: boolean): void;
  label?: string;
}

export type FormulaCheck = { valid: true; resultType: FormulaResultType } | { valid: false; error: string };

/** Parse + reference checks: unknown/hidden columns, self reference, and cycles through other formulas. */
export function checkFormula(src: string, schema: GridSchema, access: AccessMap, selfKey?: string): FormulaCheck {
  const ast = parseFormula(src);
  if (isFormulaError(ast)) {
    return { valid: false, error: ast.position === undefined ? ast.message : `${ast.message} (at position ${ast.position})` };
  }
  const readable = new Map(readableColumns(schema, access).map((c) => [c.key, c]));
  for (const key of dependencies(ast)) {
    if (selfKey && key === selfKey) return { valid: false, error: "A formula cannot reference itself" };
    if (!readable.has(key)) return { valid: false, error: `Unknown column "${key}"` };
  }
  if (selfKey && reaches(ast, selfKey, schema, new Set())) {
    return { valid: false, error: "Circular reference through another formula column" };
  }
  return { valid: true, resultType: inferResultType(ast, schema) };
}

function reaches(ast: Exclude<ReturnType<typeof parseFormula>, { kind: "error" }>, target: string, schema: GridSchema, seen: Set<string>): boolean {
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

export function FormulaEditor({
  schema,
  access,
  value,
  onChange,
  selfKey,
  onValidityChange,
  label = "Formula",
}: FormulaEditorProps) {
  const combobox = useCombobox();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [token, setToken] = useState<{ start: number; query: string; caret: number } | null>(null);
  const pendingCaret = useRef<number | null>(null);

  const candidates = useMemo(
    () => readableColumns(schema, access).filter((c) => c.key !== selfKey),
    [schema, access, selfKey],
  );
  const matches = token
    ? candidates.filter((c) => {
        const q = token.query.trim().toLowerCase();
        return !q || c.key.toLowerCase().includes(q) || c.label.toLowerCase().includes(q);
      })
    : [];

  const check = useMemo(() => (value.trim() ? checkFormula(value, schema, access, selfKey) : null), [value, schema, access, selfKey]);
  const valid = check?.valid === true;

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

  return (
    <Stack gap={6}>
      <Combobox store={combobox} withinPortal={false} onOptionSubmit={insert} position="bottom-start">
        <Combobox.Target>
          <Textarea
            ref={textareaRef}
            label={label}
            description="Type { to insert a column"
            autosize
            minRows={2}
            value={value}
            error={check && !check.valid ? check.error : undefined}
            spellCheck={false}
            styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)" } }}
            onChange={(e) => {
              const text = e.currentTarget.value;
              onChange(text);
              syncToken(text, e.currentTarget.selectionStart ?? text.length);
            }}
            onClick={(e) => syncToken(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && combobox.dropdownOpened) {
                e.stopPropagation();
                combobox.closeDropdown();
              }
            }}
            onBlur={() => combobox.closeDropdown()}
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
      {check?.valid && (
        <Group gap={6}>
          <Text size="xs" c="dimmed">
            Result
          </Text>
          <Badge size="sm" variant="light" aria-label="Result type">
            {check.resultType}
          </Badge>
        </Group>
      )}
    </Stack>
  );
}
