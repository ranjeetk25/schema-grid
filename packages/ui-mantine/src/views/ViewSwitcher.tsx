import { Box, Button, Group, Menu, Modal, Text, TextInput } from "@mantine/core";
import { type FormEvent, useState } from "react";
import type { ViewDef } from "../internal/core-contracts";

export interface ViewSwitcherProps {
  views: ViewDef[];
  activeViewId: string | null;
  dirty: boolean;
  onSelect(id: string): void;
  onCreate(name: string): void;
  onRename(id: string, name: string): void;
  onDelete(id: string): void;
  onSaveCurrent(): void;
}

type Dialog = { kind: "create" } | { kind: "rename"; id: string } | { kind: "delete"; id: string } | null;

function NameDialog({
  title,
  initial,
  onSubmit,
  onClose,
}: {
  title: string;
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
    <Modal opened onClose={onClose} title={title} size="sm">
      <form onSubmit={submit}>
        <TextInput label="View name" value={name} onChange={(e) => setName(e.currentTarget.value)} data-autofocus />
        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!trimmed}>
            Save
          </Button>
        </Group>
      </form>
    </Modal>
  );
}

/** Saved-view menu: pick, save changes, save as new, rename, delete. */
export function ViewSwitcher({
  views,
  activeViewId,
  dirty,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onSaveCurrent,
}: ViewSwitcherProps) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const active = views.find((v) => v.id === activeViewId) ?? null;
  const close = () => setDialog(null);

  return (
    <>
      <Menu position="bottom-start" withinPortal={false} shadow="md">
        <Menu.Target>
          <Button variant="default" rightSection={dirty ? <Box data-testid="view-dirty-dot" aria-label="Unsaved changes" w={8} h={8} bg="orange" style={{ borderRadius: "50%" }} /> : null}>
            {active?.name ?? "Views"}
          </Button>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Label>Views</Menu.Label>
          {views.map((v) => (
            <Menu.Item
              key={v.id}
              data-active={v.id === activeViewId ? "true" : undefined}
              leftSection={<Text w={12} size="sm">{v.id === activeViewId ? "✓" : ""}</Text>}
              onClick={() => onSelect(v.id)}
            >
              {v.name}
            </Menu.Item>
          ))}
          <Menu.Divider />
          <Menu.Item disabled={!dirty || !active} onClick={onSaveCurrent}>
            Save changes
          </Menu.Item>
          <Menu.Item onClick={() => setDialog({ kind: "create" })}>Save as new view</Menu.Item>
          <Menu.Item disabled={!active} onClick={() => active && setDialog({ kind: "rename", id: active.id })}>
            Rename
          </Menu.Item>
          <Menu.Item
            color="red"
            disabled={!active || views.length <= 1}
            onClick={() => active && setDialog({ kind: "delete", id: active.id })}
          >
            Delete
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>

      {dialog?.kind === "create" && <NameDialog title="Save as new view" initial="" onSubmit={onCreate} onClose={close} />}
      {dialog?.kind === "rename" && (
        <NameDialog
          title="Rename view"
          initial={views.find((v) => v.id === dialog.id)?.name ?? ""}
          onSubmit={(name) => onRename(dialog.id, name)}
          onClose={close}
        />
      )}
      {dialog?.kind === "delete" && (
        <Modal opened onClose={close} title="Delete view" size="sm">
          <Text size="sm">{`Delete "${views.find((v) => v.id === dialog.id)?.name ?? ""}"? This cannot be undone.`}</Text>
          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={close}>
              Cancel
            </Button>
            <Button
              color="red"
              onClick={() => {
                onDelete(dialog.id);
                close();
              }}
            >
              Delete
            </Button>
          </Group>
        </Modal>
      )}
    </>
  );
}
