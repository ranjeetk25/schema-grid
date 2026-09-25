import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useRef } from "react";
import { SG_PORTAL, cn } from "../lib/cn";
import { Button } from "../ui/button";
import { Tooltip } from "../ui/tooltip";
import { type ColumnBuilderProps, ColumnFormBody, ColumnFormFooter, useColumnBuilder } from "./ColumnForm";
import { useOpenKey } from "./open-key";

export type ColumnPanelProps = ColumnBuilderProps & {
  /** Panel width in px (default 420). */
  width?: number;
  /** Portal container (defaults to document.body). */
  container?: HTMLElement | null;
};

/**
 * Airtable/Notion-style right-side panel for creating or editing a column.
 * Non-modal: the grid behind stays visible and interactive (pair it with
 * `onDraftChange` for a live preview column). Esc closes, asking first when
 * the draft has unsaved changes.
 */
export function ColumnPanel(props: ColumnPanelProps) {
  const { opened, column } = props;
  const key = useOpenKey(opened, column?.id);
  const requestClose = useRef<() => void>(props.onClose);

  return (
    <DialogPrimitive.Root
      open={opened}
      modal={false}
      onOpenChange={(next) => {
        if (!next) requestClose.current();
      }}
    >
      {opened ? <PanelBody key={key} {...props} requestCloseRef={requestClose} /> : null}
    </DialogPrimitive.Root>
  );
}

function PanelBody({ requestCloseRef, width = 420, container, ...props }: ColumnPanelProps & { requestCloseRef: { current: () => void } }) {
  const state = useColumnBuilder(props);
  requestCloseRef.current = state.requestClose;

  return (
    <DialogPrimitive.Portal container={container}>
      <DialogPrimitive.Content
        aria-describedby={undefined}
        data-slot="column-panel"
        style={{ width }}
        className={cn(
          SG_PORTAL,
          "sg:fixed sg:inset-y-0 sg:right-0 sg:z-40 sg:flex sg:max-w-full sg:flex-col sg:border-l sg:border-border sg:bg-background sg:text-foreground sg:shadow-popover sg:outline-none",
          "sg:transition-[translate,opacity] sg:duration-[180ms] sg:ease-out sg:starting:translate-x-4 sg:starting:opacity-0",
        )}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          state.nameRef.current?.focus();
        }}
        // Working in the grid (or a portalled picker) must not close the panel.
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => {
          e.preventDefault();
          state.requestClose();
        }}
      >
        <header className="sg:flex sg:h-14 sg:shrink-0 sg:items-center sg:justify-between sg:gap-3 sg:border-b sg:border-border sg:px-5">
          <DialogPrimitive.Title className="sg:truncate sg:text-lg sg:font-semibold sg:tracking-[-0.01em]">
            {state.editing ? "Edit column" : "New column"}
          </DialogPrimitive.Title>
          <Tooltip content="Close" shortcut="Esc">
            <Button variant="subtle" size="icon-sm" aria-label="Close" onClick={state.requestClose}>
              <X />
            </Button>
          </Tooltip>
        </header>
        <div className="sg:min-h-0 sg:flex-1 sg:overflow-y-auto sg:px-5 sg:py-5">
          <ColumnFormBody state={state} props={props} />
        </div>
        <footer className="sg:flex sg:min-h-14 sg:shrink-0 sg:items-center sg:border-t sg:border-border sg:bg-subtle sg:px-5 sg:py-3">
          <ColumnFormFooter state={state} props={props} />
        </footer>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
