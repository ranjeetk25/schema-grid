import { DatePickerInput, DateTimePicker } from "@mantine/dates";
import { IconCalendar, IconCalendarTime } from "../internal/icons";
import dayjs from "dayjs";
import { type ReactNode, useEffect, useRef } from "react";
import { toPopupGridEditor } from "../internal/grid-contracts";
import type { UiEditorProps } from "../internal/grid-contracts";

const DATETIME_PICKER_FORMAT = "YYYY-MM-DD HH:mm:ss";

/** Popup card body: the picker input at the card's width; the calendar opens attached below it. */
function CardWidth({ surface, children }: { surface: UiEditorProps["surface"]; children: ReactNode }) {
  return surface === "popup" ? <div style={{ width: "var(--sg-ed-width, 100%)" }}>{children}</div> : <>{children}</>;
}

const DROPDOWN_PROPS = {
  withinPortal: false,
  transitionProps: { duration: 0 },
  shadow: "md",
  radius: "lg",
  offset: 6,
} as const;

/**
 * Date editor. Mantine's `DatePickerInput` already speaks the core's stored
 * "YYYY-MM-DD" form directly, so no conversion is needed.
 */
export function DateEditor({ value, onChange, onCommit, onCancel, column, autoFocus, error, surface }: UiEditorProps<string, unknown>) {
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (autoFocus !== false) ref.current?.focus();
  }, [autoFocus]);

  return (
    <CardWidth surface={surface}>
    <DatePickerInput
      ref={ref}
      value={value}
      error={error}
      aria-label={column.label || undefined}
      placeholder="Pick a date"
      leftSection={<IconCalendar size={16} stroke={1.75} aria-hidden />}
      leftSectionPointerEvents="none"
      popoverProps={DROPDOWN_PROPS}
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
    </CardWidth>
  );
}

export const DatePopupEditor = toPopupGridEditor(DateEditor);

/**
 * Date & time editor. Stores an ISO string; converts to/from Mantine's
 * "YYYY-MM-DD HH:mm:ss" picker form via dayjs.
 */
export function DateTimeEditor({ value, onChange, onCommit, onCancel, column, autoFocus, error, surface }: UiEditorProps<string, unknown>) {
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (autoFocus !== false) ref.current?.focus();
  }, [autoFocus]);

  const pickerValue = value ? dayjs(value).format(DATETIME_PICKER_FORMAT) : null;

  return (
    <CardWidth surface={surface}>
    <DateTimePicker
      ref={ref}
      value={pickerValue}
      error={error}
      aria-label={column.label || undefined}
      placeholder="Pick date and time"
      leftSection={<IconCalendarTime size={16} stroke={1.75} aria-hidden />}
      leftSectionPointerEvents="none"
      popoverProps={DROPDOWN_PROPS}
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
    </CardWidth>
  );
}

export const DateTimePopupEditor = toPopupGridEditor(DateTimeEditor);
