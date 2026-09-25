import { TextInput } from "@mantine/core";
import { useEffect, useRef, useState } from "react";
import type { UiEditorProps } from "../internal/grid-contracts";
import { textInputError, useBlockInvalidEnter, useSurfaceInputProps, useTouchedError } from "./fieldValidation";

type ContactFieldTypeId = "url" | "email" | "phone";

interface ContactEditorSpec {
  fieldTypeId: ContactFieldTypeId;
  type: "url" | "email" | "tel";
  inputMode: "url" | "email" | "tel";
}

/**
 * Single-line contact editor (url/email/phone). Core's `parse` validates the
 * text; the message renders inside the editor (red ring + 12px helper text,
 * or an alert icon in a cramped grid cell) once the user has typed or
 * pressed Enter — never on open. Enter on an invalid value keeps the editor
 * open instead of committing.
 */
function createContactEditor({ fieldTypeId, type, inputMode }: ContactEditorSpec) {
  return function ContactEditor({ value, onChange, onCommit, onCancel, column, config, autoFocus, error, surface }: UiEditorProps<string, unknown>) {
    const [text, setText] = useState(value ?? "");
    const inputRef = useRef<HTMLInputElement>(null);
    const problem = textInputError(fieldTypeId, text, config);
    const validation = useTouchedError(problem, error);
    useBlockInvalidEnter(inputRef, problem !== undefined, validation.touch);
    const { props: surfaceProps, extra } = useSurfaceInputProps(surface, validation.visible);

    useEffect(() => {
      if (autoFocus !== false) inputRef.current?.focus();
    }, [autoFocus]);

    return (
      <>
        <TextInput
          ref={inputRef}
          type={type}
          inputMode={inputMode}
          value={text}
          aria-label={column.label || undefined}
          {...surfaceProps}
          onChange={(event) => {
            const next = event.currentTarget.value;
            setText(next);
            validation.touch();
            onChange(next);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              if (problem) validation.touch();
              else onCommit(text);
            } else if (event.key === "Escape") {
              event.preventDefault();
              onCancel();
            }
          }}
        />
        {extra}
      </>
    );
  };
}

export const UrlEditor = createContactEditor({ fieldTypeId: "url", type: "url", inputMode: "url" });
export const EmailEditor = createContactEditor({ fieldTypeId: "email", type: "email", inputMode: "email" });
export const PhoneEditor = createContactEditor({ fieldTypeId: "phone", type: "tel", inputMode: "tel" });
