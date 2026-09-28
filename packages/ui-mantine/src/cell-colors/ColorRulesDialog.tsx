/**
 * v0.4 "Color rules" dialog: edits the current view's conditional colors
 * ("when <filter> then color <whole row | columns>"). Rules are a local draft
 * until Save; Save validates with core's `validateColorRules` (readable
 * columns only) and hands the clean rules to `onSave` (the workbench calls
 * `handle.setColorRules`, which flows to the view like filter / sort).
 * Problems show inline under their rule and update live after a failed Save.
 *
 * Each rule: a palette radio group, an Enabled switch, move up / down,
 * delete, the target (whole row, or a multi-select of readable columns) and
 * its condition, built with the regular `FilterBuilder` (live, no color
 * operators: a rule can't test colors).
 *
 * v0.4.1: a condition may test `filterable: false` columns (the builder runs
 * with `allowUnfilterable`; rules render client-side from row values). Such a
 * rule shows a subtle "Can't be used to filter by color" note: the server
 * can't filter the columns it colors by color while it is enabled.
 */
import {
  ActionIcon,
  Alert,
  Box,
  Button,
  Group,
  Modal,
  MultiSelect,
  SegmentedControl,
  Stack,
  Switch,
  Text,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { FilterBuilder } from "../filter-builder/FilterBuilder";
import {
  type AccessMap,
  readableColumnIds,
  readableColumns,
} from "../internal/access";
import {
  type CellColor,
  type ColorRule,
  type ColorRuleIssue,
  type DataSource,
  type FieldTypeRegistry,
  type FilterNode,
  type FilterScopeCapabilitiesLike,
  type GridSchema,
  colorRuleUnfilterableColumn,
  sqlFilterablePredicate,
  validateColorRules,
} from "../internal/core-contracts";
import type { UiFieldTypeRegistry } from "../internal/grid-contracts";
import {
  IconAlertCircle,
  IconArrowDown,
  IconArrowUp,
  IconPlus,
  IconTrash,
} from "../internal/icons";
import { CELL_COLOR_PALETTE, CellColorSwatch } from "../theme/cellColorPalette";

export interface ColorRulesDialogProps {
  opened: boolean;
  onClose(): void;
  schema: GridSchema;
  /** Core field-type registry (operators, validation). */
  registry: FieldTypeRegistry;
  /** UI registry (condition value inputs). */
  uiRegistry: UiFieldTypeRegistry;
  access: AccessMap;
  /** The view's rules (`handle.colorRules`); the draft restarts from them on every open. */
  rules: readonly ColorRule[];
  /** Receives the validated rules; the dialog closes afterwards. */
  onSave(rules: ColorRule[]): unknown;
  dataSource?: DataSource;
  /**
   * v0.4.1: the source's capabilities (e.g. `handle.effectiveCapabilities`).
   * Columns outside its `filter` scope count as unfilterable for the "Can't
   * be used to filter by color" note, like `filterable: false` ones.
   */
  capabilities?: FilterScopeCapabilitiesLike;
}

/** New rules start yellow, whole row, no condition (which never matches until one is added). */
const NEW_RULE_COLOR: CellColor = "yellow";
let seq = 0;
const newRuleId = () =>
  `rule_${Date.now().toString(36)}${(++seq).toString(36)}`;

const TARGETS = [
  { value: "row", label: "Whole row" },
  { value: "cells", label: "Columns" },
];

function ColorRadios({
  value,
  onChange,
}: { value: CellColor; onChange(c: CellColor): void }) {
  return (
    <Group role="radiogroup" aria-label="Color" gap={2} wrap="nowrap">
      {CELL_COLOR_PALETTE.map((p) => {
        const on = p.color === value;
        return (
          <Tooltip key={p.color} label={p.label} withinPortal={false}>
            {/* biome-ignore lint/a11y/useSemanticElements: a swatch button, announced as a radio of the color group. */}
            <UnstyledButton
              role="radio"
              aria-checked={on}
              aria-label={p.label}
              onClick={() => onChange(p.color)}
              style={{
                display: "inline-flex",
                padding: 2,
                borderRadius: 6,
                outline: on ? `2px solid ${p.swatch}` : "2px solid transparent",
                outlineOffset: -1,
              }}
            >
              <CellColorSwatch color={p.color} size={16} />
            </UnstyledButton>
          </Tooltip>
        );
      })}
    </Group>
  );
}

export function ColorRulesDialog(props: ColorRulesDialogProps) {
  const {
    opened,
    onClose,
    schema,
    registry,
    uiRegistry,
    access,
    rules,
    onSave,
    dataSource,
    capabilities,
  } = props;
  const [draft, setDraft] = useState<ColorRule[]>(() =>
    rules.map((r) => ({ ...r })),
  );
  const [tried, setTried] = useState(false);
  const rulesRef = useRef(rules);
  rulesRef.current = rules;

  // Every open restarts from the view's rules.
  useEffect(() => {
    if (!opened) return;
    setDraft(rulesRef.current.map((r) => ({ ...r })));
    setTried(false);
  }, [opened]);

  const readable = useMemo(
    () => readableColumnIds(schema, access),
    [schema, access],
  );
  const columnData = useMemo(
    () =>
      readableColumns(schema, access).map((c) => ({
        value: c.id,
        label: c.label,
      })),
    [schema, access],
  );
  const isSqlFilterable = useMemo(
    () => sqlFilterablePredicate(schema, capabilities),
    [schema, capabilities],
  );
  const validation = useMemo(
    () => validateColorRules(draft, schema, registry, readable),
    [draft, schema, registry, readable],
  );
  const issues: ColorRuleIssue[] =
    tried && !validation.ok ? validation.issues : [];
  const issuesOf = (index: number) =>
    issues.filter((i) => i.ruleIndex === index);
  const listIssues = issues.filter((i) => i.ruleIndex === undefined);

  const patch = (index: number, next: Partial<ColorRule>) =>
    setDraft((d) => d.map((r, i) => (i === index ? { ...r, ...next } : r)));
  const move = (index: number, by: -1 | 1) =>
    setDraft((d) => {
      const j = index + by;
      if (j < 0 || j >= d.length) return d;
      const out = [...d];
      [out[index], out[j]] = [out[j] as ColorRule, out[index] as ColorRule];
      return out;
    });
  const remove = (index: number) =>
    setDraft((d) => d.filter((_, i) => i !== index));
  const add = () =>
    setDraft((d) => [
      ...d,
      {
        id: newRuleId(),
        color: NEW_RULE_COLOR,
        target: { kind: "row" },
        when: null,
      },
    ]);

  const save = () => {
    setTried(true);
    if (!validation.ok) return;
    onSave(validation.rules);
    onClose();
  };

  return (
    <Modal opened={opened} onClose={onClose} title="Color rules" size={760}>
      <Stack gap="sm">
        <Text fz="sm" c="dimmed">
          Rules color the cells or rows that match, in this view. The first
          matching rule wins; a color painted on a cell wins over every rule.
        </Text>
        {listIssues.map((i) => (
          <Alert
            key={i.message}
            color="red"
            variant="light"
            icon={<IconAlertCircle size={16} stroke={1.75} />}
            role="alert"
          >
            {i.message}
          </Alert>
        ))}
        {draft.length === 0 ? (
          <Text fz="sm" ta="center" py="md" c="dimmed">
            No color rules yet. Add one to color the rows or cells that match a
            condition.
          </Text>
        ) : null}
        {draft.map((rule, index) => {
          const ruleIssues = issuesOf(index);
          const enabled = rule.enabled !== false;
          // v0.4.1: the condition tests a column the server can't filter on.
          const unfilterable = colorRuleUnfilterableColumn(
            rule,
            schema,
            isSqlFilterable,
          );
          return (
            <Box
              key={rule.id}
              component="fieldset"
              aria-label={`Rule ${index + 1}`}
              data-invalid={ruleIssues.length > 0 || undefined}
              p="sm"
              style={{
                border: `1px solid ${ruleIssues.length > 0 ? "var(--mantine-color-red-filled)" : "var(--mantine-color-default-border)"}`,
                borderRadius: 8,
                margin: 0,
                minWidth: 0,
                opacity: enabled ? 1 : 0.75,
              }}
            >
              <Stack gap={10}>
                <Group justify="space-between" wrap="nowrap" gap="xs">
                  <Group gap="sm" wrap="nowrap">
                    <ColorRadios
                      value={rule.color}
                      onChange={(color) => patch(index, { color })}
                    />
                    <Switch
                      label="Enabled"
                      checked={enabled}
                      onChange={(e) =>
                        patch(index, { enabled: e.currentTarget.checked })
                      }
                    />
                  </Group>
                  <Group gap={2} wrap="nowrap">
                    <ActionIcon
                      aria-label="Move up"
                      size="md"
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                    >
                      <IconArrowUp size={14} stroke={1.75} />
                    </ActionIcon>
                    <ActionIcon
                      aria-label="Move down"
                      size="md"
                      disabled={index === draft.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <IconArrowDown size={14} stroke={1.75} />
                    </ActionIcon>
                    <ActionIcon
                      aria-label="Delete rule"
                      size="md"
                      color="red"
                      onClick={() => remove(index)}
                    >
                      <IconTrash size={14} stroke={1.75} />
                    </ActionIcon>
                  </Group>
                </Group>
                <Group gap="xs" wrap="nowrap" align="flex-start">
                  <Text fz="sm" fw={500} w={52} pt={4} style={{ flex: "none" }}>
                    Color
                  </Text>
                  <SegmentedControl
                    aria-label="Target"
                    data={TARGETS}
                    value={rule.target.kind}
                    onChange={(v) =>
                      patch(index, {
                        target:
                          v === "cells"
                            ? { kind: "cells", columnIds: [] }
                            : { kind: "row" },
                      })
                    }
                  />
                  {rule.target.kind === "cells" ? (
                    <MultiSelect
                      aria-label="Columns"
                      placeholder={
                        rule.target.columnIds.length > 0
                          ? undefined
                          : "Pick columns"
                      }
                      size="xs"
                      searchable
                      style={{ flex: 1, minWidth: 0 }}
                      data={columnData}
                      value={rule.target.columnIds}
                      onChange={(columnIds) =>
                        patch(index, { target: { kind: "cells", columnIds } })
                      }
                      comboboxProps={{ withinPortal: false }}
                    />
                  ) : null}
                </Group>
                <Group gap="xs" wrap="nowrap" align="flex-start">
                  <Text fz="sm" fw={500} w={52} pt={4} style={{ flex: "none" }}>
                    When
                  </Text>
                  <Box style={{ flex: 1, minWidth: 0 }}>
                    <FilterBuilder
                      schema={schema}
                      registry={registry}
                      uiRegistry={uiRegistry}
                      access={access}
                      value={rule.when}
                      onChange={(when: FilterNode | null) =>
                        patch(index, { when })
                      }
                      debounceMs={0}
                      allowUnfilterable
                      {...(dataSource ? { dataSource } : {})}
                    />
                  </Box>
                </Group>
                {unfilterable ? (
                  <Text
                    fz="xs"
                    c="dimmed"
                    pl={60}
                    data-sg-rule-unfilterable=""
                    title={`Uses "${unfilterable.label}", which can't be filtered on the server`}
                  >
                    Can't be used to filter by color
                  </Text>
                ) : null}
                {ruleIssues.map((i) => (
                  <Text
                    key={`${i.path.join(".")}:${i.message}`}
                    fz="xs"
                    c="red"
                  >
                    {i.message}
                  </Text>
                ))}
              </Stack>
            </Box>
          );
        })}
        <Group justify="space-between" mt={4}>
          <Button
            variant="subtle"
            color="gray"
            leftSection={<IconPlus size={14} stroke={2} />}
            onClick={add}
          >
            Add rule
          </Button>
          <Group gap="xs">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={save}>Save</Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}
