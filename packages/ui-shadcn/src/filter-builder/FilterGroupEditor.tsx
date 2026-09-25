import { ListPlusIcon, PlusIcon, XIcon } from "lucide-react";
import type { DataSource, GridSchema } from "../internal/core-contracts";
import type { UiFieldTypeRegistry } from "../internal/grid-contracts";
import { cn } from "../lib/cn";
import { Button } from "../ui/button";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";
import { Tooltip } from "../ui/tooltip";
import type { FilterDraftApi } from "./FilterBuilder";
import { CONJUNCTION_WIDTH, FilterConditionRow } from "./FilterConditionRow";
import type { DraftGroup } from "./model";

export interface FilterGroupEditorProps {
  group: DraftGroup;
  /** Depth of this group; the root is 1. */
  depth: number;
  api: FilterDraftApi;
  schema: GridSchema;
  uiRegistry: UiFieldTypeRegistry;
  dataSource?: DataSource;
}

const MATCH_HINT = { and: "All conditions must match", or: "Any condition can match" } as const;

/** Segmented AND / OR control of one group. */
function ConjunctionToggle({ group, api }: { group: DraftGroup; api: FilterDraftApi }) {
  return (
    <div className="sg:flex sg:items-center sg:gap-2">
      <ToggleGroup
        type="single"
        aria-label="Match"
        value={group.op}
        onValueChange={(v) => {
          if (v === "and" || v === "or") api.setGroupOp(group.id, v);
        }}
      >
        <ToggleGroupItem value="and">AND</ToggleGroupItem>
        <ToggleGroupItem value="or">OR</ToggleGroupItem>
      </ToggleGroup>
      <span className="sg:text-xs sg:text-muted-foreground">{MATCH_HINT[group.op]}</span>
    </div>
  );
}

/**
 * A group of conditions. The root renders flat; nested groups render as an
 * indented card on a subtle fill with their own AND/OR toggle. "Add group" is
 * disabled (with a tooltip) once `api.maxDepth` is reached.
 */
export function FilterGroupEditor({ group, depth, api, schema, uiRegistry, dataSource }: FilterGroupEditorProps) {
  const canAdd = api.canAddGroup(group.id);
  const nested = depth > 1;
  const groupError = api.errors.get(group.id)?.group;
  const empty = group.children.length === 0;

  const addCondition = (
    <Button variant="ghost" size="sm" onClick={() => api.addCondition(group.id)} className="sg:text-muted-foreground sg:hover:text-foreground">
      <PlusIcon aria-hidden className="sg:size-3.5" />
      Add condition
    </Button>
  );

  // Root empty state: one line + one ghost button.
  if (!nested && empty && !groupError) {
    return (
      <fieldset aria-label="Filter group" className="sg:m-0 sg:flex sg:min-w-0 sg:flex-col sg:items-start sg:gap-2 sg:border-0 sg:p-0">
        <p className="sg:text-sm sg:text-muted-foreground">Add a condition to filter rows</p>
        {addCondition}
      </fieldset>
    );
  }

  return (
    <fieldset
      aria-label="Filter group"
      className={cn(
        "sg:m-0 sg:flex sg:min-w-0 sg:flex-col sg:gap-2 sg:border-0 sg:p-0",
        nested && "sg:flex-1 sg:rounded-lg sg:border sg:border-solid sg:border-border sg:bg-subtle sg:p-2.5",
      )}
    >
      {!empty || nested ? (
        <div className="sg:flex sg:items-center sg:justify-between sg:gap-2">
          {empty ? <span className="sg:text-sm sg:text-muted-foreground">Empty group</span> : <ConjunctionToggle group={group} api={api} />}
          {nested ? (
            <Tooltip content="Remove group">
              <Button variant="subtle" size="icon-sm" aria-label="Remove group" onClick={() => api.remove(group.id)}>
                <XIcon aria-hidden className="sg:size-3.5" />
              </Button>
            </Tooltip>
          ) : null}
        </div>
      ) : null}

      {groupError ? (
        <p role="alert" className="sg:text-xs sg:text-danger">
          {groupError}
        </p>
      ) : null}

      {group.children.map((child, i) => {
        const conjunction = i === 0 ? "Where" : group.op;
        return child.kind === "condition" ? (
          <FilterConditionRow
            key={child.id}
            condition={child}
            api={api}
            schema={schema}
            uiRegistry={uiRegistry}
            dataSource={dataSource}
            conjunction={conjunction}
            label={`Condition ${i + 1}`}
          />
        ) : (
          <div key={child.id} className="sg:flex sg:min-w-0 sg:items-start sg:gap-1.5">
            <span className={cn(CONJUNCTION_WIDTH, "sg:flex sg:h-8 sg:shrink-0 sg:items-center sg:text-sm sg:text-muted-foreground")}>
              {conjunction}
            </span>
            <FilterGroupEditor
              group={child}
              depth={depth + 1}
              api={api}
              schema={schema}
              uiRegistry={uiRegistry}
              dataSource={dataSource}
            />
          </div>
        );
      })}

      <div className="sg:flex sg:items-center sg:gap-1">
        {addCondition}
        <Tooltip content={canAdd ? null : `Groups can nest at most ${api.maxDepth} levels deep`}>
          <span tabIndex={canAdd ? undefined : 0} className="sg:inline-flex sg:rounded-md sg:outline-none sg:focus-visible:ring-[3px] sg:focus-visible:ring-ring">
            <Button
              variant="ghost"
              size="sm"
              disabled={!canAdd}
              onClick={() => api.addGroup(group.id)}
              className="sg:text-muted-foreground sg:hover:text-foreground"
            >
              <ListPlusIcon aria-hidden className="sg:size-3.5" />
              Add group
            </Button>
          </span>
        </Tooltip>
      </div>
    </fieldset>
  );
}
