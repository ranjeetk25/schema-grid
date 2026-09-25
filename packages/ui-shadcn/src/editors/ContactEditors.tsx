import { useMemo, useRef, useState } from "react";
import { createDefaultRegistry } from "../internal/core-contracts";
import type { UiEditorProps } from "../internal/grid-contracts";
import { cn } from "../lib/cn";
import { gridInputClasses, inputClasses } from "./EditorCard";
import { InputShell } from "./InputShell";
import { isGridMode, useAutoFocus, useNativeKeyDownRef } from "./useEditorKeys";

type ContactFieldTypeId = "url" | "email" | "phone";

interface ContactEditorSpec {
  fieldTypeId: ContactFieldTypeId;
  type: "url" | "email" | "tel";
  inputMode: "url" | "email" | "tel";
  placeholder: string;
}

/**
 * Single-line contact editor (url/email/phone). Validates with core's
 * `parse`: once the user has typed (or tried to commit) an invalid value, the
 * message shows under the input and the field is marked invalid. Enter on an
 * invalid value is blocked at the source (the grid never sees it). Empty is
 * always allowed.
 */
function createContactEditor({ fieldTypeId, type, inputMode, placeholder }: ContactEditorSpec) {
  // Resolved once per editor kind, lazily (no work at import time).
  let fieldTypeCache: ReturnType<ReturnType<typeof createDefaultRegistry>["get"]> | null = null;
  const getFieldType = () => {
    fieldTypeCache ??= createDefaultRegistry().get(fieldTypeId);
    return fieldTypeCache;
  };
  function ContactEditor({ value, onChange, onCommit, onCancel, column, autoFocus, error }: UiEditorProps<string, unknown>) {
    const [text, setText] = useState(value ?? "");
    const [touched, setTouched] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const gridMode = isGridMode(autoFocus);
    const fieldType = getFieldType();
    useAutoFocus(inputRef, autoFocus);

    const problem = useMemo(() => {
      if (!fieldType || text.trim() === "") return undefined;
      const result = fieldType.parse(text, fieldType.defaultConfig);
      return result.ok ? undefined : result.error;
    }, [fieldType, text]);

    useNativeKeyDownRef(inputRef, (event) => {
      if (event.key !== "Enter" || !problem) return;
      event.preventDefault();
      event.stopPropagation();
      setTouched(true);
    });

    const message = error ?? (touched ? problem : undefined);

    return (
      <InputShell gridMode={gridMode} message={message}>
        {({ messageId, invalid }) => (
          <input
            ref={inputRef}
            type={type}
            inputMode={inputMode}
            value={text}
            placeholder={gridMode ? undefined : placeholder}
            aria-label={column.label || undefined}
            aria-invalid={invalid || undefined}
            aria-describedby={messageId}
            className={cn(gridMode ? gridInputClasses : inputClasses)}
            onChange={(event) => {
              const next = event.currentTarget.value;
              setText(next);
              setTouched(true);
              onChange(next);
            }}
            onBlur={() => setTouched(true)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (problem) return;
                onCommit(text);
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
  ContactEditor.displayName = `${fieldTypeId[0]?.toUpperCase()}${fieldTypeId.slice(1)}Editor`;
  return ContactEditor;
}

export const UrlEditor = createContactEditor({ fieldTypeId: "url", type: "url", inputMode: "url", placeholder: "https://" });
export const EmailEditor = createContactEditor({ fieldTypeId: "email", type: "email", inputMode: "email", placeholder: "name@example.com" });
export const PhoneEditor = createContactEditor({ fieldTypeId: "phone", type: "tel", inputMode: "tel", placeholder: "+91 98765 43210" });
