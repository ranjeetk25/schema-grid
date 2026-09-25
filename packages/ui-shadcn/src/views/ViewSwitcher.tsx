import { ChevronDownIcon, CopyPlusIcon, LayersIcon, PencilIcon, SaveIcon, Trash2Icon } from "lucide-react";
import { type FormEvent, useRef, useState } from "react";
import type { ViewDef } from "../internal/core-contracts";
import { SG_ROOT, cn } from "../lib/cn";
import { Button } from "../ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Field } from "../ui/field";
import { Input } from "../ui/input";

export interface ViewSwitcherProps {
  views: ViewDef[];
  activeViewId: string | null;
  dirty: boolean;
  onSelect(id: string): void;
  onCreate(name: string): void;
  onRename(id: string, name: string): void;
  onDelete(id: string): void;
  onSaveCurrent(): void;
  /** Render the menu in place instead of portalling. */
  portalled?: boolean;
  className?: string;
}

type DialogState = { kind: "create" } | { kind: "rename"; id: string } | { kind: "delete"; id: string } | null;

/** Visual ellipsis for items that open a dialog; hidden from the accessible name. */
const Ellipsis = () => <span aria-hidden>…</span>;

function NameDialog({
  title,
  description,
  initial,
  onSubmit,
  onClose,
}: {
  title: string;
  description?: string;
  initial: string;
  onSubmit(name: string): void;
  onClose(): void;
}) {
  const [name, setName] = useState(initial);
  const trimmed = name.trim();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!trimmed) return;
    onSubmit(trimmed);
    onClose();
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="sm" {...(description ? {} : { "aria-describedby": undefined })}>
        <form onSubmit={submit} className="sg:flex sg:min-h-0 sg:flex-col">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>
          <DialogBody>
            <Field label="View name">
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  aria-invalid={invalid || undefined}
                  value={name}
                  maxLength={120}
                  autoFocus
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => setName(e.currentTarget.value)}
                />
              )}
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!trimmed}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({ name, onConfirm, onClose }: { name: string; onConfirm(): void; onClose(): void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Delete view</DialogTitle>
          <DialogDescription className="sg:text-base">{`Delete "${name}"? This cannot be undone.`}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} autoFocus>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Saved-view menu: pick, save changes, save as new, rename, delete (confirmed). */
export function ViewSwitcher({
  views,
  activeViewId,
  dirty,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onSaveCurrent,
  portalled = true,
  className,
}: ViewSwitcherProps) {
  const [dialog, setDialog] = useState<DialogState>(null);
  const openingDialog = useRef(false);
  const active = views.find((v) => v.id === activeViewId) ?? null;
  const close = () => setDialog(null);
  const openDialog = (d: DialogState) => {
    openingDialog.current = true;
    setDialog(d);
  };

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" className={cn(SG_ROOT, "sg:max-w-64", className)}>
            <LayersIcon aria-hidden className="sg:size-4 sg:text-muted-foreground" />
            <span className="sg:truncate">{active?.name ?? "Views"}</span>
            {dirty ? (
              <span
                data-testid="view-dirty-dot"
                role="img"
                aria-label="Unsaved changes"
                className="sg:size-1.5 sg:shrink-0 sg:rounded-full sg:bg-primary"
              />
            ) : null}
            <ChevronDownIcon aria-hidden className="sg:size-3.5 sg:text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          portalled={portalled}
          className="sg:w-60"
          onCloseAutoFocus={(e) => {
            // let the dialog take focus instead of the trigger
            if (openingDialog.current) {
              e.preventDefault();
              openingDialog.current = false;
            }
          }}
        >
          <DropdownMenuLabel>Views</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={activeViewId ?? ""} onValueChange={onSelect}>
            {views.map((v) => (
              <DropdownMenuRadioItem key={v.id} value={v.id} data-active={v.id === activeViewId ? "true" : undefined}>
                <span className="sg:truncate">{v.name}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!dirty || !active} onSelect={onSaveCurrent}>
            <SaveIcon aria-hidden />
            Save changes
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => openDialog({ kind: "create" })}>
            <CopyPlusIcon aria-hidden />
            Save as new view
            <Ellipsis />
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!active} onSelect={() => active && openDialog({ kind: "rename", id: active.id })}>
            <PencilIcon aria-hidden />
            Rename
            <Ellipsis />
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="danger"
            disabled={!active || views.length <= 1}
            onSelect={() => active && openDialog({ kind: "delete", id: active.id })}
          >
            <Trash2Icon aria-hidden />
            Delete
            <Ellipsis />
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {dialog?.kind === "create" && (
        <NameDialog
          title="Save as new view"
          description="Saves the current filters, sorting, grouping and columns."
          initial=""
          onSubmit={onCreate}
          onClose={close}
        />
      )}
      {dialog?.kind === "rename" && (
        <NameDialog
          title="Rename view"
          initial={views.find((v) => v.id === dialog.id)?.name ?? ""}
          onSubmit={(name) => onRename(dialog.id, name)}
          onClose={close}
        />
      )}
      {dialog?.kind === "delete" && (
        <DeleteDialog name={views.find((v) => v.id === dialog.id)?.name ?? ""} onConfirm={() => onDelete(dialog.id)} onClose={close} />
      )}
    </>
  );
}
