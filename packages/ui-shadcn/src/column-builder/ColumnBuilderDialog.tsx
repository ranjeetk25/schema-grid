import { useRef } from "react";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { type ColumnBuilderProps, ColumnFormBody, ColumnFormFooter, useColumnBuilder } from "./ColumnForm";
import { useOpenKey } from "./open-key";

export type ColumnBuilderDialogProps = ColumnBuilderProps;
/** ui-mantine parity name. */
export type ColumnBuilderModalProps = ColumnBuilderProps;

/** The column form in a centred modal dialog, for hosts that prefer modal use over `ColumnPanel`. */
export function ColumnBuilderDialog(props: ColumnBuilderDialogProps) {
  const { opened, column } = props;
  const key = useOpenKey(opened, column?.id);
  const requestClose = useRef<() => void>(props.onClose);

  return (
    <Dialog
      open={opened}
      onOpenChange={(next) => {
        if (!next) requestClose.current();
      }}
    >
      {opened ? <DialogBodyInner key={key} {...props} requestCloseRef={requestClose} /> : null}
    </Dialog>
  );
}

function DialogBodyInner({ requestCloseRef, ...props }: ColumnBuilderDialogProps & { requestCloseRef: { current: () => void } }) {
  const state = useColumnBuilder(props);
  requestCloseRef.current = state.requestClose;
  const label = props.column?.label;

  return (
    <DialogContent
      size="lg"
      onOpenAutoFocus={(e) => {
        e.preventDefault();
        state.nameRef.current?.focus();
      }}
      onEscapeKeyDown={(e) => {
        e.preventDefault();
        state.requestClose();
      }}
      onInteractOutside={(e) => {
        e.preventDefault();
        state.requestClose();
      }}
    >
      <DialogHeader>
        <DialogTitle>{state.editing ? "Edit column" : "New column"}</DialogTitle>
        <DialogDescription>
          {state.editing && label ? `Changes to “${label}” apply for everyone.` : "Name it, pick a type, and choose who can see it."}
        </DialogDescription>
      </DialogHeader>
      <DialogBody>
        <ColumnFormBody state={state} props={props} />
      </DialogBody>
      <DialogFooter>
        <ColumnFormFooter state={state} props={props} />
      </DialogFooter>
    </DialogContent>
  );
}

/** Alias of `ColumnBuilderDialog` (ui-mantine API parity). */
export const ColumnBuilderModal = ColumnBuilderDialog;
