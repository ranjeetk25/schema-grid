import { Box, Button, Group, Menu, Stack, Text, TextInput } from "@mantine/core";
import { IconCheck, IconChevronDown, IconDeviceFloppy, IconPencil, IconPlus, IconTrash } from "../internal/icons";
import { type FormEvent, useEffect, useRef, useState } from "react";
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

type Mode = { kind: "list" } | { kind: "create" } | { kind: "rename"; id: string } | { kind: "delete"; id: string };

const ICON = { size: 16, stroke: 1.75 } as const;

function NameForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: string;
  submitLabel: string;
  onSubmit(name: string): void;
  onCancel(): void;
}) {
  const [name, setName] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);
  const trimmed = name.trim();
  useEffect(() => {
    const el = inputRef.current;
    el?.focus();
    el?.select();
  }, []);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (trimmed) onSubmit(trimmed);
  };
  return (
    <form onSubmit={submit} style={{ padding: 4 }}>
      <Stack gap={8}>
        <TextInput
          ref={inputRef}
          aria-label="View name"
          placeholder="View name"
          size="xs"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          // Keep Menu's list keyboard handling away from typing.
          onKeyDown={(e) => {
            if (e.key !== "Escape") e.stopPropagation();
          }}
        />
        <Group gap={6} justify="flex-end">
          <Button size="xs" variant="subtle" color="gray" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="xs" type="submit" disabled={!trimmed}>
            {submitLabel}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

/**
 * Linear-style saved-view switcher: a subtle button with the view name and a
 * chevron (a small accent dot marks unsaved changes). The menu lists the
 * views (check on the active one), then "Save changes", "Save as new view",
 * "Rename" and, apart, "Delete". Naming and delete confirmation happen inline
 * in the same menu — no modal.
 */
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
  const [opened, setOpened] = useState(false);
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const active = views.find((v) => v.id === activeViewId) ?? null;
  const close = () => {
    setOpened(false);
    setMode({ kind: "list" });
  };
  const nameOf = (id: string) => views.find((v) => v.id === id)?.name ?? "";

  return (
    <Menu
      opened={opened}
      onChange={(o) => {
        setOpened(o);
        if (!o) setMode({ kind: "list" });
      }}
      position="bottom-start"
      withinPortal={false}
      offset={6}
      width={mode.kind === "list" ? 240 : 280}
    >
      <Menu.Target>
        <Button
          variant="subtle"
          color="gray"
          rightSection={
            <Group gap={6} wrap="nowrap">
              {dirty ? (
                <Box
                  component="span"
                  data-testid="view-dirty-dot"
                  aria-label="Unsaved changes"
                  role="img"
                  w={6}
                  h={6}
                  style={{ borderRadius: "50%", background: "var(--mantine-primary-color-filled)" }}
                />
              ) : null}
              <IconChevronDown size={14} stroke={1.75} aria-hidden style={{ color: "var(--mantine-color-dimmed)" }} />
            </Group>
          }
          styles={{ root: { paddingInline: 10, fontWeight: 500, color: "var(--mantine-color-text)" }, section: { marginInlineStart: 6 } }}
        >
          {active?.name ?? "Views"}
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        {mode.kind === "list" ? (
          <>
            <Menu.Label>Views</Menu.Label>
            {views.map((v) => {
              const isActive = v.id === activeViewId;
              return (
                <Menu.Item
                  key={v.id}
                  data-active={isActive ? "true" : undefined}
                  rightSection={
                    isActive ? <IconCheck {...ICON} aria-hidden style={{ color: "var(--mantine-primary-color-filled)" }} /> : null
                  }
                  onClick={() => onSelect(v.id)}
                  fw={isActive ? 500 : undefined}
                >
                  {v.name}
                </Menu.Item>
              );
            })}
            <Menu.Divider />
            <Menu.Item leftSection={<IconDeviceFloppy {...ICON} />} disabled={!dirty || !active} onClick={onSaveCurrent}>
              Save changes
            </Menu.Item>
            <Menu.Item leftSection={<IconPlus {...ICON} />} closeMenuOnClick={false} onClick={() => setMode({ kind: "create" })}>
              Save as new view
            </Menu.Item>
            <Menu.Item
              leftSection={<IconPencil {...ICON} />}
              disabled={!active}
              closeMenuOnClick={false}
              onClick={() => active && setMode({ kind: "rename", id: active.id })}
            >
              Rename
            </Menu.Item>
            <Menu.Divider />
            <Menu.Item
              color="red"
              leftSection={<IconTrash {...ICON} />}
              disabled={!active || views.length <= 1}
              closeMenuOnClick={false}
              onClick={() => active && setMode({ kind: "delete", id: active.id })}
            >
              Delete
            </Menu.Item>
          </>
        ) : null}

        {mode.kind === "create" ? (
          <>
            <Menu.Label>Save as new view</Menu.Label>
            <NameForm
              initial=""
              submitLabel="Save"
              onCancel={() => setMode({ kind: "list" })}
              onSubmit={(name) => {
                onCreate(name);
                close();
              }}
            />
          </>
        ) : null}

        {mode.kind === "rename" ? (
          <>
            <Menu.Label>Rename view</Menu.Label>
            <NameForm
              initial={nameOf(mode.id)}
              submitLabel="Save"
              onCancel={() => setMode({ kind: "list" })}
              onSubmit={(name) => {
                onRename(mode.id, name);
                close();
              }}
            />
          </>
        ) : null}

        {mode.kind === "delete" ? (
          <Stack gap={10} p={8}>
            <Text size="sm">{`Delete "${nameOf(mode.id)}"? This cannot be undone.`}</Text>
            <Group gap={6} justify="flex-end">
              <Button size="xs" variant="subtle" color="gray" onClick={() => setMode({ kind: "list" })}>
                Cancel
              </Button>
              <Button
                size="xs"
                color="red"
                data-autofocus
                onClick={() => {
                  onDelete(mode.id);
                  close();
                }}
              >
                Delete
              </Button>
            </Group>
          </Stack>
        ) : null}
      </Menu.Dropdown>
    </Menu>
  );
}
