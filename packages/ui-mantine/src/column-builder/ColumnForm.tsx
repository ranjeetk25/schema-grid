import {
  ActionIcon,
  Alert,
  Box,
  Button,
  Code,
  Collapse,
  Combobox,
  Group,
  Input,
  Stack,
  Switch,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
  useCombobox,
} from "@mantine/core";
import { IconCheck, IconChevronDown, IconChevronRight, IconLock, IconPencil, IconSearch } from "../internal/icons";
import { type ReactNode, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useEditorStyles } from "../editors/EditorCard";
import type { AccessMap } from "../internal/access";
import type { ColumnDef, DataSource, FieldTypeId, FieldTypeRegistry, GridRow, GridSchema } from "../internal/core-contracts";
import { type UiFieldTypeRegistry, resolveEditorComponent } from "../internal/grid-contracts";
import { draftAsColumn } from "./CommonFields";
import { fieldTypeMeta, sortFieldTypes } from "./fieldTypeMeta";
import { FormulaEditor } from "./FormulaEditor";
import { type ColumnDraft, buildColumnDef, columnDraftReducer, createColumnDraft, validateColumnDraft } from "./model";
import { AccessSection, accessSummary, permissionsError } from "./PermissionsStep";
import { ZodForm } from "./zod-form/ZodForm";
import { isPathTouched } from "./zod-form/humanizeZodIssue";

/** Where a new column goes: an index in display order, or next to an existing column. */
export type ColumnInsertPosition = number | { afterColumnId: string } | { beforeColumnId: string };

export interface ColumnFormProps {
  schema: GridSchema;
  registry: FieldTypeRegistry;
  uiRegistry: UiFieldTypeRegistry;
  access: AccessMap;
  roles: string[];
  /** Edit mode when set. */
  column?: ColumnDef | null;
  /** Create mode: where the new column is inserted (sets its `order`; also passed to `onSave`). */
  position?: ColumnInsertPosition;
  /** Rows for live previews (the formula preview evaluates the first 3). */
  sampleRows?: readonly GridRow[];
  onSave(column: ColumnDef, position?: ColumnInsertPosition): void;
  onDelete?(columnId: string): void;
  onCancel(): void;
  /** The in-progress column (debounced ~150ms), or null while it can't be built; for a live ghost column. */
  onDraftChange?(draft: ColumnDef | null): void;
  /** Reports whether the form differs from what it opened with. */
  onDirtyChange?(dirty: boolean): void;
  now?: () => Date | string;
  generateId?: () => string;
  dataSource?: DataSource;
  /** "panel": fills its container with a scrolling body and a sticky footer. */
  layout?: "panel" | "modal";
}

const defaultId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `col_${Date.now().toString(36)}`;
const toIso = (v: Date | string) => (typeof v === "string" ? v : v.toISOString());

/** A display `order` for a new column at `position` (a midpoint between neighbours; fractional is fine). */
export function orderForPosition(schema: GridSchema, position: ColumnInsertPosition | undefined): number | undefined {
  if (position === undefined) return undefined;
  const sorted = [...schema.columns].sort((a, b) => a.order - b.order);
  let index: number;
  if (typeof position === "number") index = Math.max(0, Math.min(sorted.length, Math.floor(position)));
  else if ("afterColumnId" in position) {
    const i = sorted.findIndex((c) => c.id === position.afterColumnId);
    if (i === -1) return undefined;
    index = i + 1;
  } else {
    const i = sorted.findIndex((c) => c.id === position.beforeColumnId);
    if (i === -1) return undefined;
    index = i;
  }
  const prev = sorted[index - 1];
  const next = sorted[index];
  if (prev && next) return (prev.order + next.order) / 2;
  if (prev) return prev.order + 1;
  if (next) return next.order - 1;
  return 0;
}

/** Types whose settings are part of choosing the type (shown under it); others keep theirs in "More options". */
const PRIMARY_CONFIG_TYPES = new Set(["select", "multiSelect", "creatableSelect", "number", "currency", "date", "datetime", "link", "user"]);

const draftFingerprint = (d: ColumnDraft) =>
  JSON.stringify([d.type, d.label, d.key, d.config, d.required, d.defaultValue, d.indexed, d.permissions, d.formula]);

/** Builds the draft as a ColumnDef for previews (placeholder label/key while empty), or null when invalid. */
function previewColumn(draft: ColumnDraft, schema: GridSchema, registry: FieldTypeRegistry, position?: ColumnInsertPosition): ColumnDef | null {
  if (!draft.type) return null;
  try {
    const def = buildColumnDef(
      { ...draft, label: draft.label.trim() || "Untitled", key: draft.key || "__draft__" },
      { schema, registry, now: new Date(0).toISOString(), generateId: () => draft.original?.id ?? "__draft__" },
    );
    const order = draft.mode === "create" ? orderForPosition(schema, position) : undefined;
    return order === undefined ? def : { ...def, order };
  } catch {
    return null;
  }
}

/**
 * The column form shared by `ColumnPanel` (a right-hand side panel) and the
 * deprecated `ColumnBuilderModal`: one scrolling form in sections — Name
 * (with the derived key), Type (a searchable picker) and its settings,
 * Options (required, default value, indexed) and Who can access — plus a
 * footer with one primary action. Errors appear after a field is left, and
 * the primary button explains what is missing.
 */
export function ColumnForm({
  schema,
  registry,
  uiRegistry,
  access,
  roles,
  column,
  position,
  sampleRows,
  onSave,
  onDelete,
  onCancel,
  onDraftChange,
  onDirtyChange,
  now,
  generateId = defaultId,
  dataSource,
  layout = "panel",
}: ColumnFormProps) {
  useEditorStyles();
  const editing = !!column;
  const [draft, dispatch] = useReducer(columnDraftReducer, undefined, () =>
    createColumnDraft({ schema, registry, column, initialType: column ? undefined : "text" }),
  );
  const initial = useRef(draftFingerprint(draft));
  const [formulaValid, setFormulaValid] = useState(false);
  const [touched, setTouched] = useState<{ label: boolean; key: boolean }>({ label: false, key: false });
  /** Config fields the user has left (blurred); their errors may show. Everything shows after a save attempt. */
  const [configTouched, setConfigTouched] = useState<ReadonlySet<string>>(() => new Set());
  const [submitted, setSubmitted] = useState(false);
  const [editingKey, setEditingKey] = useState(false);
  const labelChanged = useRef(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const errors = useMemo(() => validateColumnDraft(draft, { schema, registry }), [draft, schema, registry]);
  const accessError = permissionsError(draft.permissions);
  const isFormula = draft.type === "formula";

  // What still blocks saving, in plain words (the primary button's tooltip).
  const missing: string[] = [];
  if (errors.type) missing.push("Choose a type");
  if (errors.label) missing.push("Give the column a name");
  if (errors.key && draft.label.trim()) missing.push(`Fix the key: ${errors.key}`);
  if (errors.config) missing.push(`Fix the settings: ${errors.config}`);
  if (isFormula && !formulaValid) missing.push(draft.formula.trim() ? "Fix the formula" : "Write a formula");
  if (accessError) missing.push(`Who can access: ${accessError.toLowerCase()}`);
  const canSave = missing.length === 0;

  const dirty = draftFingerprint(draft) !== initial.current;
  const dirtyRef = useRef(onDirtyChange);
  dirtyRef.current = onDirtyChange;
  useEffect(() => {
    dirtyRef.current?.(dirty);
  }, [dirty]);

  // Live ghost column for the host grid (debounced), cleared on unmount.
  const draftCb = useRef(onDraftChange);
  draftCb.current = onDraftChange;
  useEffect(() => {
    if (!draftCb.current) return;
    const t = setTimeout(() => draftCb.current?.(previewColumn(draft, schema, registry, position)), 150);
    return () => clearTimeout(t);
  }, [draft, schema, registry, position]);
  useEffect(() => () => draftCb.current?.(null), []);

  const saving = useRef(false);
  const save = () => {
    setTouched({ label: true, key: true });
    setSubmitted(true);
    if (!canSave || saving.current) return;
    try {
      const def = buildColumnDef(draft, { schema, registry, now: toIso(now ? now() : new Date()), generateId });
      const order = editing ? undefined : orderForPosition(schema, position);
      saving.current = true;
      onSave(order === undefined ? def : { ...def, order }, editing ? undefined : position);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Could not build the column");
    }
  };

  const fieldType = draft.type ? registry.get(draft.type) : undefined;
  const DefaultEditor = draft.type && !isFormula ? resolveEditorComponent(uiRegistry.get(draft.type).editor) : undefined;
  const draftColumn = draftAsColumn(draft);
  const primaryConfig = !!draft.type && PRIMARY_CONFIG_TYPES.has(draft.type);
  // Per-field config errors, only for fields the user has touched (or after a save attempt).
  const visibleConfigErrors = useMemo(() => {
    const all = errors.configFields ?? {};
    if (submitted) return all;
    return Object.fromEntries(Object.entries(all).filter(([path]) => isPathTouched(path, configTouched)));
  }, [errors.configFields, configTouched, submitted]);
  /** A config problem with no field of its own (the whole object), shown once the user has worked on the settings. */
  // Held back while any field has its own problem: those are usually the cause (two empty
  // option rows share the id "", which is also "not unique").
  const hasFieldErrors = Object.keys(errors.configFields ?? {}).some((path) => path !== "");
  const configRootError =
    errors.configFields?.[""] && !hasFieldErrors && (submitted || configTouched.size > 0)
      ? errors.configFields[""]
      : undefined;
  const configForm = fieldType ? (
    <ZodForm
      schema={fieldType.configSchema}
      value={draft.config}
      onChange={(config) => dispatch({ type: "setConfig", config })}
      errors={visibleConfigErrors}
      onFieldBlur={(path) => setConfigTouched((prev) => (prev.has(path) ? prev : new Set(prev).add(path)))}
      roles={roles}
    />
  ) : null;
  const labelError = touched.label && errors.label ? "Give the column a name" : undefined;
  const keyError = (touched.key || editingKey) && draft.label.trim() ? errors.key : undefined;

  const body = (
    <Stack gap="lg">
      {/* 1 · Name */}
      <Stack gap={6}>
        <TextInput
          label="Name"
          placeholder="e.g. Payment status"
          value={draft.label}
          error={labelError}
          withAsterisk={false}
          data-autofocus
          styles={{ input: { fontSize: 15, height: 38 } }}
          onChange={(e) => {
            labelChanged.current = true;
            dispatch({ type: "setLabel", label: e.currentTarget.value });
          }}
          // Leaving an untouched field (e.g. to pick the type first) is not an error yet.
          onBlur={() => labelChanged.current && setTouched((t) => ({ ...t, label: true }))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              save();
            }
          }}
        />
        {editingKey && !editing ? (
          <TextInput
            label="Key"
            size="xs"
            value={draft.key}
            error={keyError}
            description="Used in formulas and storage. Lowercase letters, digits and _."
            autoFocus
            styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)" } }}
            onChange={(e) => dispatch({ type: "setKey", key: e.currentTarget.value })}
            onBlur={() => setTouched((t) => ({ ...t, key: true }))}
          />
        ) : (
          <Group gap={6} wrap="nowrap" mih={22}>
            <Text size="xs" c="dimmed">
              Key
            </Text>
            {draft.key ? (
              <Code data-testid="column-key" style={{ fontSize: 12, background: "var(--mantine-color-default-hover)" }}>
                {draft.key}
              </Code>
            ) : (
              <Text size="xs" c="dimmed" data-testid="column-key">
                generated from the name
              </Text>
            )}
            {editing ? (
              <Tooltip label="Keys can't change: formulas and stored data use them">
                <IconLock size={12} stroke={1.75} aria-label="Key is locked" style={{ color: "var(--mantine-color-dimmed)" }} />
              </Tooltip>
            ) : (
              <Tooltip label="Edit key">
                <ActionIcon size="xs" variant="subtle" color="gray" aria-label="Edit key" onClick={() => setEditingKey(true)}>
                  <IconPencil size={12} stroke={1.75} />
                </ActionIcon>
              </Tooltip>
            )}
            {keyError && (
              <Text size="xs" c="red">
                {keyError}
              </Text>
            )}
          </Group>
        )}
      </Stack>

      {/* 2 · Type, then 3 · its settings */}
      <Stack gap="sm">
        <TypePicker
          registry={registry}
          value={draft.type}
          locked={editing}
          onChange={(fieldType) => dispatch({ type: "setType", fieldType, registry })}
        />
        {editing && (
          <Text size="xs" c="dimmed">
            The type can't be changed after the column is created.
          </Text>
        )}
        <Box key={draft.type ?? "none"} className="sg-cp-fade">
          {isFormula ? (
            <FormulaEditor
              schema={schema}
              access={access}
              value={draft.formula}
              onChange={(formula) => dispatch({ type: "setFormula", formula })}
              selfKey={draft.key || undefined}
              onValidityChange={setFormulaValid}
              sampleRows={sampleRows}
            />
          ) : fieldType && primaryConfig ? (
            <Stack gap="sm">
              {configForm}
              {(draft.type === "number" || draft.type === "currency") && (
                <FormatPreview format={(v) => fieldType.format(v, { ...(fieldType.defaultConfig as object), ...draft.config })} />
              )}
            </Stack>
          ) : null}
          {configRootError && (
            <Alert color="red" variant="light" mt="sm">
              {configRootError}
            </Alert>
          )}
        </Box>
      </Stack>

      <Box style={{ borderTop: "1px solid var(--mantine-color-default-border)" }} pt="xs">
        {/* 4 · Options */}
        {!isFormula && (
          <Section
            title="More options"
            summary={[draft.required ? "Required" : null, draft.defaultValue != null && draft.defaultValue !== "" ? "Has default" : null, draft.indexed ? "Indexed" : null]
              .filter(Boolean)
              .join(" · ")}
            opened={optionsOpen || (!primaryConfig && (Object.keys(visibleConfigErrors).length > 0 || !!configRootError))}
            onToggle={() => setOptionsOpen((o) => !o)}
          >
            <Stack gap="md" pb="xs">
              {!primaryConfig && configForm}
              <Switch
                label="Required"
                description="A row can't be saved without a value"
                checked={draft.required}
                onChange={(e) => dispatch({ type: "setRequired", required: e.currentTarget.checked })}
              />
              {DefaultEditor && (
                <Input.Wrapper label="Default value" description="Pre-filled for new rows">
                  <DefaultEditor
                    value={draft.defaultValue ?? null}
                    onChange={(value) => dispatch({ type: "setDefault", value })}
                    onCommit={(value) => {
                      if (value !== undefined) dispatch({ type: "setDefault", value });
                    }}
                    onCancel={() => {}}
                    column={draftColumn}
                    config={draft.config}
                    autoFocus={false}
                    surface="form"
                    dataSource={dataSource}
                  />
                </Input.Wrapper>
              )}
              <Switch
                label="Indexed"
                description="Speeds up filtering and sorting on large tables"
                checked={draft.indexed}
                onChange={(e) => dispatch({ type: "setIndexed", indexed: e.currentTarget.checked })}
              />
            </Stack>
          </Section>
        )}
        {/* 5 · Who can access */}
        <Section
          title="Who can access"
          summary={accessSummary(draft.permissions, isFormula)}
          opened={accessOpen || !!accessError}
          onToggle={() => setAccessOpen((o) => !o)}
        >
          <Box pb="xs">
            <AccessSection
              value={draft.permissions}
              roles={roles}
              computed={isFormula}
              onChange={(permissions) => dispatch({ type: "setPermissions", permissions })}
            />
          </Box>
        </Section>
      </Box>

      {saveError && (
        <Alert color="red" variant="light">
          {saveError}
        </Alert>
      )}
      {confirmDelete && column && onDelete && (
        <Alert color="red" variant="light" title="Delete this column?" role="alert">
          <Text size="sm">Its data will be removed for everyone. This can't be undone.</Text>
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
    </Stack>
  );

  const footer = (
    <Group justify="space-between" gap="xs" wrap="nowrap">
      <Box>
        {editing && onDelete && !confirmDelete && (
          <Button variant="subtle" color="red" c="var(--mantine-color-error)" onClick={() => setConfirmDelete(true)}>
            Delete column
          </Button>
        )}
      </Box>
      <Group gap="xs" wrap="nowrap">
        <Button variant="subtle" color="gray" onClick={onCancel}>
          Cancel
        </Button>
        <Tooltip
          disabled={canSave}
          label={
            <Stack gap={2}>
              {missing.map((m) => (
                <span key={m}>{m}</span>
              ))}
            </Stack>
          }
          multiline
          w={260}
          position="top-end"
        >
          <span>
            <Button onClick={save} disabled={!canSave} data-testid="column-save">
              {editing ? "Save" : "Create column"}
            </Button>
          </span>
        </Tooltip>
      </Group>
    </Group>
  );

  if (layout === "modal") {
    return (
      <Stack gap="lg">
        {body}
        {footer}
      </Stack>
    );
  }
  return (
    <Box style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <Box style={{ flex: 1, minHeight: 0, overflowY: "auto" }} px="lg" py="md">
        {body}
      </Box>
      <Box px="lg" py="sm" style={{ borderTop: "1px solid var(--mantine-color-default-border)", background: "var(--mantine-color-body)" }}>
        {footer}
      </Box>
    </Box>
  );
}

function Section({
  title,
  summary,
  opened,
  onToggle,
  children,
}: {
  title: string;
  summary?: string;
  opened: boolean;
  onToggle(): void;
  children: ReactNode;
}) {
  return (
    <Box>
      <UnstyledButton className="sg-cp-section-toggle" aria-expanded={opened} onClick={onToggle}>
        <IconChevronRight size={14} stroke={1.75} aria-hidden />
        <span style={{ flexShrink: 0 }}>{title}</span>
        {!opened && summary && (
          <Text size="xs" c="dimmed" truncate ml="auto" pl="sm">
            {summary}
          </Text>
        )}
      </UnstyledButton>
      <Collapse in={opened} transitionDuration={150}>
        <Box pt="xs">{children}</Box>
      </Collapse>
    </Box>
  );
}

/** "1234.5 → ₹1,234.50": how a sample number will look with the current settings. */
function FormatPreview({ format }: { format(value: number): string }) {
  let text: string;
  try {
    text = format(1234.5);
  } catch {
    return null;
  }
  return (
    <Group gap={8} data-testid="format-preview">
      <Text size="xs" c="dimmed">
        Preview
      </Text>
      <Text size="xs" ff="monospace" c="dimmed">
        1234.5
      </Text>
      <Text size="xs" c="dimmed">
        →
      </Text>
      <Text size="sm" style={{ fontVariantNumeric: "tabular-nums" }}>
        {text}
      </Text>
    </Group>
  );
}

/**
 * Notion-style "Property type" picker: a full-width trigger (icon + label)
 * that opens a searchable list of types, each with an icon and a one-line
 * description. Options are named by their label (e.g. "Select").
 */
export function TypePicker({
  registry,
  value,
  locked,
  onChange,
}: {
  registry: FieldTypeRegistry;
  value: FieldTypeId | null;
  locked?: boolean;
  onChange(type: FieldTypeId): void;
}) {
  const [search, setSearch] = useState("");
  const combobox = useCombobox({
    onDropdownClose: () => {
      combobox.resetSelectedOption();
      setSearch("");
    },
    onDropdownOpen: () => combobox.focusSearchInput(),
  });
  const types = useMemo(() => sortFieldTypes(registry.list()), [registry]);
  const q = search.trim().toLowerCase();
  const shown = types.filter((t) => !q || `${t.label} ${fieldTypeMeta(t.id).description}`.toLowerCase().includes(q));
  const current = types.find((t) => t.id === value);
  const meta = fieldTypeMeta(value);
  const Icon = meta.icon;

  return (
    <Stack gap={4}>
      <Text size="sm" fw={500} component="span" id="sg-cp-type-label">
        Type
      </Text>
      <Combobox
        store={combobox}
        width="target"
        position="bottom-start"
        shadow="md"
        radius="lg"
        onOptionSubmit={(id) => {
          onChange(id);
          combobox.closeDropdown();
        }}
      >
        <Combobox.Target targetType="button">
          <UnstyledButton
            aria-label={`Type: ${current?.label ?? "none"}`}
            aria-haspopup="listbox"
            disabled={locked}
            onClick={() => !locked && combobox.toggleDropdown()}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              width: "100%",
              height: 38,
              padding: "0 10px",
              borderRadius: "var(--mantine-radius-md)",
              border: "1px solid var(--mantine-color-default-border)",
              background: "var(--mantine-color-body)",
              cursor: locked ? "default" : "pointer",
              opacity: locked ? 0.7 : 1,
            }}
          >
            <Icon size={16} stroke={1.75} style={{ color: "var(--mantine-color-dimmed)", flexShrink: 0 }} aria-hidden />
            <Text size="sm" fw={500} style={{ flex: 1, minWidth: 0 }} truncate>
              {current?.label ?? "Choose a type"}
            </Text>
            {locked ? (
              <IconLock size={14} stroke={1.75} style={{ color: "var(--mantine-color-dimmed)" }} aria-hidden />
            ) : (
              <IconChevronDown size={14} stroke={1.75} style={{ color: "var(--mantine-color-dimmed)" }} aria-hidden />
            )}
          </UnstyledButton>
        </Combobox.Target>
        <Combobox.Dropdown p={4}>
          <Combobox.Search
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            placeholder="Search types"
            aria-label="Search types"
            leftSection={<IconSearch size={14} stroke={1.75} />}
            styles={{ input: { fontSize: 13 } }}
          />
          <Combobox.Options mah={340} style={{ overflowY: "auto" }} aria-label="Field types">
            {shown.map((t) => {
              const m = fieldTypeMeta(t.id);
              const TIcon = m.icon;
              return (
                <Combobox.Option key={t.id} value={t.id} aria-label={t.label} active={t.id === value} className="sg-cp-type-option">
                  <span className="sg-cp-type-icon" aria-hidden>
                    <TIcon size={14} stroke={1.75} />
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <Text size="sm" fw={500} lh={1.3}>
                      {t.label}
                    </Text>
                    <Text size="xs" c="dimmed" lh={1.3} truncate>
                      {m.description}
                    </Text>
                  </span>
                  {t.id === value && <IconCheck size={14} stroke={2} style={{ color: "var(--mantine-primary-color-filled)", flexShrink: 0 }} aria-hidden />}
                </Combobox.Option>
              );
            })}
            {shown.length === 0 && <Combobox.Empty>No matching type</Combobox.Empty>}
          </Combobox.Options>
        </Combobox.Dropdown>
      </Combobox>
    </Stack>
  );
}
