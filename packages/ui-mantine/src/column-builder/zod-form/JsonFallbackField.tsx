import { JsonInput } from "@mantine/core";
import { type ReactNode, useEffect, useRef, useState } from "react";

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
      setParseError("This isn't valid JSON: check brackets, commas and quotes");
      return;
    }
    setParseError(null);
    lastEmitted.current = parsed;
    onChange(parsed);
  };

  return (
    <JsonInput
      label={label}
      description={description}
      value={text}
      onChange={handleChange}
      error={parseError ?? error}
      autosize
      minRows={3}
      formatOnBlur={false}
    />
  );
}
