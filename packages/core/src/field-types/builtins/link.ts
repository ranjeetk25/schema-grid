import { z, type ZodType } from "zod";
import type { LinkRef } from "../../common/types";
import { LINK_OPERATORS } from "../../filter/operators";
import { compareWithEmptyLast } from "../empty";
import type { FieldType, ParseResult } from "../types";
import { resolveConfig } from "./config";

export interface LinkConfig {
  target: string;
  multiple: boolean;
}

const defaultConfig: LinkConfig = { target: "", multiple: true };

function isLinkRefShape(v: unknown): v is LinkRef {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const id = (v as Record<string, unknown>).id;
  const label = (v as Record<string, unknown>).label;
  return typeof id === "string" && id.length > 0 && typeof label === "string";
}

export const linkRefSchema: ZodType<LinkRef> = z.object({
  id: z.string().min(1),
  label: z.string(),
});

export const linkConfigSchema: ZodType<LinkConfig> = z.object({
  target: z.string(),
  multiple: z.boolean(),
});

function dedupById(refs: LinkRef[]): LinkRef[] {
  const seen = new Set<string>();
  const out: LinkRef[] = [];
  for (const ref of refs) {
    if (seen.has(ref.id)) continue;
    seen.add(ref.id);
    out.push(ref);
  }
  return out;
}

export const linkFieldType: FieldType<LinkRef[], LinkConfig> = {
  id: "link",
  label: "Link",
  configSchema: linkConfigSchema,
  defaultConfig,

  valueSchema(config: LinkConfig): ZodType<LinkRef[] | null> {
    const c = resolveConfig(defaultConfig, config);
    return z
      .array(linkRefSchema)
      .nullable()
      .refine((v) => v === null || c.multiple || v.length <= 1, {
        message: "only one link is allowed when multiple is false",
      });
  },

  parse(input: unknown, config: LinkConfig): ParseResult<LinkRef[]> {
    const c = resolveConfig(defaultConfig, config);
    let refs: LinkRef[];

    if (input === null || input === undefined) {
      refs = [];
    } else if (isLinkRefShape(input)) {
      refs = [input];
    } else if (Array.isArray(input)) {
      const out: LinkRef[] = [];
      for (const item of input) {
        if (isLinkRefShape(item)) {
          out.push(item);
        } else if (typeof item === "string" && item.trim().length > 0) {
          const id = item.trim();
          out.push({ id, label: id });
        } else {
          return { ok: false, error: "link array items must be LinkRefs or id strings" };
        }
      }
      refs = out;
    } else if (typeof input === "string") {
      const trimmed = input.trim();
      if (trimmed.length === 0) {
        refs = [];
      } else {
        refs = trimmed
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
          .map((id) => ({ id, label: id }));
      }
    } else {
      return { ok: false, error: "link value must be a LinkRef, an array, or a comma-separated id string" };
    }

    const deduped = dedupById(refs);
    if (!c.multiple && deduped.length > 1) {
      return { ok: false, error: "only one link is allowed when multiple is false" };
    }
    return { ok: true, value: deduped };
  },

  format(value: LinkRef[] | null | undefined): string {
    if (value === null || value === undefined || value.length === 0) return "";
    return value.map((ref) => ref.label).join(", ");
  },

  serialize(value: LinkRef[] | null): unknown {
    return value === null ? null : [...value];
  },

  deserialize(raw: unknown): LinkRef[] | null {
    if (!Array.isArray(raw)) return null;
    return raw.filter(isLinkRefShape);
  },

  compare(a: LinkRef[] | null, b: LinkRef[] | null): number {
    return compareWithEmptyLast(a, b, (x, y) => {
      const arrX = x as LinkRef[];
      const arrY = y as LinkRef[];
      const labelX = (arrX[0]?.label ?? "").toLowerCase();
      const labelY = (arrY[0]?.label ?? "").toLowerCase();
      if (labelX !== labelY) return labelX < labelY ? -1 : 1;
      return 0;
    });
  },

  operators: LINK_OPERATORS,

  defaultValue(): LinkRef[] {
    return [];
  },
};
