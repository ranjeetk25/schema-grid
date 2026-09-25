import { createHash } from "node:crypto";
import { CursorError } from "../errors";
import type { GridQuery } from "../internal/core";

export interface CursorPayload {
  v: 1;
  mode: "keyset" | "offset";
  fp: string;
  keys?: (string | number | boolean | null)[];
  id?: string;
  offset?: number;
}

/** Base64url-encodes a cursor payload as JSON. */
export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

/** Decodes and validates a cursor. Throws `CursorError` on malformed input or an unsupported version. */
export function decodeCursor(cursor: string): CursorPayload {
  let json: string;
  try {
    json = Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    throw new CursorError();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new CursorError();
  }

  if (!isCursorPayload(parsed)) throw new CursorError();
  return parsed;
}

function isCursorPayload(value: unknown): value is CursorPayload {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Record<string, unknown>;
  if (p.v !== 1) return false;
  if (p.mode !== "keyset" && p.mode !== "offset") return false;
  if (typeof p.fp !== "string") return false;
  if (p.keys !== undefined) {
    if (!Array.isArray(p.keys)) return false;
    const ok = p.keys.every(
      (k) => k === null || typeof k === "string" || typeof k === "boolean" || (typeof k === "number" && Number.isFinite(k)),
    );
    if (!ok) return false;
  }
  if (p.id !== undefined && typeof p.id !== "string") return false;
  if (p.offset !== undefined && (typeof p.offset !== "number" || !Number.isSafeInteger(p.offset) || p.offset < 0)) return false;
  return true;
}

type FingerprintInput = Pick<GridQuery, "filter" | "sort" | "search" | "groupBy">;

/**
 * Stable short hash of filter + sort + search + groupBy (+ schemaVersion when given),
 * used to invalidate stale cursors — including after a schema change.
 */
export function queryFingerprint(query: FingerprintInput, schemaVersion?: number): string {
  const canonical = canonicalize({
    schemaVersion: schemaVersion ?? null,
    filter: query.filter ?? null,
    sort: query.sort ?? [],
    search: query.search ?? "",
    groupBy: query.groupBy ?? [],
  });
  return createHash("sha1").update(JSON.stringify(canonical)).digest("hex").slice(0, 16);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** Throws `CursorError` when a decoded cursor's fingerprint doesn't match the current query. */
export function assertCursorMatches(payload: CursorPayload, fp: string): void {
  if (payload.fp !== fp) {
    throw new CursorError("Cursor does not match the current query", { expected: fp, actual: payload.fp });
  }
}
