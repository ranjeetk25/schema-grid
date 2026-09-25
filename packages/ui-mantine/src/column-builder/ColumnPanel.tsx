import { Button, CloseButton, Drawer, Group, Text } from "@mantine/core";
import { useRef, useState } from "react";
import { useEditorStyles } from "../editors/EditorCard";
import type { AccessMap } from "../internal/access";
import type { ColumnDef, DataSource, FieldTypeRegistry, GridRow, GridSchema } from "../internal/core-contracts";
import type { UiFieldTypeRegistry } from "../internal/grid-contracts";
import { ColumnForm, type ColumnInsertPosition } from "./ColumnForm";

export interface ColumnPanelProps {
  opened: boolean;
  onClose(): void;
  schema: GridSchema;
  registry: FieldTypeRegistry;
  uiRegistry: UiFieldTypeRegistry;
  access: AccessMap;
  roles: string[];
  /** Edit mode when set. */
  column?: ColumnDef | null;
  /** Create mode: where the new column goes (index, or next to a column). Passed back to `onSave`. */
  position?: ColumnInsertPosition;
  /** Rows for live previews (the formula preview evaluates the first 3). */
  sampleRows?: readonly GridRow[];
  onSave(column: ColumnDef, position?: ColumnInsertPosition): void;
  onDelete?(columnId: string): void;
  /** The in-progress column (debounced ~150ms), `null` when it can't be built or the panel closes — for a ghost column in the grid. */
  onDraftChange?(draft: ColumnDef | null): void;
  dataSource?: DataSource;
  now?: () => Date | string;
  generateId?: () => string;
  /** @default 420 */
  size?: number | string;
}

/**
 * Right-hand column panel (create / edit). The grid stays visible and usable
 * beside it (no overlay, no scroll lock). One scrolling form plus a sticky
 * footer; Escape or × closes, asking first when there are unsaved changes.
 */
export function ColumnPanel(props: ColumnPanelProps) {
  const { opened, onClose, column, size = 420 } = props;
  useEditorStyles();
  const editing = !!column;
  const [dirty, setDirty] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // A fresh form each time the panel opens or targets another column.
  const openCount = useRef(0);
  const wasOpen = useRef(false);
  if (opened && !wasOpen.current) openCount.current += 1;
  wasOpen.current = opened;

  const requestClose = () => {
    if (dirty) setConfirmDiscard(true);
    else onClose();
  };
  const close = () => {
    setConfirmDiscard(false);
    setDirty(false);
    onClose();
  };
  const title = editing ? `Edit column · ${column?.label ?? ""}` : "New column";

  return (
    <Drawer.Root
      opened={opened}
      onClose={requestClose}
      position="right"
      size={size}
      lockScroll={false}
      trapFocus
      returnFocus
      closeOnEscape
      transitionProps={{ transition: "slide-left", duration: 180, timingFunction: "ease-out" }}
    >
      <Drawer.Content
        styles={{
          content: {
            display: "flex",
            flexDirection: "column",
            borderLeft: "1px solid var(--mantine-color-default-border)",
            boxShadow: "var(--mantine-shadow-lg)",
            overflow: "hidden",
          },
        }}
      >
        <Drawer.Header px="lg" py="sm" style={{ borderBottom: "1px solid var(--mantine-color-default-border)", minHeight: 52 }}>
          <Drawer.Title fz={16} fw={600} style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {title}
          </Drawer.Title>
          <CloseButton aria-label="Close panel" onClick={requestClose} />
        </Drawer.Header>
        {confirmDiscard && (
          <Group
            role="alertdialog"
            aria-label="Discard changes?"
            justify="space-between"
            px="lg"
            py={8}
            gap="xs"
            wrap="nowrap"
            style={{ background: "var(--mantine-color-default-hover)", borderBottom: "1px solid var(--mantine-color-default-border)" }}
          >
            <Text size="sm">Discard unsaved changes?</Text>
            <Group gap={6} wrap="nowrap">
              <Button size="xs" variant="subtle" color="gray" onClick={() => setConfirmDiscard(false)}>
                Keep editing
              </Button>
              <Button size="xs" color="red" variant="light" onClick={close} data-autofocus>
                Discard
              </Button>
            </Group>
          </Group>
        )}
        <Drawer.Body p={0} style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          {opened && (
            <ColumnForm
              key={`${openCount.current}:${column?.id ?? "new"}`}
              {...props}
              layout="panel"
              onCancel={requestClose}
              onDirtyChange={setDirty}
            />
          )}
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}
