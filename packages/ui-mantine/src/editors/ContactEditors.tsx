import { TextInput } from "@mantine/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { createDefaultRegistry } from "../internal/core-contracts";
import type { UiEditorProps } from "../internal/grid-contracts";

type ContactFieldTypeId = "url" | "email" | "phone";

interface ContactEditorSpec {
  fieldTypeId: ContactFieldTypeId;
  type: "url" | "email" | "tel";
  inputMode: "url" | "email" | "tel";
}

/**
 * Single-line contact editor (url/email/phone). Shows a non-blocking hint
 * when core's `parse` rejects the current text; commit is still allowed —
 * the core validation layer is the one that ultimately decides.
 */
function createContactEditor({ fieldTypeId, type, inputMode }: ContactEditorSpec) {
  return function ContactEditor({ value, onChange, onCommit, onCancel, autoFocus, error }: UiEditorProps<string, unknown>) {
    const [text, setText] = useState(value ?? "");
    const inputRef = useRef<HTMLInputElement>(null);
    const fieldType = useMemo(() => createDefaultRegistry().get(fieldTypeId), []);

    useEffect(() => {
      if (autoFocus !== false) inputRef.current?.focus();
    }, [autoFocus]);

    const hint = useMemo(() => {
      if (!fieldType || text.trim() === "") return undefined;
      const result = fieldType.parse(text, fieldType.defaultConfig);
      return result.ok ? undefined : result.error;
    }, [fieldType, text]);

    return (
      <TextInput
        ref={inputRef}
        type={type}
        inputMode={inputMode}
        value={text}
        error={error}
        description={error ? undefined : hint}
        onChange={(event) => {
          const next = event.currentTarget.value;
          setText(next);
          onChange(next);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onCommit(text);
          } else if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
      />
    );
  };
}

export const UrlEditor = createContactEditor({ fieldTypeId: "url", type: "url", inputMode: "url" });
export const EmailEditor = createContactEditor({ fieldTypeId: "email", type: "email", inputMode: "email" });
export const PhoneEditor = createContactEditor({ fieldTypeId: "phone", type: "tel", inputMode: "tel" });
