import { ChevronRight } from "lucide-react";
import { type ReactNode, type RefObject, useEffect, useId, useMemo, useReducer, useRef, useState } from "react";
import type { AccessMap } from "../internal/access";
import type { ColumnDef, DataSource, FieldTypeId, FieldTypeRegistry, GridRow, GridSchema } from "../internal/core-contracts";
import type { UiFieldTypeRegistry } from "../internal/grid-contracts";
import { cn } from "../lib/cn";
import { Button } from "../ui/button";
import { Tooltip } from "../ui/tooltip";
import { ColumnOptionsFields, NameField } from "./CommonFields";
import { TypeConfigFields } from "./ConfigStep";
import { type DraftColumn, type Requirement, type RequirementField, draftPreviewColumn, draftRequirements, isDraftDirty } from "./form-model";
import { type ColumnDraft, type ColumnDraftErrors, buildColumnDef, columnDraftReducer, createColumnDraft, validateColumnDraft } from "./model";
import { PermissionsStep, permissionsError } from "./PermissionsStep";
import { describePermissions } from "./permissions-model";
import { TypePicker } from "./TypePicker";

/** Props shared by `ColumnPanel`, `ColumnBuilderDialog` and `ColumnBuilderModal`. */
export interface ColumnBuilderProps {
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
  /** Rows the formula editor evaluates for its live preview (first 3). */
  sampleRows?: GridRow[];
  /** Where the new column goes (index among visible columns); carried on the draft preview. */
  insertAt?: number;
  /**
   * Live preview hook: called (debounced ~150ms) with the draft as a renderable
   * ColumnDef whenever it is valid enough to show, and with `null` on close.
   * Hosts pass it to the grid's `draftColumn` prop.
   */
  onDraftChange?(draft: DraftColumn | null): void;
  /** Type pre-selected for a new column. */
  initialType?: FieldTypeId;
}

const defaultId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `col_${Date.now().toString(36)}`;

const toIso = (v: Date | string) => (typeof v === "string" ? v : v.toISOString());

const DRAFT_DEBOUNCE_MS = 150;

type Confirm = null | "discard" | "delete";

/** State + actions behind the column form, shared by the panel and the dialog. */
export function useColumnBuilder({
  schema,
  registry,
  column,
  onSave,
  onClose,
  now,
  generateId = defaultId,
  insertAt,
  onDraftChange,
  initialType,
}: ColumnBuilderProps) {
  const editing = !!column;
  const [initial] = useState(() => createColumnDraft({ schema, registry, column, initialType }));
  const [draft, dispatch] = useReducer(columnDraftReducer, initial);
  const [formulaValid, setFormulaValid] = useState(false);
  const [touched, setTouched] = useState<ReadonlySet<RequirementField>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const errors = useMemo(() => validateColumnDraft(draft, { schema, registry }), [draft, schema, registry]);
  const permsError = permissionsError(draft.permissions);
  const requirements = useMemo(
    () => draftRequirements(draft, { errors, formulaValid, permissionsError: permsError }),
    [draft, errors, formulaValid, permsError],
  );
  const valid = requirements.length === 0;
  const dirty = isDraftDirty(initial, draft);

  const shows = (field: RequirementField) => submitted || touched.has(field);
  const touch = (field: RequirementField) =>
    setTouched((prev) => {
      if (prev.has(field)) return prev;
      const next = new Set(prev);
      next.add(field);
      return next;
    });

  const firstFor = (...fields: RequirementField[]): Requirement | undefined => requirements.find((r) => fields.includes(r.field));
  const configMessage = firstFor("config") ?? (draft.formula.trim() ? undefined : firstFor("formula"));
  const visibleErrors: ColumnDraftErrors & { type?: string } = {
    label: shows("label") ? firstFor("label")?.message : undefined,
    key: shows("key") || shows("label") ? errors.key : undefined,
    type: shows("type") ? firstFor("type")?.message : undefined,
    config: configMessage && (shows("config") || shows("formula")) ? configMessage.message : undefined,
  };

  // Live grid preview (debounced), null on close/unmount.
  const preview = useMemo(() => {
    if (!onDraftChange) return null;
    if (draft.type === "formula" && !formulaValid) return null;
    return draftPreviewColumn(draft, { schema, registry, insertAt });
  }, [onDraftChange, draft, formulaValid, schema, registry, insertAt]);
  const previewKey = preview ? JSON.stringify(preview) : "";
  const draftCallback = useRef(onDraftChange);
  draftCallback.current = onDraftChange;
  const latestPreview = useRef(preview);
  latestPreview.current = preview;
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the serialized preview
  useEffect(() => {
    if (!draftCallback.current) return;
    const t = setTimeout(() => draftCallback.current?.(latestPreview.current), DRAFT_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [previewKey]);
  useEffect(() => () => draftCallback.current?.(null), []);

  const saving = useRef(false);
  const save = () => {
    setSubmitted(true);
    if (!valid) {
      if (firstFor("label")) nameRef.current?.focus();
      return;
    }
    if (saving.current) return;
    try {
      const def = buildColumnDef(draft, { schema, registry, now: toIso(now ? now() : new Date()), generateId });
      saving.current = true;
      onSave(def);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Could not build the column");
    }
  };

  const requestClose = () => {
    if (confirm === "discard") setConfirm(null);
    else if (dirty) setConfirm("discard");
    else onClose();
  };

  return {
    editing,
    draft,
    dispatch,
    errors,
    visibleErrors,
    requirements,
    valid,
    dirty,
    submitted,
    touch,
    setFormulaValid,
    confirm,
    setConfirm,
    saveError,
    save,
    requestClose,
    nameRef,
  };
}

export type ColumnBuilderState = ReturnType<typeof useColumnBuilder>;

function Section({
  title,
  summary,
  open,
  onOpenChange,
  children,
}: {
  title: string;
  summary?: ReactNode;
  open: boolean;
  onOpenChange(open: boolean): void;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={`${id}-title`} className="sg:border-t sg:border-border sg:pt-3">
      <h3 id={`${id}-title`} className="sg:m-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${id}-body`}
          onClick={() => onOpenChange(!open)}
          className={cn(
            "sg:flex sg:w-full sg:items-center sg:gap-1.5 sg:rounded-md sg:py-1 sg:text-left sg:text-sm sg:font-medium sg:text-foreground sg:outline-none",
            "sg:focus-visible:ring-[3px] sg:focus-visible:ring-ring",
          )}
        >
          <ChevronRight aria-hidden className={cn("sg:size-3.5 sg:text-muted-foreground sg:transition-transform sg:duration-150", open && "sg:rotate-90")} />
          {title}
          {!open && summary ? <span className="sg:ml-auto sg:truncate sg:pl-3 sg:text-xs sg:font-normal sg:text-muted-foreground">{summary}</span> : null}
        </button>
      </h3>
      <div id={`${id}-body`} hidden={!open} className="sg:pt-3 sg:pb-1">
        {open ? children : null}
      </div>
    </section>
  );
}

/** Animated reveal (grid-rows 0fr → 1fr + fade) for the type-specific settings. */
function Reveal({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div
      aria-hidden={!open || undefined}
      className={cn(
        "sg:grid sg:transition-[grid-template-rows,opacity] sg:duration-200 sg:ease-out",
        open ? "sg:grid-rows-[1fr] sg:opacity-100" : "sg:grid-rows-[0fr] sg:opacity-0",
      )}
    >
      <div className={cn("sg:min-h-0", open ? "sg:overflow-visible" : "sg:overflow-hidden")}>{children}</div>
    </div>
  );
}

const optionsSummary = (draft: ColumnDraft) => {
  const parts: string[] = [];
  if (draft.required && draft.type !== "formula") parts.push("Required");
  if (draft.defaultValue !== undefined && draft.defaultValue !== null && draft.defaultValue !== "") parts.push("Has default");
  if (draft.indexed) parts.push("Indexed");
  return parts.join(" · ");
};

/** The single scrolling form: name → type → type settings → options → access. */
export function ColumnFormBody({
  state,
  props,
  portalled = true,
}: {
  state: ColumnBuilderState;
  props: ColumnBuilderProps;
  portalled?: boolean;
}) {
  const { draft, dispatch, visibleErrors, touch, setFormulaValid, editing, submitted, requirements, nameRef, save } = state;
  const { schema, registry, uiRegistry, access, roles, dataSource, sampleRows } = props;
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const accessBlocked = submitted && requirements.some((r) => r.field === "permissions");

  return (
    <div
      className="sg:flex sg:flex-col sg:gap-6"
      onKeyDown={(e) => {
        // Enter in the name field saves (the one single-line field that has no other Enter meaning).
        if (e.key === "Enter" && e.target === nameRef.current && !e.nativeEvent.isComposing) {
          e.preventDefault();
          save();
        }
      }}
    >
      <NameField
        draft={draft}
        dispatch={dispatch}
        errors={visibleErrors}
        onFieldBlur={(f) => touch(f)}
        autoFocus
        inputRef={nameRef as RefObject<HTMLInputElement>}
      />

      <div className="sg:flex sg:flex-col sg:gap-4">
        <TypePicker
          registry={registry}
          value={draft.type}
          locked={editing}
          error={visibleErrors.type}
          onBlur={() => touch("type")}
          portalled={portalled}
          onChange={(fieldType) => dispatch({ type: "setType", fieldType, registry })}
        />
        <Reveal open={!!draft.type}>
          {draft.type ? (
            <div
              key={draft.type}
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) touch(draft.type === "formula" ? "formula" : "config");
              }}
              className="sg:pt-1 sg:transition-[opacity,translate] sg:duration-200 sg:ease-out sg:starting:translate-y-1 sg:starting:opacity-0"
            >
              <TypeConfigFields
                draft={draft}
                dispatch={dispatch}
                schema={schema}
                registry={registry}
                access={access}
                errors={visibleErrors}
                onFormulaValidityChange={setFormulaValid}
                sampleRows={sampleRows}
                portalled={portalled}
              />
            </div>
          ) : null}
        </Reveal>
      </div>

      <div className="sg:flex sg:flex-col sg:gap-3">
        <Section title="Options" summary={optionsSummary(draft)} open={optionsOpen} onOpenChange={setOptionsOpen}>
          <ColumnOptionsFields draft={draft} dispatch={dispatch} uiRegistry={uiRegistry} dataSource={dataSource} />
        </Section>
        <Section
          title="Who can access"
          summary={describePermissions(draft.permissions, { readOnly: draft.type === "formula" })}
          open={accessOpen || accessBlocked}
          onOpenChange={setAccessOpen}
        >
          <PermissionsStep
            value={draft.permissions}
            roles={roles}
            computed={draft.type === "formula"}
            onChange={(permissions) => dispatch({ type: "setPermissions", permissions })}
          />
        </Section>
      </div>

      {state.saveError ? (
        <p role="alert" className="sg:rounded-md sg:bg-danger-subtle sg:px-3 sg:py-2 sg:text-sm sg:text-danger">
          {state.saveError}
        </p>
      ) : null}
    </div>
  );
}

/** Footer: Delete (edit mode, left) · Cancel + the ONE primary action; inline confirms replace it. */
export function ColumnFormFooter({ state, props }: { state: ColumnBuilderState; props: ColumnBuilderProps }) {
  const { editing, confirm, setConfirm, requirements, valid, save, requestClose } = state;
  const { column, onDelete, onClose } = props;
  const missingId = useId();
  const confirmTitleId = useId();
  const keepRef = useRef<HTMLButtonElement>(null);

  // Focus the safe choice when a confirm opens.
  useEffect(() => {
    if (confirm) keepRef.current?.focus();
  }, [confirm]);

  if (confirm === "discard") {
    return (
      <div role="alertdialog" aria-labelledby={confirmTitleId} className="sg:flex sg:w-full sg:items-center sg:justify-between sg:gap-3">
        <p id={confirmTitleId} className="sg:text-sm sg:font-medium sg:text-foreground">
          Discard changes?
        </p>
        <div className="sg:flex sg:items-center sg:gap-2">
          <Button ref={keepRef} variant="ghost" onClick={() => setConfirm(null)}>
            Keep editing
          </Button>
          <Button variant="danger" className="sg:bg-danger-subtle" onClick={onClose}>
            Discard
          </Button>
        </div>
      </div>
    );
  }

  if (confirm === "delete" && column && onDelete) {
    return (
      <div role="alertdialog" aria-labelledby={confirmTitleId} className="sg:flex sg:w-full sg:items-center sg:justify-between sg:gap-3">
        <div className="sg:flex sg:min-w-0 sg:flex-col">
          <p id={confirmTitleId} className="sg:text-sm sg:font-medium sg:text-foreground">
            Delete this column?
          </p>
          <p className="sg:text-xs sg:text-muted-foreground">Its data is removed for everyone. This can't be undone.</p>
        </div>
        <div className="sg:flex sg:shrink-0 sg:items-center sg:gap-2">
          <Button ref={keepRef} variant="ghost" onClick={() => setConfirm(null)}>
            Keep column
          </Button>
          <Button variant="danger" className="sg:bg-danger-subtle" onClick={() => onDelete(column.id)}>
            Confirm delete
          </Button>
        </div>
      </div>
    );
  }

  const missing = requirements.map((r) => r.message).join(" · ");
  const primary = (
    <Button
      variant="primary"
      aria-disabled={!valid || undefined}
      aria-describedby={!valid ? missingId : undefined}
      onClick={save}
      className={cn(!valid && "sg:cursor-not-allowed sg:opacity-50 sg:hover:bg-primary")}
    >
      {editing ? "Save" : "Create column"}
    </Button>
  );

  return (
    <div className="sg:flex sg:w-full sg:items-center sg:justify-between sg:gap-2">
      <div>
        {editing && onDelete ? (
          <Button variant="danger" onClick={() => setConfirm("delete")}>
            Delete column
          </Button>
        ) : null}
      </div>
      <div className="sg:flex sg:items-center sg:gap-2">
        <Button variant="ghost" onClick={requestClose}>
          Cancel
        </Button>
        {valid ? primary : <Tooltip content={missing}>{primary}</Tooltip>}
        {!valid ? (
          <span id={missingId} hidden>
            {`Missing: ${missing}`}
          </span>
        ) : null}
      </div>
    </div>
  );
}
