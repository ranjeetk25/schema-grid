import { CalendarIcon } from "lucide-react";
import { type RefObject, useRef, useState } from "react";
import { toPopupGridEditor } from "../internal/grid-contracts";
import type { UiEditorProps } from "../internal/grid-contracts";
import { cn } from "../lib/cn";
import { Button } from "../ui/button";
import { Calendar } from "../ui/calendar";
import { EditorCard, FieldMessage, FormPicker, inputClasses } from "./EditorCard";
import { isGridMode, useNativeKeyDownRef } from "./useEditorKeys";

const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" (core's stored date) → local Date; undefined when malformed. */
export function parseDateValue(value: string | null | undefined): Date | undefined {
  const m = value ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  if (!m) return undefined;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** Local Date → "YYYY-MM-DD". */
export function formatDateValue(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseIso(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

const dateLabel = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const dateTimeLabel = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/**
 * Grid card keyboard: Enter / Space on a calendar day activate it, but AG
 * Grid would end the edit on Enter first. Stop them at the card (the
 * button's default activation still runs); Escape cancels.
 */
function useCardKeys(ref: RefObject<HTMLDivElement | null>, onCancel: () => void, onEnterInField?: () => void) {
  useNativeKeyDownRef(ref, (event) => {
    if ((event.key === "Enter" || event.key === " ") && event.target instanceof HTMLButtonElement) {
      event.stopPropagation();
    } else if (event.key === "Enter" && event.target instanceof HTMLInputElement && onEnterInField) {
      event.preventDefault();
      event.stopPropagation();
      onEnterInField();
    } else if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    }
  });
}

/**
 * Date editor. Grid mode: an opaque card with the calendar inline (the
 * selected day is focused, arrows move, Enter / click picks and commits),
 * plus Today / Clear. Form mode: a 32px trigger + popover calendar. Speaks
 * core's stored "YYYY-MM-DD" form.
 */
export function DateEditor({ value, onChange, onCommit, onCancel, column, autoFocus, error, cellWidth }: UiEditorProps<string, unknown>) {
  const gridMode = isGridMode(autoFocus);
  const [open, setOpen] = useState(false);
  const selected = parseDateValue(value);
  const cardRef = useRef<HTMLDivElement>(null);
  useCardKeys(cardRef, onCancel);

  const pick = (next: string | null) => {
    onChange(next);
    onCommit(next);
    setOpen(false);
  };

  const calendar = (
    <Calendar
      mode="single"
      required
      selected={selected}
      defaultMonth={selected}
      autoFocus={gridMode}
      onSelect={(date) => {
        if (date) pick(formatDateValue(date));
      }}
    />
  );

  const footer = (
    <div className="sg:flex sg:items-center sg:justify-between sg:gap-2 sg:border-t sg:border-border sg:bg-subtle sg:px-2 sg:py-1.5">
      <Button variant="ghost" size="xs" onClick={() => pick(formatDateValue(new Date()))}>
        Today
      </Button>
      <Button variant="subtle" size="xs" disabled={value == null} onClick={() => pick(null)}>
        Clear
      </Button>
    </div>
  );

  if (gridMode) {
    return (
      <EditorCard ref={cardRef} cellWidth={cellWidth} className="sg:items-stretch">
        <div className="sg:flex sg:justify-center">{calendar}</div>
        {error ? (
          <div className="sg:px-3 sg:pb-2">
            <FieldMessage>{error}</FieldMessage>
          </div>
        ) : null}
        {footer}
      </EditorCard>
    );
  }

  return (
    <FormPicker
      open={open}
      onOpenChange={setOpen}
      label={column.label || undefined}
      error={error}
      icon={<CalendarIcon aria-hidden className="sg:size-3.5 sg:shrink-0 sg:text-muted-foreground" />}
      display={selected ? <span className="sg:tabular-nums">{dateLabel.format(selected)}</span> : undefined}
      placeholder="Pick a date"
      contentClassName="sg:w-auto"
    >
      {calendar}
      {footer}
    </FormPicker>
  );
}

export const DatePopupEditor = toPopupGridEditor(DateEditor);

/**
 * Date & time editor. Stores an ISO string. The calendar picks the local
 * day (keeping the time), the HH:MM field sets the local time; each change
 * is reported through `onChange`. Enter in the time field or Done commits.
 */
export function DateTimeEditor({ value, onChange, onCommit, onCancel, column, autoFocus, error, cellWidth }: UiEditorProps<string, unknown>) {
  const gridMode = isGridMode(autoFocus);
  const [open, setOpen] = useState(false);
  const initial = parseIso(value);
  const [day, setDay] = useState<Date | undefined>(initial);
  const [time, setTime] = useState(initial ? `${pad(initial.getHours())}:${pad(initial.getMinutes())}` : "00:00");
  const [timeTouched, setTimeTouched] = useState(false);
  const [dirty, setDirty] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  useCardKeys(cardRef, onCancel, () => commit());

  const timeMatch = TIME_RE.exec(time);
  const timeProblem = timeMatch ? undefined : "Use 24-hour HH:MM";

  const toIso = (d: Date | undefined, t: string): string | null => {
    const m = TIME_RE.exec(t);
    if (!d || !m) return null;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), Number(m[1]), Number(m[2])).toISOString();
  };

  const report = (d: Date | undefined, t: string) => {
    setDirty(true);
    const iso = toIso(d, t);
    if (iso) onChange(iso);
  };

  const commit = () => {
    setTimeTouched(true);
    if (timeProblem) return;
    onCommit(dirty ? toIso(day, time) : (value ?? null));
    setOpen(false);
  };

  const body = (
    <>
      <div className="sg:flex sg:justify-center">
        <Calendar
          mode="single"
          required
          selected={day}
          defaultMonth={day}
          autoFocus={gridMode}
          onSelect={(date) => {
            if (!date) return;
            setDay(date);
            report(date, time);
          }}
        />
      </div>
      <div className="sg:flex sg:flex-col sg:gap-1 sg:border-t sg:border-border sg:px-3 sg:py-2">
        <div className="sg:flex sg:items-center sg:gap-2">
          <label htmlFor={`${column.id}-time`} className="sg:w-10 sg:text-xs sg:text-muted-foreground">
            Time
          </label>
          <input
            id={`${column.id}-time`}
            type="text"
            inputMode="numeric"
            aria-label="Time"
            placeholder="HH:MM"
            value={time}
            aria-invalid={timeTouched && timeProblem ? true : undefined}
            className={cn(inputClasses, "sg:h-7 sg:w-20 sg:px-2 sg:text-center sg:font-mono sg:tabular-nums")}
            onChange={(event) => {
              const next = event.currentTarget.value.replace(/[^\d:]/g, "").slice(0, 5);
              setTime(next);
              if (TIME_RE.test(next)) report(day, next);
            }}
            onBlur={() => setTimeTouched(true)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.stopPropagation();
                commit();
              }
            }}
          />
          <Button variant="primary" size="xs" className="sg:ml-auto" onClick={commit}>
            Done
          </Button>
        </div>
        {timeTouched && timeProblem ? <FieldMessage>{timeProblem}</FieldMessage> : null}
        {error ? <FieldMessage>{error}</FieldMessage> : null}
      </div>
    </>
  );

  if (gridMode) {
    return (
      <EditorCard ref={cardRef} cellWidth={cellWidth}>
        {body}
      </EditorCard>
    );
  }

  const shown = parseIso(value);
  return (
    <FormPicker
      open={open}
      onOpenChange={setOpen}
      label={column.label || undefined}
      error={error}
      icon={<CalendarIcon aria-hidden className="sg:size-3.5 sg:shrink-0 sg:text-muted-foreground" />}
      display={shown ? <span className="sg:tabular-nums">{dateTimeLabel.format(shown)}</span> : undefined}
      placeholder="Pick a date and time"
      contentClassName="sg:w-auto"
    >
      {body}
    </FormPicker>
  );
}

export const DateTimePopupEditor = toPopupGridEditor(DateTimeEditor);
