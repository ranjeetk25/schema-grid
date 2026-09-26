/**
 * Error classification + a data-source tap that reports failures to the
 * workbench's banners. Framework-free (copied verbatim by ui-shadcn).
 */
import type { DataSource } from "@ranjeetk25/schema-grid-core";
import type { WorkbenchError, WorkbenchErrorKind } from "./types";

const PERMISSION_CODES = new Set(["PERMISSION_DENIED", "UNAUTHENTICATED", "notEditable", "unreadableColumn"]);
const CAPABILITY_CODES = new Set(["UNSUPPORTED_OPERATION", "UNKNOWN_OPERATION", "UNSORTABLE_COLUMN", "unfilterableColumn"]);
const SCHEMA_CODES = new Set(["SCHEMA_CHANGED", "SCHEMA_VERSION_MISMATCH", "STALE_SCHEMA"]);

const VERBS: Record<string, string> = {
  fetch: "load rows",
  applyChanges: "save changes",
  createRows: "add rows",
  deleteRows: "delete rows",
  getChanges: "check for updates",
  getRows: "refresh rows",
  getOptions: "load options",
  createOption: "add options",
  lookup: "search linked records",
  updateSchema: "change columns",
  getSchema: "load columns",
  capabilities: "load grid settings",
};

export const verbFor = (op: string): string => VERBS[op] ?? op;

function fields(error: unknown): { code?: string; status?: number; name?: string; message?: string } {
  if (typeof error !== "object" || error === null) return {};
  const e = error as { code?: unknown; status?: unknown; name?: unknown; message?: unknown };
  return {
    ...(typeof e.code === "string" ? { code: e.code } : {}),
    ...(typeof e.status === "number" ? { status: e.status } : {}),
    ...(typeof e.name === "string" ? { name: e.name } : {}),
    ...(typeof e.message === "string" ? { message: e.message } : {}),
  };
}

const isOffline = () => typeof navigator !== "undefined" && navigator.onLine === false;

/** Maps anything a data source throws to a banner kind. */
export function classifyError(error: unknown): WorkbenchErrorKind {
  const { code, status, name, message } = fields(error);
  if (code && SCHEMA_CODES.has(code)) return "schema-changed";
  if ((code && PERMISSION_CODES.has(code)) || status === 401 || status === 403 || name === "PermissionError")
    return "permission-denied";
  if ((code && CAPABILITY_CODES.has(code)) || status === 501) return "capability-denied";
  if (isOffline()) return "network";
  if (
    (name === "TypeError" && /fetch|network|load failed/i.test(message ?? "")) ||
    code === "HTTP_ERROR" ||
    code === "NETWORK_ERROR" ||
    (status !== undefined && (status === 0 || status >= 500))
  )
    return "network";
  return "unknown";
}

/** One friendly sentence per kind. */
export function describeError(kind: WorkbenchErrorKind, op: string): string {
  const verb = verbFor(op);
  switch (kind) {
    case "permission-denied":
      return `You don't have permission to ${verb}.`;
    case "capability-denied":
      return `This grid can't ${verb}.`;
    case "network":
      return isOffline() ? "You're offline. Changes will sync when you reconnect." : `Couldn't reach the server to ${verb}.`;
    case "schema-changed":
      return "The columns were changed elsewhere.";
    default: {
      return `Couldn't ${verb}.`;
    }
  }
}

export function toWorkbenchError(op: string, error: unknown): WorkbenchError {
  const kind = classifyError(error);
  return { kind, op, error, message: describeError(kind, op) };
}

export interface DataSourceTapEvents {
  onError(error: WorkbenchError): void;
  /** A read succeeded (fetch / getChanges): transient network / permission banners can clear. */
  onReadOk(op: string): void;
}

const OPS = [
  "fetch",
  "applyChanges",
  "createRows",
  "deleteRows",
  "getChanges",
  "getRows",
  "getOptions",
  "createOption",
  "lookup",
  "capabilities",
] as const;
const READS = new Set(["fetch", "getChanges"]);

/**
 * Wraps a data source so every failure is reported (then rethrown, so the
 * grid's own handling — rollback, conflicts, inline load error — still runs).
 * Optional methods stay absent when the source lacks them.
 */
export function tapDataSource<D extends DataSource>(source: D, events: DataSourceTapEvents): D {
  const out: Record<string, unknown> = {};
  const src = source as unknown as Record<string, unknown>;
  for (const op of OPS) {
    const fn = src[op];
    if (typeof fn !== "function") continue;
    out[op] = (...args: unknown[]) => {
      let result: unknown;
      try {
        result = (fn as (...a: unknown[]) => unknown).apply(source, args);
      } catch (error) {
        events.onError(toWorkbenchError(op, error));
        throw error;
      }
      if (result && typeof (result as Promise<unknown>).then === "function") {
        return (result as Promise<unknown>).then(
          (value) => {
            if (READS.has(op)) events.onReadOk(op);
            return value;
          },
          (error: unknown) => {
            events.onError(toWorkbenchError(op, error));
            throw error;
          },
        );
      }
      return result;
    };
  }
  return out as unknown as D;
}
