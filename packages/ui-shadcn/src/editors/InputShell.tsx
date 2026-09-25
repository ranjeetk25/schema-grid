import { type ReactNode, useEffect, useId, useRef } from "react";
import { SG_ROOT, cn } from "../lib/cn";

export interface InputShellProps {
  gridMode: boolean;
  /** Validation / error text. Rendered under the input, never as a tooltip. */
  message?: string;
  /** Leading adornment inside the field (e.g. a currency symbol). */
  prefix?: ReactNode;
  children(ids: { messageId: string | undefined; invalid: boolean }): ReactNode;
}

/**
 * Wraps a single-line editor input.
 *
 * - Form / filter mode: a bordered 32px field with the message under it.
 * - Grid mode (in-cell): the input fills the cell; a message is attached
 *   directly under the cell as part of the editor (a flush card sharing the
 *   cell's edge), so it is readable without leaving the cell. The cell's
 *   `overflow` is opened while the message shows so it is never clipped.
 */
export function InputShell({ gridMode, message, prefix, children }: InputShellProps) {
  const id = useId();
  const messageId = message ? `${id}-msg` : undefined;
  const rootRef = useRef<HTMLDivElement>(null);
  const invalid = Boolean(message);

  useEffect(() => {
    if (!gridMode || !invalid) return;
    const cell = rootRef.current?.closest<HTMLElement>(".ag-cell");
    if (!cell) return;
    const previous = cell.style.overflow;
    cell.style.overflow = "visible";
    return () => {
      cell.style.overflow = previous;
    };
  }, [gridMode, invalid]);

  if (!gridMode) {
    return (
      <div ref={rootRef} className={cn(SG_ROOT, "sg:flex sg:w-full sg:min-w-0 sg:flex-col sg:gap-1")}>
        <div className="sg:relative sg:flex sg:w-full sg:items-center">
          {prefix ? (
            <span className="sg:pointer-events-none sg:absolute sg:left-2.5 sg:text-sm sg:text-muted-foreground sg:tabular-nums">{prefix}</span>
          ) : null}
          {children({ messageId, invalid })}
        </div>
        {message ? (
          <p id={messageId} role="alert" className="sg:text-xs sg:leading-4 sg:text-danger">
            {message}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div ref={rootRef} className={cn(SG_ROOT, "sg:relative sg:flex sg:h-full sg:w-full sg:items-center sg:bg-background")}>
      {prefix ? <span className="sg:pointer-events-none sg:pl-2 sg:text-sm sg:text-muted-foreground sg:tabular-nums">{prefix}</span> : null}
      {children({ messageId, invalid })}
      {message ? (
        <p
          id={messageId}
          role="alert"
          className={cn(
            "sg-inline-editor-message sg:absolute sg:top-full sg:-left-px sg:z-10 sg:min-w-[calc(100%+2px)] sg:max-w-80",
            "sg:rounded-b-md sg:bg-popover sg:px-2 sg:py-1.5 sg:text-xs sg:leading-4 sg:text-danger sg:shadow-popover",
          )}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
