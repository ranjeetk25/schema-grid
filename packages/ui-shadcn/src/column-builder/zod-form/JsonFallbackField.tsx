import { type ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "../../lib/cn";
import { Field } from "../../ui/field";
import { Textarea } from "../../ui/textarea";

export interface JsonFallbackFieldProps {
  label: ReactNode;
  description?: ReactNode;
  value: unknown;
  /** Called only with successfully parsed JSON (`undefined` when the text is cleared). */
  onChange: (next: unknown) => void;
  error?: string;
}

const toText = (value: unknown): string => {
  if (value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return "";
  }
};

/** Raw JSON editor for schema parts the auto-form cannot render. Invalid JSON never emits. */
export function JsonFallbackField({ label, description, value, onChange, error }: JsonFallbackFieldProps) {
  const [text, setText] = useState(() => toText(value));
  const [parseError, setParseError] = useState<string | null>(null);
  const lastEmitted = useRef<unknown>(value);

  // Resync when the value changes from outside (not from our own emit).
  useEffect(() => {
    if (value !== lastEmitted.current) {
      const same = JSON.stringify(value) === JSON.stringify(lastEmitted.current);
      lastEmitted.current = value;
      if (same) return;
      setText(toText(value));
      setParseError(null);
    }
  }, [value]);

  const handleChange = (next: string) => {
    setText(next);
    if (next.trim() === "") {
      setParseError(null);
      lastEmitted.current = undefined;
      onChange(undefined);
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(next);
    } catch {
      setParseError("Invalid JSON");
      return;
    }
    setParseError(null);
    lastEmitted.current = parsed;
    onChange(parsed);
  };

  return (
    <Field label={label} description={description} error={parseError ?? error}>
      {({ id, describedBy, invalid }) => (
        <Textarea
          id={id}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          value={text}
          spellCheck={false}
          rows={3}
          className={cn("sg:min-h-16 sg:font-mono sg:text-xs")}
          onChange={(e) => handleChange(e.currentTarget.value)}
        />
      )}
    </Field>
  );
}
