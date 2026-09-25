import { DatePickerInput, DateTimePicker } from "@mantine/dates";
import dayjs from "dayjs";
import { useEffect, useRef } from "react";
import { createPopupEditor } from "../internal/grid-contracts";
import type { UiEditorProps } from "../internal/grid-contracts";

const DATETIME_PICKER_FORMAT = "YYYY-MM-DD HH:mm:ss";

/**
 * Date editor. Mantine's `DatePickerInput` already speaks the core's stored
 * "YYYY-MM-DD" form directly, so no conversion is needed.
 */
export function DateEditor({ value, onChange, onCommit, onCancel, autoFocus, error }: UiEditorProps<string, unknown>) {
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (autoFocus !== false) ref.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <DatePickerInput
      ref={ref}
      value={value}
      error={error}
      popoverProps={{ withinPortal: false, transitionProps: { duration: 0 } }}
      onChange={(next) => {
        onChange(next);
        onCommit(next);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
      }}
    />
  );
}

export const DatePopupEditor = createPopupEditor(DateEditor);

/**
 * Date & time editor. Stores an ISO string; converts to/from Mantine's
 * "YYYY-MM-DD HH:mm:ss" picker form via dayjs.
 */
export function DateTimeEditor({ value, onChange, onCommit, onCancel, autoFocus, error }: UiEditorProps<string, unknown>) {
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (autoFocus !== false) ref.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickerValue = value ? dayjs(value).format(DATETIME_PICKER_FORMAT) : null;

  return (
    <DateTimePicker
      ref={ref}
      value={pickerValue}
      error={error}
      popoverProps={{ withinPortal: false, transitionProps: { duration: 0 } }}
      timePickerProps={{ popoverProps: { withinPortal: false, transitionProps: { duration: 0 } } }}
      onChange={(next) => {
        const iso = next ? dayjs(next, DATETIME_PICKER_FORMAT).toISOString() : null;
        onChange(iso);
        onCommit(iso);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
      }}
    />
  );
}

export const DateTimePopupEditor = createPopupEditor(DateTimeEditor);
