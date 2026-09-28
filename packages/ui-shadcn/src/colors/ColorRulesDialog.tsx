import { ArrowDownIcon, ArrowUpIcon, CircleAlertIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { FilterBuilder } from "../filter-builder/FilterBuilder";
import { FieldTypeIcon, MultiPicker, type PickerItem } from "../filter-builder/pickers";
import { type AccessMap, readableColumnIds, readableColumns } from "../internal/access";
import type { CellColor, ColorRule, DataSource, FieldTypeRegistry, FilterNode, GridSchema } from "../internal/core-contracts";
import type { UiFieldTypeRegistry } from "../internal/grid-contracts";
import { cn } from "../lib/cn";
import { CellColorSwatch, cellColorLabel } from "../theme/cellColors";
import { Button } from "../ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Switch } from "../ui/switch";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";
import { Tooltip } from "../ui/tooltip";
import { CellColorPicker } from "./CellColorPicker";
import {
  addColorRule,
  moveColorRule,
  removeColorRule,
  ruleIssueMessages,
  updateColorRule,
  validateColorRulesDraft,
} from "./colorRulesModel";

export interface ColorRulesDialogProps {
  opened: boolean;
  onClose(): void;
  schema: GridSchema;
  /** Core field-type registry (conditions, validation). */
  registry: FieldTypeRegistry;
  /** UI registry (the condition builder's value inputs). */
  uiRegistry: UiFieldTypeRegistry;
  access: AccessMap;
  /** The current view's rules (`handle.colorRules`). */
  rules: readonly ColorRule[];
  /** Receives the validated rules (`validateColorRules` output); the host calls `handle.setColorRules`. */
  onSave(rules: ColorRule[]): void;
  dataSource?: DataSource;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The rule's color: a swatch button opening the palette (no "No color": a rule always paints). */
function RuleColor({ color, onChange }: { color: CellColor; onChange(color: CellColor): void }) {
  const [open, setOpen] = useState(false);
  const label = cellColorLabel(color);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="secondary" aria-label={`Color: ${label}`} aria-haspopup="dialog" className="sg:w-28 sg:justify-start sg:px-2.5 sg:font-normal">
          <CellColorSwatch color={color} />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent aria-label="Rule color" align="start" className="sg:w-auto sg:p-2">
        <CellColorPicker
          allowNone={false}
          value={color}
          onPick={(next) => {
            if (next) onChange(next);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

interface RuleCardProps {
  rule: ColorRule;
  index: number;
  count: number;
  issues: readonly string[] | undefined;
  schema: GridSchema;
  registry: FieldTypeRegistry;
  uiRegistry: UiFieldTypeRegistry;
  access: AccessMap;
  dataSource?: DataSource;
  columnItems: readonly PickerItem[];
  onChange(patch: Partial<Omit<ColorRule, "id">>): void;
  onMove(delta: -1 | 1): void;
  onRemove(): void;
}

function RuleCard({
  rule,
  index,
  count,
  issues,
  schema,
  registry,
  uiRegistry,
  access,
  dataSource,
  columnItems,
  onChange,
  onMove,
  onRemove,
}: RuleCardProps) {
  const n = index + 1;
  const errorId = useId();
  const enabled = rule.enabled !== false;
  const cells = rule.target.kind === "cells" ? rule.target.columnIds : null;
  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset would restyle the card; a labelled group is the intent
    <div
      role="group"
      aria-label={`Rule ${n}`}
      aria-describedby={issues ? errorId : undefined}
      data-invalid={issues ? true : undefined}
      className={cn(
        "sg:flex sg:flex-col sg:gap-3 sg:rounded-lg sg:border sg:border-solid sg:border-border sg:p-3",
        issues && "sg:border-danger",
        !enabled && "sg:bg-subtle",
      )}
    >
      <div className="sg:flex sg:min-w-0 sg:flex-wrap sg:items-center sg:gap-2">
        <span className="sg:w-5 sg:shrink-0 sg:text-xs sg:text-muted-foreground sg:tabular-nums">{n}</span>
        <RuleColor color={rule.color} onChange={(color) => onChange({ color })} />
        <ToggleGroup
          type="single"
          aria-label="Apply to"
          value={rule.target.kind}
          onValueChange={(v) => {
            if (v === "row" && rule.target.kind !== "row") onChange({ target: { kind: "row" } });
            if (v === "cells" && rule.target.kind !== "cells") onChange({ target: { kind: "cells", columnIds: [] } });
          }}
        >
          <ToggleGroupItem value="row">Whole row</ToggleGroupItem>
          <ToggleGroupItem value="cells">Columns</ToggleGroupItem>
        </ToggleGroup>
        {cells ? (
          <MultiPicker
            aria-label="Target columns"
            placeholder="Choose columns"
            items={columnItems}
            value={cells}
            onChange={(columnIds) => onChange({ target: { kind: "cells", columnIds } })}
            invalid={Boolean(issues) && cells.length === 0}
            className="sg:w-56"
          />
        ) : null}
        <div className="sg:ml-auto sg:flex sg:items-center sg:gap-1">
          <span className="sg:mr-2 sg:flex sg:items-center sg:gap-2 sg:text-sm sg:text-muted-foreground">
            <Switch aria-label="Enabled" checked={enabled} onCheckedChange={(on) => onChange({ enabled: on })} />
            <span aria-hidden className="sg:w-6">
              {enabled ? "On" : "Off"}
            </span>
          </span>
          <Tooltip content="Move up">
            <Button variant="subtle" size="icon-sm" aria-label={`Move rule ${n} up`} disabled={index === 0} onClick={() => onMove(-1)}>
              <ArrowUpIcon aria-hidden className="sg:size-3.5" />
            </Button>
          </Tooltip>
          <Tooltip content="Move down">
            <Button variant="subtle" size="icon-sm" aria-label={`Move rule ${n} down`} disabled={index === count - 1} onClick={() => onMove(1)}>
              <ArrowDownIcon aria-hidden className="sg:size-3.5" />
            </Button>
          </Tooltip>
          <Tooltip content="Delete rule">
            <Button variant="subtle" size="icon-sm" aria-label={`Delete rule ${n}`} onClick={onRemove}>
              <Trash2Icon aria-hidden className="sg:size-3.5" />
            </Button>
          </Tooltip>
        </div>
      </div>
      <div className="sg:flex sg:min-w-0 sg:flex-col sg:gap-1.5">
        <span className="sg:text-xs sg:font-medium sg:text-muted-foreground">When</span>
        <FilterBuilder
          schema={schema}
          registry={registry}
          uiRegistry={uiRegistry}
          access={access}
          value={rule.when}
          onChange={(when: FilterNode | null) => onChange({ when })}
          dataSource={dataSource}
          debounceMs={0}
        />
        {rule.when === null ? <p className="sg:text-xs sg:text-muted-foreground">Without a condition this rule never applies.</p> : null}
      </div>
      {issues ? (
        <div id={errorId} role="alert" className="sg:flex sg:items-start sg:gap-1.5 sg:text-xs sg:text-danger">
          <CircleAlertIcon aria-hidden className="sg:mt-px sg:size-3.5 sg:shrink-0" />
          <span>{issues.join(" · ")}</span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * v0.4 "Color rules" editor for the current view: one card per rule, in
 * order (the first match wins within its tier: a column's `cells` rules
 * before `row` rules), each with its color, target (whole row or chosen
 * columns), a condition built with the kit's `FilterBuilder` (color
 * operators excluded, a rule can't depend on colors), an enabled switch,
 * move up / down and delete. Edits stay local; "Save rules" validates with
 * core's `validateColorRules` (readable columns only) and hands the clean
 * rules to `onSave`, or shows the issues on the offending rules.
 */
export function ColorRulesDialog({
  opened,
  onClose,
  schema,
  registry,
  uiRegistry,
  access,
  rules,
  onSave,
  dataSource,
}: ColorRulesDialogProps) {
  const [draft, setDraft] = useState<ColorRule[]>(() => [...rules]);
  const [attempted, setAttempted] = useState(false);
  // Every opening starts from the view's current rules (a live rules change while open never drops edits).
  const rulesRef = useRef(rules);
  rulesRef.current = rules;
  useEffect(() => {
    if (opened) {
      setDraft([...rulesRef.current]);
      setAttempted(false);
    }
  }, [opened]);

  const readable = useMemo(() => readableColumnIds(schema, access), [schema, access]);
  const columnItems = useMemo(
    () => readableColumns(schema, access).map((c) => ({ value: c.id, label: c.label, icon: <FieldTypeIcon type={c.type} /> })),
    [schema, access],
  );
  const validation = useMemo(() => validateColorRulesDraft(draft, schema, registry, readable), [draft, schema, registry, readable]);
  const issues = attempted && !validation.ok ? ruleIssueMessages(validation.issues) : null;
  const problemCount = issues ? [...issues.values()].reduce((n, list) => n + list.length, 0) : 0;

  const save = () => {
    setAttempted(true);
    if (!validation.ok) return;
    onSave(validation.rules);
    onClose();
  };

  return (
    <Dialog
      open={opened}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent size="xl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Color rules</DialogTitle>
          <DialogDescription>
            Color rows or cells that match a condition. Saved with the view; the first matching rule wins, and colors painted by hand win over rules.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="sg:flex sg:flex-col sg:gap-3">
          {draft.length === 0 ? (
            <p className="sg:rounded-lg sg:border sg:border-dashed sg:border-border sg:p-6 sg:text-center sg:text-sm sg:text-muted-foreground">
              No color rules yet. Add one to highlight rows or cells that match a condition.
            </p>
          ) : (
            draft.map((rule, index) => (
              <RuleCard
                key={rule.id}
                rule={rule}
                index={index}
                count={draft.length}
                issues={issues?.get(index)}
                schema={schema}
                registry={registry}
                uiRegistry={uiRegistry}
                access={access}
                dataSource={dataSource}
                columnItems={columnItems}
                onChange={(patch) => setDraft((d) => updateColorRule(d, index, patch))}
                onMove={(delta) => setDraft((d) => moveColorRule(d, index, delta))}
                onRemove={() => setDraft((d) => removeColorRule(d, index))}
              />
            ))
          )}
          <div>
            <Button variant="ghost" size="sm" className="sg:text-muted-foreground sg:hover:text-foreground" onClick={() => setDraft((d) => addColorRule(d))}>
              <PlusIcon aria-hidden className="sg:size-3.5" />
              Add rule
            </Button>
          </div>
        </DialogBody>
        <DialogFooter className="sg:justify-between">
          <span className="sg:text-xs sg:text-danger" aria-live="polite">
            {problemCount > 0 ? `Fix ${plural(problemCount, "problem")} to save` : ""}
          </span>
          <div className="sg:flex sg:items-center sg:gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={save}>
              Save rules
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
