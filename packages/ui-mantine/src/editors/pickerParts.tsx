import { Combobox, useMantineTheme } from "@mantine/core";
import { IconCheck, IconSearch, IconX } from "../internal/icons";
import { type ReactNode, type RefObject, useEffect, useRef } from "react";
import type { Option } from "../internal/core-contracts";
import { resolveOptionColor } from "../internal/options";

export const ICON_PROPS = { size: 16, stroke: 1.75 } as const;

/** The filled colour for an option (Mantine palette name or raw CSS colour). */
function dotBackground(color: string, colors: Record<string, unknown>): string {
  return color in colors ? `var(--mantine-color-${color}-filled)` : color;
}

/** 8px option colour dot. */
export function OptionColorDot({ option }: { option: Option | undefined }) {
  const theme = useMantineTheme();
  const color = resolveOptionColor(option, theme);
  return (
    <span
      aria-hidden
      className="sg-ed-dot"
      data-testid="option-color-dot"
      data-color={color}
      style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: dotBackground(color, theme.colors) }}
    />
  );
}

/** A 30px picker row: optional leading content, the label, and an accent check when selected. */
export function PickerOption({
  value,
  selected,
  disabled,
  leading,
  children,
  "aria-label": ariaLabel,
}: {
  value: string;
  selected?: boolean;
  disabled?: boolean;
  leading?: ReactNode;
  children: ReactNode;
  "aria-label"?: string;
}) {
  return (
    <Combobox.Option
      value={value}
      active={selected}
      disabled={disabled}
      className="sg-ed-option"
      aria-label={ariaLabel}
    >
      {leading}
      <span className="sg-ed-option-label">{children}</span>
      {selected && <IconCheck className="sg-ed-check" size={14} stroke={2} aria-hidden />}
    </Combobox.Option>
  );
}

/** The search row at the top of a picker card: search icon, optional pills, the input and a right section. */
export function SearchRow({
  children,
  pills,
  right,
  onMouseDown,
  showIcon = true,
}: {
  children: ReactNode;
  pills?: ReactNode;
  right?: ReactNode;
  onMouseDown?(): void;
  showIcon?: boolean;
}) {
  return (
    <div
      className="sg-ed-search"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && onMouseDown) {
          event.preventDefault();
          onMouseDown();
        }
      }}
    >
      {showIcon && <IconSearch className="sg-ed-search-icon" size={14} stroke={1.75} aria-hidden />}
      {pills}
      {children}
      {right}
    </div>
  );
}

/** A removable coloured pill inside a picker's search row. */
export function PickerPill({ label, color, onRemove }: { label: string; color?: string; onRemove?(): void }) {
  const theme = useMantineTheme();
  const c = resolveOptionColor(color ? { color } : undefined, theme);
  const named = c in theme.colors;
  return (
    <span
      className="sg-ed-pill"
      style={{
        background: named ? `var(--mantine-color-${c}-light)` : "var(--mantine-color-default-hover)",
        color: named ? `var(--mantine-color-${c}-light-color)` : "var(--mantine-color-text)",
      }}
    >
      <span>{label}</span>
      {onRemove && (
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Remove ${label}`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onRemove}
        >
          <IconX size={12} stroke={2} aria-hidden />
        </button>
      )}
    </span>
  );
}

export function PickerDivider() {
  return <div className="sg-ed-divider" aria-hidden />;
}

export function PickerEmpty({ children }: { children: ReactNode }) {
  return <div className="sg-ed-empty">{children}</div>;
}

/**
 * Grid mode: AG Grid listens for Enter on an ancestor of popup editors (a
 * native listener, which runs before React's delegated handlers) and ends
 * the edit with the old value. When an option is highlighted, pick it here
 * at the input and keep Enter from the grid.
 */
export function useEnterPicksHighlighted(inputRef: RefObject<HTMLInputElement>, enabled: boolean, onPick: (value: string) => void) {
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  useEffect(() => {
    const input = inputRef.current;
    if (!enabled || !input) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Enter" || event.isComposing) return;
      const activeId = input.getAttribute("aria-activedescendant");
      const option = activeId ? input.ownerDocument.getElementById(activeId) : null;
      const picked = option?.getAttribute("value");
      if (!option || picked == null || option.hasAttribute("data-combobox-disabled")) return;
      event.preventDefault();
      event.stopPropagation();
      pickRef.current(picked);
    };
    input.addEventListener("keydown", onKeyDown);
    return () => input.removeEventListener("keydown", onKeyDown);
  }, [inputRef, enabled]);
}
