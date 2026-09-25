import { Modal } from "@mantine/core";
import { useRef } from "react";
import type { AccessMap } from "../internal/access";
import type { ColumnDef, DataSource, FieldTypeRegistry, GridRow, GridSchema } from "../internal/core-contracts";
import type { UiFieldTypeRegistry } from "../internal/grid-contracts";
import { ColumnForm, type ColumnInsertPosition } from "./ColumnForm";

export interface ColumnBuilderModalProps {
  opened: boolean;
  onClose(): void;
  schema: GridSchema;
  registry: FieldTypeRegistry;
  uiRegistry: UiFieldTypeRegistry;
  access: AccessMap;
  roles: string[];
  /** Edit mode when set. */
  column?: ColumnDef | null;
  /** Create mode: where the new column goes. Passed back to `onSave`. */
  position?: ColumnInsertPosition;
  /** Rows for live previews (formula preview). */
  sampleRows?: readonly GridRow[];
  onSave(column: ColumnDef, position?: ColumnInsertPosition): void;
  onDelete?(columnId: string): void;
  onDraftChange?(draft: ColumnDef | null): void;
  now?: () => Date | string;
  generateId?: () => string;
  dataSource?: DataSource;
}

/**
 * @deprecated Use `ColumnPanel` (a side panel that keeps the grid visible).
 * The same column form inside a modal, titled "Add column" / "Edit column".
 */
export function ColumnBuilderModal(props: ColumnBuilderModalProps) {
  const { opened, onClose, column } = props;
  // A fresh form (and draft) each time the modal opens or the target column id changes.
  // Keyed on the id (not the object) so a host re-fetch with an equal column keeps the draft.
  const openCount = useRef(0);
  const wasOpen = useRef(false);
  if (opened && !wasOpen.current) openCount.current += 1;
  wasOpen.current = opened;

  return (
    <Modal opened={opened} onClose={onClose} size={560} title={column ? "Edit column" : "Add column"}>
      <ColumnForm key={`${openCount.current}:${column?.id ?? "new"}`} {...props} layout="modal" onCancel={onClose} />
    </Modal>
  );
}
