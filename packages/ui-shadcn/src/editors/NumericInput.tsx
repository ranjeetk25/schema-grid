import { type ReactNode, useMemo, useRef, useState } from "react";
import { cn } from "../lib/cn";
import { gridInputClasses, inputClasses } from "./EditorCard";
import { InputShell } from "./InputShell";
import { isGridMode, useAutoFocus, useNativeKeyDownRef } from "./useEditorKeys";

interface Separators {
  group: string;
  decimal: string;
}

const separatorCache = new Map<string, Separators>();
function separatorsFor(locale: string | undefined): Separators {
  const key = locale ?? "";
  const cached = separatorCache.get(key);
  if (cached) return cached;
  let group = ",";
  let decimal = ".";
  try {
    for (const part of new Intl.NumberFormat(locale).formatToParts(12345.6)) {
      if (part.type === "group") group = part.value;
      if (part.type === "decimal") decimal = part.value;
    }
  } catch {
    // keep the defaults
  }
  const result = { group, decimal };
  separatorCache.set(key, result);
  return result;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export interface NumericInputProps {
  value: number | null;
  onChange(value: number | null): void;
  onCommit(value?: number | null): void;
  onCancel(): void;
  label?: string;
  autoFocus?: boolean;
  error?: string;
  precision?: number;
  min?: number;
  max?: number;
  /** Group thousands in the displayed value (locale-aware, e.g. en-IN lakh grouping). */
  grouping?: boolean;
  locale?: string;
  /** Adornment inside the field before the number (e.g. "₹"). */
  prefix?: ReactNode;
}

/**
 * Right-aligned tabular numeric input shared by `NumberEditor` and
 * `CurrencyEditor`. Accepts locale group / decimal separators, caps typed
 * decimals at `precision`, emits a number (or null when empty), regroups on
 * blur, and validates min / max after the user has typed. Enter on an
 * invalid value is blocked at the source.
 */
export function NumericInput({
  value,
  onChange,
  onCommit,
  onCancel,
  label,
  autoFocus,
  error,
  precision,
  min,
  max,
  grouping = false,
  locale,
  prefix,
}: NumericInputProps) {
  const seps = separatorsFor(locale);
  const formatter = useMemo(() => {
    try {
      return new Intl.NumberFormat(locale, { useGrouping: grouping, maximumFractionDigits: precision ?? 20 });
    } catch {
      return new Intl.NumberFormat(undefined, { useGrouping: grouping, maximumFractionDigits: precision ?? 20 });
    }
  }, [locale, grouping, precision]);
  const format = (n: number | null) => (n === null || !Number.isFinite(n) ? "" : formatter.format(n));

  const [text, setText] = useState(() => format(value));
  const [touched, setTouched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const gridMode = isGridMode(autoFocus);
  useAutoFocus(inputRef, autoFocus);

  const parse = (raw: string): number | null => {
    const normalised = raw.replace(new RegExp(escapeRe(seps.group), "g"), "").replace(seps.decimal, ".").trim();
    if (normalised === "" || normalised === "-") return null;
    const n = Number(normalised);
    return Number.isFinite(n) ? n : Number.NaN;
  };

  const parsed = parse(text);
  const problem = (() => {
    if (parsed === null) return undefined;
    if (Number.isNaN(parsed)) return "Not a number";
    if (min !== undefined && parsed < min) return `Must be at least ${formatter.format(min)}`;
    if (max !== undefined && parsed > max) return `Must be at most ${formatter.format(max)}`;
    return undefined;
  })();
  const message = error ?? (touched ? problem : undefined);
  const problemRef = useRef(problem);
  problemRef.current = problem;

  useNativeKeyDownRef(inputRef, (event) => {
    if (event.key !== "Enter" || !problemRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    setTouched(true);
  });

  const allowed = new RegExp(`^-?[0-9${escapeRe(seps.group)}]*(${escapeRe(seps.decimal)}[0-9]*)?$`);

  return (
    <InputShell gridMode={gridMode} message={message} prefix={prefix}>
      {({ messageId, invalid }) => (
        <input
          ref={inputRef}
          type="text"
          inputMode="decimal"
          value={text}
          aria-label={label || undefined}
          aria-invalid={invalid || undefined}
          aria-describedby={messageId}
          className={cn(gridMode ? gridInputClasses : inputClasses, "sg:text-right sg:tabular-nums", !gridMode && prefix ? "sg:pl-7" : null)}
          onChange={(event) => {
            const next = event.currentTarget.value;
            if (!allowed.test(next)) return;
            const decimals = next.split(seps.decimal)[1];
            if (precision !== undefined && decimals !== undefined && decimals.length > precision) return;
            if (precision === 0 && next.includes(seps.decimal)) return;
            setText(next);
            setTouched(true);
            const n = parse(next);
            if (n === null || !Number.isNaN(n)) onChange(n);
          }}
          onBlur={() => {
            setTouched(true);
            if (parsed !== null && !Number.isNaN(parsed)) setText(format(parsed));
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              if (problem) return;
              onCommit(parsed);
            } else if (event.key === "Escape") {
              event.preventDefault();
              onCancel();
            }
          }}
        />
      )}
    </InputShell>
  );
}
