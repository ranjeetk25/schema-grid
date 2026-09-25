import { VisuallyHidden } from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";
import { type CSSProperties, type RefObject, useEffect, useId, useRef, useState } from "react";
import { type AnyFieldType, createDefaultRegistry } from "../internal/core-contracts";
import type { UiEditorProps } from "../internal/grid-contracts";

let registry: ReturnType<typeof createDefaultRegistry> | undefined;
/** A built-in core field type, resolved lazily (no work at import time). */
export function coreFieldType(id: string): AnyFieldType | undefined {
  registry ??= createDefaultRegistry();
  return registry.get(id);
}

const withDefaults = (type: AnyFieldType, config: unknown): unknown =>
  config && typeof config === "object" ? { ...(type.defaultConfig as object), ...(config as object) } : type.defaultConfig;

/** Core `parse` of a text-like input: the error message, or undefined when it parses (empty text is not an error here). */
export function textInputError(typeId: string, text: string, config: unknown): string | undefined {
  const type = coreFieldType(typeId);
  if (!type || text.trim() === "") return undefined;
  const result = type.parse(text, withDefaults(type, config));
  return result.ok ? undefined : result.error;
}

/** Range check for number-like values against the column config (`min` / `max`). */
export function numberInputError(value: number | null, config: { min?: number; max?: number } | undefined): string | undefined {
  if (value === null || Number.isNaN(value)) return undefined;
  if (typeof config?.min === "number" && value < config.min) return `Must be at least ${config.min.toLocaleString()}`;
  if (typeof config?.max === "number" && value > config.max) return `Must be at most ${config.max.toLocaleString()}`;
  return undefined;
}

/**
 * Validation display for the text-family editors: an error becomes visible
 * only once the user has typed or tried to commit — never on open.
 * `external` (the `error` prop) is always shown.
 */
export function useTouchedError(error: string | undefined, external?: string) {
  const [touched, setTouched] = useState(false);
  return {
    visible: external ?? (touched ? error : undefined),
    touched,
    touch: () => setTouched(true),
  };
}

/**
 * Enter on an invalid value: show the error and keep the editor open. The
 * listener is native so it runs before AG Grid's own Enter handling (which
 * would otherwise end the edit first).
 */
export function useBlockInvalidEnter(inputRef: RefObject<HTMLElement>, invalid: boolean, onBlocked: () => void) {
  const state = useRef({ invalid, onBlocked });
  state.current = { invalid, onBlocked };
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Enter" || !state.current.invalid) return;
      event.preventDefault();
      event.stopPropagation();
      state.current.onBlocked();
    };
    el.addEventListener("keydown", onKeyDown);
    return () => el.removeEventListener("keydown", onKeyDown);
  }, [inputRef]);
}

type Surface = UiEditorProps["surface"];

/**
 * Mantine input props for an editor's surface. In a grid cell the input is
 * borderless and fills the cell (the grid draws the editing ring); an
 * error there is a red inset ring plus an alert icon (the message is the
 * input's `aria-errormessage`) because the cell clips anything below it.
 * Everywhere else (popup card, forms) the input is a regular field with the
 * message as 12px red helper text directly below.
 */
export function useSurfaceInputProps(surface: Surface, error: string | undefined) {
  const descriptionId = useId();
  if (surface !== "cell") {
    return { props: { error, size: "sm" as const }, extra: null };
  }
  const input: CSSProperties = {
    height: "100%",
    minHeight: 0,
    padding: "0 var(--ag-cell-horizontal-padding, 12px)",
    fontSize: "var(--mantine-font-size-sm, 13px)",
    background: error ? "color-mix(in srgb, var(--mantine-color-error) 8%, transparent)" : "transparent",
    outline: error ? "1.5px solid var(--mantine-color-error)" : undefined,
    outlineOffset: -3,
    borderRadius: 4,
  };
  const root: CSSProperties = { height: "100%" };
  return {
    props: {
      variant: "unstyled" as const,
      // `true` (not the message): marks the input invalid without a helper line the cell would clip.
      error: error ? true : undefined,
      "aria-errormessage": error ? descriptionId : undefined,
      styles: { root, wrapper: { height: "100%" }, input },
      rightSection: error ? <IconAlertCircle size={16} stroke={1.75} color="var(--mantine-color-error)" aria-hidden /> : undefined,
      rightSectionPointerEvents: "none" as const,
      className: "sg-ed-cell-input",
    },
    extra: error ? <VisuallyHidden id={descriptionId}>{error}</VisuallyHidden> : null,
  };
}
