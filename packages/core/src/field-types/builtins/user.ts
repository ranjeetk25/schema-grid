import { z, type ZodType } from "zod";
import type { UserRef } from "../../common/types";
import { USER_OPERATORS } from "../../filter/operators";
import { compareWithEmptyLast } from "../empty";
import type { FieldType, ParseResult } from "../types";

// biome-ignore lint/complexity/noBannedTypes: config is intentionally empty.
export type UserConfig = Record<string, never>;

const defaultConfig: UserConfig = {};

function isUserRefShape(v: unknown): v is UserRef {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const id = (v as Record<string, unknown>).id;
  const name = (v as Record<string, unknown>).name;
  return typeof id === "string" && id.length > 0 && (name === undefined || typeof name === "string");
}

export const userValueSchema: ZodType<UserRef> = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
});

export const userFieldType: FieldType<UserRef, UserConfig> = {
  id: "user",
  label: "User",
  configSchema: z.object({}),
  defaultConfig,

  valueSchema(): ZodType<UserRef | null> {
    return userValueSchema.nullable();
  },

  parse(input: unknown): ParseResult<UserRef | null> {
    if (input === null || input === undefined) return { ok: true, value: null };
    if (isUserRefShape(input)) return { ok: true, value: input };
    if (typeof input === "number" && Number.isFinite(input)) {
      return { ok: true, value: { id: String(input) } };
    }
    if (typeof input === "string") {
      const trimmed = input.trim();
      if (trimmed.length === 0) return { ok: true, value: null };
      return { ok: true, value: { id: trimmed } };
    }
    return { ok: false, error: "user value must be a UserRef, an id string, or a number" };
  },

  format(value: UserRef | null | undefined): string {
    if (value === null || value === undefined) return "";
    return value.name ?? value.id;
  },

  serialize(value: UserRef | null): unknown {
    return value;
  },

  deserialize(raw: unknown): UserRef | null {
    return isUserRefShape(raw) ? raw : null;
  },

  compare(a: UserRef | null, b: UserRef | null): number {
    return compareWithEmptyLast(a, b, (x, y) => {
      const refX = x as UserRef;
      const refY = y as UserRef;
      const keyX = (refX.name ?? refX.id).toLowerCase();
      const keyY = (refY.name ?? refY.id).toLowerCase();
      if (keyX !== keyY) return keyX < keyY ? -1 : 1;
      if (refX.id === refY.id) return 0;
      return refX.id < refY.id ? -1 : 1;
    });
  },

  operators: USER_OPERATORS,

  defaultValue(): UserRef | null {
    return null;
  },
};
