/**
 * The stories' host: a thin wrapper around `<SchemaGridWorkbench>` that keeps
 * the story-facing props of the old hand-rolled workbench and adds the
 * Admin / Counsellor / Viewer role switcher demo (toolbar end).
 */
import { Group, SegmentedControl, Text } from "@mantine/core";
import type {
  SchemaGridHandle,
  SchemaGridPollOptions,
} from "@ranjeetk25/schema-grid-ag-grid";
import type {
  ChangeFeedEntry,
  DataSource,
  GridSchema,
  PermissionUser,
  ViewDef,
} from "@ranjeetk25/schema-grid-core";
import {
  SchemaGridWorkbench,
  type WorkbenchSlot,
  type WorkbenchViewStore,
  createMemoryViewStore,
} from "@ranjeetk25/schema-grid-ui-mantine";
import { createMantineUiRegistry } from "@ranjeetk25/schema-grid-ui-mantine/editors";
import { Fragment, type ReactNode, useEffect, useMemo, useState } from "react";
import { USERS, type UserKey, registry, resolver } from "./data";

export const uiRegistry = createMantineUiRegistry({ fieldTypes: registry });

/** Every column stays in the DOM so tests (and screenshots) can reach any cell. */
export const GRID_OPTIONS = { suppressColumnVirtualisation: true } as const;

const ROLES: UserKey[] = ["admin", "counsellor", "viewer"];
const ROLE_OPTIONS: { value: UserKey; label: string }[] = [
  { value: "admin", label: "Admin" },
  { value: "counsellor", label: "Counsellor" },
  { value: "viewer", label: "Viewer" },
];
const GRID_PROPS = { gridOptions: GRID_OPTIONS };

export interface WorkbenchProps {
  dataSource: DataSource;
  schema: GridSchema;
  user: PermissionUser;
  mode?: "client" | "server";
  /** Header title. Default "Admissions". */
  title?: string;
  /** One muted line beside the title. */
  description?: string;
  /** Show the Admin / Counsellor / Viewer switcher (the grid re-resolves access). Default true. */
  roleSwitcher?: boolean;
  /**
   * Controlled role: when given, the switcher only reports changes and the
   * host swaps `user` (e.g. to refetch a role-scoped schema).
   */
  onRoleChange?(role: UserKey): void;
  /** Persists a schema change (column panel / created option). Default: accept as-is. */
  onSchemaChange?(next: GridSchema): Promise<GridSchema> | GridSchema;
  /** `intervalMs` → `pollIntervalMs`; `enabled: false` turns polling off. */
  poll?: SchemaGridPollOptions;
  /** Fixed grid height in px, or any CSS height. Default: fill the viewport. */
  height?: number | string;
  initialViews?: ViewDef[];
  /** Extra toolbar content (left cluster, after search). `ctx.handle` is the grid handle. */
  toolbar?: WorkbenchSlot;
  onRemoteChanges?(entry: ChangeFeedEntry): void;
  pageSize?: number;
  testId?: string;
  /** Persist saved views in localStorage under exactly this key (per-viewer convenience). */
  persistViewsKey?: string;
  /** Extra status-bar entries (null/empty entries are hidden). */
  status?: (ReactNode | null)[];
  /** Receives the grid handle. */
  onHandle?(handle: SchemaGridHandle | null): void;
}

/** Saved views as a JSON array at `localStorage[key]` (ignores the grid id). */
function keyedLocalStorageViewStore(key: string): WorkbenchViewStore {
  return {
    load() {
      try {
        const raw = localStorage.getItem(key);
        const parsed = raw ? (JSON.parse(raw) as unknown) : null;
        return Array.isArray(parsed) && parsed.length > 0
          ? (parsed as ViewDef[])
          : null;
      } catch {
        return null;
      }
    },
    save(_gridId, views) {
      try {
        localStorage.setItem(key, JSON.stringify(views));
      } catch {
        // Storage unavailable (private window, blocked): views stay in memory.
      }
    },
  };
}

function roleOf(user: PermissionUser): UserKey {
  const found = (Object.keys(USERS) as UserKey[]).find(
    (k) => USERS[k].id === user.id,
  );
  return found ?? "admin";
}

export function Workbench({
  dataSource,
  schema,
  user: initialUser,
  mode = "client",
  title = "Admissions",
  description,
  roleSwitcher = true,
  onRoleChange,
  onSchemaChange,
  poll,
  height = "100dvh",
  initialViews,
  toolbar,
  onRemoteChanges,
  pageSize,
  testId = "workbench",
  persistViewsKey,
  status,
  onHandle,
}: WorkbenchProps) {
  const [role, setRole] = useState<UserKey>(() => roleOf(initialUser));
  useEffect(() => setRole(roleOf(initialUser)), [initialUser]);
  const user =
    onRoleChange || role === roleOf(initialUser)
      ? initialUser
      : (USERS[role] ?? initialUser);

  // A fresh memory store per mount so stories don't leak views into each other.
  const viewStore = useMemo(
    () =>
      persistViewsKey
        ? keyedLocalStorageViewStore(persistViewsKey)
        : createMemoryViewStore(),
    [persistViewsKey],
  );

  const features = useMemo(
    () => (poll?.enabled === false ? { polling: false } : undefined),
    [poll?.enabled],
  );

  const shownStatus = (status ?? []).filter(
    (s) => s !== null && s !== undefined && s !== "",
  );

  return (
    <SchemaGridWorkbench
      dataSource={dataSource}
      schema={schema}
      {...(onSchemaChange ? { onSchemaChange } : {})}
      user={user}
      registry={registry}
      resolver={resolver}
      uiRegistry={uiRegistry}
      roles={ROLES}
      mode={mode}
      title={title}
      {...(description ? { subtitle: description } : {})}
      viewStore={viewStore}
      {...(initialViews ? { defaultViews: initialViews } : {})}
      {...(features ? { features } : {})}
      {...(poll?.intervalMs ? { pollIntervalMs: poll.intervalMs } : {})}
      height={height}
      {...(pageSize ? { pageSize } : {})}
      {...(onRemoteChanges ? { onRemoteChanges } : {})}
      {...(onHandle ? { onHandle } : {})}
      testId={testId}
      gridProps={GRID_PROPS}
      {...(toolbar ? { toolbarStart: toolbar } : {})}
      toolbarEnd={
        roleSwitcher ? (
          <Group gap={8} wrap="nowrap">
            <Text fz="xs" c="dimmed" visibleFrom="sm">
              Viewing as
            </Text>
            <SegmentedControl
              aria-label="Role"
              size="xs"
              value={role}
              onChange={(v) => {
                if (onRoleChange) onRoleChange(v as UserKey);
                else setRole(v as UserKey);
              }}
              data={ROLE_OPTIONS}
            />
          </Group>
        ) : null
      }
      {...(shownStatus.length > 0
        ? {
            statusBar: shownStatus.map((item, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static, order-stable list.
              <Fragment key={i}>
                {i > 0 ? <span aria-hidden> · </span> : null}
                {item}
              </Fragment>
            )),
          }
        : {})}
    />
  );
}
