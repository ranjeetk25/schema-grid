import { type RefObject, useLayoutEffect, useRef, useState } from "react";
import { toPopupGridEditor } from "../internal/grid-contracts";
import type { UiEditorProps } from "../internal/grid-contracts";
import { SG_ROOT, cn } from "../lib/cn";
import { Textarea } from "../ui/textarea";
import { CardHint, EditorCard, FieldMessage } from "./EditorCard";
import { isGridMode, useAutoFocus, useNativeKeyDownRef } from "./useEditorKeys";

const MAX_HEIGHT = 240;

/** Grows the textarea with its content up to `MAX_HEIGHT`, then scrolls. */
function useAutosize(ref: RefObject<HTMLTextAreaElement | null>, text: string) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure whenever the text changes.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, MAX_HEIGHT);
    if (next > 0) el.style.height = `${next}px`;
  }, [ref, text]);
}

/** Multi-line text editor. Cmd/Ctrl+Enter commits, plain Enter inserts a newline, Escape cancels. */
export function LongTextEditor({ value, onChange, onCommit, onCancel, column, autoFocus, error, cellWidth }: UiEditorProps<string, unknown>) {
  const [text, setText] = useState(value ?? "");
  const ref = useRef<HTMLTextAreaElement>(null);
  const textRef = useRef(text);
  textRef.current = text;
  const gridMode = isGridMode(autoFocus);
  useAutoFocus(ref, autoFocus);
  useAutosize(ref, text);

  // Native: AG Grid would end the edit on Enter before React sees it.
  useNativeKeyDownRef(ref, (event) => {
    if (event.key !== "Enter") return;
    event.stopPropagation();
    if (event.metaKey || event.ctrlKey) {
      event.preventDefault();
      onCommit(textRef.current);
    }
    // Plain / Shift+Enter: the default action inserts the newline.
  });

  const textarea = (
    <Textarea
      ref={ref}
      value={text}
      rows={gridMode ? 4 : 3}
      aria-label={column.label || undefined}
      aria-invalid={error ? true : undefined}
      className={cn(
        "sg:resize-none sg:leading-5",
        gridMode && "sg:min-h-24 sg:rounded-none sg:border-0 sg:bg-transparent sg:px-3 sg:py-2.5 sg:shadow-none sg:focus-visible:ring-0",
      )}
      style={{ maxHeight: MAX_HEIGHT }}
      onChange={(event) => {
        const next = event.currentTarget.value;
        setText(next);
        onChange(next);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
      }}
    />
  );

  if (!gridMode) {
    return (
      <div className={cn(SG_ROOT, "sg:flex sg:w-full sg:flex-col sg:gap-1")}>
        {textarea}
        <FieldMessage>{error}</FieldMessage>
      </div>
    );
  }

  return (
    <EditorCard cellWidth={cellWidth} className="sg:w-[360px] sg:max-w-[calc(100vw-32px)]">
      {textarea}
      {error ? (
        <div className="sg:px-3 sg:pb-2">
          <FieldMessage>{error}</FieldMessage>
        </div>
      ) : null}
      <CardHint>
        <span>↵ new line</span>
        <span aria-hidden>·</span>
        <span>⌘↵ save</span>
        <span aria-hidden>·</span>
        <span>esc cancel</span>
      </CardHint>
    </EditorCard>
  );
}

export const LongTextPopupEditor = toPopupGridEditor(LongTextEditor);
