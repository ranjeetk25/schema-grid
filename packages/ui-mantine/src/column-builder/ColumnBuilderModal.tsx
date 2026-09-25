import { Alert, Button, Group, Modal, Stepper, Text } from "@mantine/core";
import { useMemo, useReducer, useRef, useState } from "react";
import type { AccessMap } from "../internal/access";
import type { ColumnDef, DataSource, FieldTypeRegistry, GridSchema } from "../internal/core-contracts";
import type { UiFieldTypeRegistry } from "../internal/grid-contracts";
import { ConfigStep } from "./ConfigStep";
import { buildColumnDef, columnDraftReducer, createColumnDraft, validateColumnDraft } from "./model";
import { PermissionsStep, permissionsError } from "./PermissionsStep";
import { PreviewStep } from "./PreviewStep";
import { TypeStep } from "./TypeStep";

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
  onSave(column: ColumnDef): void;
  onDelete?(columnId: string): void;
  now?: () => Date | string;
  generateId?: () => string;
  dataSource?: DataSource;
}

const STEP_TYPE = 0;
const STEP_CONFIG = 1;
const STEP_PREVIEW = 3;

const defaultId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `col_${Date.now().toString(36)}`;

const toIso = (v: Date | string) => (typeof v === "string" ? v : v.toISOString());

/** Stepper modal (Type → Config → Permissions → Preview) that emits a full ColumnDef. */
export function ColumnBuilderModal(props: ColumnBuilderModalProps) {
  const { opened, onClose, column } = props;
  const editing = !!column;
  // A fresh body (and draft) each time the modal opens or the target column id changes.
  // Keyed on the id (not the object) so a host re-fetch with an equal column keeps the draft.
  const openCount = useRef(0);
  const wasOpen = useRef(false);
  if (opened && !wasOpen.current) openCount.current += 1;
  wasOpen.current = opened;

  return (
    <Modal opened={opened} onClose={onClose} size="xl" title={editing ? `Edit column "${column?.label ?? ""}"` : "Add column"}>
      <ModalBody key={`${openCount.current}:${column?.id ?? "new"}`} {...props} />
    </Modal>
  );
}

function ModalBody({
  schema,
  registry,
  uiRegistry,
  access,
  roles,
  column,
  onSave,
  onDelete,
  onClose,
  now,
  generateId = defaultId,
  dataSource,
}: ColumnBuilderModalProps) {
  const editing = !!column;
  const [draft, dispatch] = useReducer(columnDraftReducer, undefined, () =>
    createColumnDraft({ schema, registry, column }),
  );
  const [active, setActive] = useState(editing ? STEP_CONFIG : STEP_TYPE);
  const [formulaValid, setFormulaValid] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const errors = useMemo(() => validateColumnDraft(draft, { schema, registry }), [draft, schema, registry]);
  const configValid =
    !errors.label && !errors.key && !errors.config && !errors.type && (draft.type !== "formula" || formulaValid);
  const permsError = permissionsError(draft.permissions);

  const stepValid = [draft.type !== null, configValid, permsError === null, true];
  const canNext = stepValid[active] === true;
  const reachable = (step: number) => stepValid.slice(0, step).every(Boolean);

  const saving = useRef(false);
  const save = () => {
    if (saving.current) return;
    try {
      const def = buildColumnDef(draft, {
        schema,
        registry,
        now: toIso(now ? now() : new Date()),
        generateId,
      });
      saving.current = true;
      onSave(def);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Could not build the column");
    }
  };

  // Hide the "Label is required" nag until the user has typed or tried to proceed.
  const [touched, setTouched] = useState(editing);
  const visibleErrors = touched ? errors : { ...errors, label: undefined, key: undefined, config: undefined };

  return (
    <>
      <Stepper
        active={active}
        onStepClick={(step) => {
          if (step === STEP_TYPE && editing) return;
          if (reachable(step)) setActive(step);
        }}
        size="sm"
        allowNextStepsSelect={false}
      >
        <Stepper.Step label="Type" description={editing ? "Locked" : undefined}>
          <TypeStep
            registry={registry}
            value={draft.type}
            locked={editing}
            onChange={(fieldType) => dispatch({ type: "setType", fieldType, registry })}
          />
        </Stepper.Step>
        <Stepper.Step label="Config">
          <div onInput={() => setTouched(true)}>
            <ConfigStep
              draft={draft}
              dispatch={dispatch}
              schema={schema}
              registry={registry}
              uiRegistry={uiRegistry}
              access={access}
              errors={visibleErrors}
              onFormulaValidityChange={setFormulaValid}
              dataSource={dataSource}
            />
          </div>
        </Stepper.Step>
        <Stepper.Step label="Permissions">
          <PermissionsStep
            value={draft.permissions}
            roles={roles}
            onChange={(permissions) => dispatch({ type: "setPermissions", permissions })}
          />
        </Stepper.Step>
        <Stepper.Step label="Preview">
          <PreviewStep draft={draft} registry={registry} uiRegistry={uiRegistry} />
        </Stepper.Step>
      </Stepper>

      {saveError && (
        <Alert color="red" mt="md">
          {saveError}
        </Alert>
      )}

      {confirmDelete && column && onDelete && (
        <Alert color="red" mt="md" title="Delete this column?">
          <Text size="sm">Its data will be removed for everyone. This cannot be undone.</Text>
          <Group mt="sm" gap="xs">
            <Button size="xs" variant="default" onClick={() => setConfirmDelete(false)}>
              Keep column
            </Button>
            <Button size="xs" color="red" onClick={() => onDelete(column.id)}>
              Confirm delete
            </Button>
          </Group>
        </Alert>
      )}

      <Group justify="space-between" mt="lg">
        <Group gap="xs">
          {editing && onDelete && !confirmDelete && (
            <Button variant="subtle" color="red" onClick={() => setConfirmDelete(true)}>
              Delete column
            </Button>
          )}
        </Group>
        <Group gap="xs">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          {active > (editing ? STEP_CONFIG : STEP_TYPE) && (
            <Button variant="default" onClick={() => setActive((s) => s - 1)}>
              Back
            </Button>
          )}
          {active < STEP_PREVIEW ? (
            <Button
              // Config keeps Next clickable so a click can reveal why it cannot proceed.
              disabled={!canNext && active !== STEP_CONFIG}
              onClick={() => {
                setTouched(true);
                if (canNext) setActive((s) => s + 1);
              }}
            >
              Next
            </Button>
          ) : (
            <Button onClick={save} disabled={!stepValid.every(Boolean)}>
              Save column
            </Button>
          )}
        </Group>
      </Group>
    </>
  );
}

