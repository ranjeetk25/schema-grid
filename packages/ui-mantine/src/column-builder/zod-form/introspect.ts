/**
 * Zod schema introspection for the auto-form (spec §4 column builder).
 *
 * Supports both Zod majors through a tiny detection layer:
 * - v3: `schema._def.typeName` ("ZodString", "ZodOptional", ...); `ZodDefault._def.defaultValue` is a FUNCTION.
 * - v4: `schema._zod.def.type` ("string", "optional", ...); `default` def's `defaultValue` is a VALUE (a getter).
 * The input is `unknown` and this never throws: anything unrecognised becomes `unsupported`.
 */

interface DescriptorBase {
  optional: boolean;
  defaultValue?: unknown;
  description?: string;
}

export type FormFieldDescriptor = DescriptorBase &
  (
    | { kind: "string" }
    | { kind: "number"; min?: number; max?: number; int?: boolean }
    | { kind: "boolean" }
    | { kind: "enum"; values: string[] }
    | { kind: "optionList"; hasColor: boolean }
    | { kind: "object"; children: FormFieldChild[] }
    | { kind: "unsupported"; reason: string }
  );

export interface FormFieldChild {
  key: string;
  field: FormFieldDescriptor;
}

export type FormFieldKind = FormFieldDescriptor["kind"];

type Tag =
  | "string"
  | "number"
  | "boolean"
  | "enum"
  | "object"
  | "array"
  | "optional"
  | "nullable"
  | "default"
  | "wrapper"
  | "unknown";

interface Node {
  tag: Tag;
  /** The raw major-specific type name, for error messages. */
  typeName: string;
  def: Record<string, unknown>;
  description?: string;
  /** v3 = 3, v4 = 4 */
  major: 3 | 4;
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";

function safeGet(obj: unknown, key: string): unknown {
  if (!isRecord(obj) && typeof obj !== "function") return undefined;
  try {
    return (obj as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

const V3_TAGS: Record<string, Tag> = {
  ZodString: "string",
  ZodNumber: "number",
  ZodBoolean: "boolean",
  ZodEnum: "enum",
  ZodNativeEnum: "enum",
  ZodObject: "object",
  ZodArray: "array",
  ZodOptional: "optional",
  ZodNullable: "nullable",
  ZodDefault: "default",
  ZodEffects: "wrapper",
  ZodBranded: "wrapper",
  ZodReadonly: "wrapper",
  ZodCatch: "wrapper",
};

const V4_TAGS: Record<string, Tag> = {
  string: "string",
  number: "number",
  boolean: "boolean",
  enum: "enum",
  object: "object",
  array: "array",
  optional: "optional",
  nullable: "nullable",
  default: "default",
  prefault: "default",
  pipe: "wrapper",
  readonly: "wrapper",
  catch: "wrapper",
};

function readNode(schema: unknown): Node | null {
  const zod = safeGet(schema, "_zod");
  const v4def = safeGet(zod, "def");
  if (isRecord(v4def) && typeof v4def.type === "string") {
    const description = safeGet(schema, "description");
    return {
      tag: V4_TAGS[v4def.type] ?? "unknown",
      typeName: v4def.type,
      def: v4def,
      description: typeof description === "string" ? description : undefined,
      major: 4,
    };
  }
  const v3def = safeGet(schema, "_def");
  if (isRecord(v3def) && typeof v3def.typeName === "string") {
    const description = safeGet(v3def, "description");
    return {
      tag: V3_TAGS[v3def.typeName] ?? "unknown",
      typeName: v3def.typeName,
      def: v3def,
      description: typeof description === "string" ? description : undefined,
      major: 3,
    };
  }
  return null;
}

/** The schema wrapped by an optional/nullable/default/effects/pipe node. */
function innerOf(node: Node): unknown {
  if (node.major === 3) {
    // ZodEffects keeps its input under `schema`; branded under `type`; the rest under `innerType`.
    return safeGet(node.def, "innerType") ?? safeGet(node.def, "schema") ?? safeGet(node.def, "type");
  }
  // v4 pipe (e.g. `.transform`) — the form edits the INPUT side.
  if (node.typeName === "pipe") return safeGet(node.def, "in");
  return safeGet(node.def, "innerType");
}

function readDefault(node: Node): unknown {
  const raw = safeGet(node.def, "defaultValue");
  if (node.major === 3 && typeof raw === "function") {
    try {
      return (raw as () => unknown)();
    } catch {
      return undefined;
    }
  }
  return raw;
}

function enumValues(node: Node): string[] | null {
  if (node.major === 3) {
    const values = safeGet(node.def, "values");
    if (Array.isArray(values)) return values.filter((v): v is string => typeof v === "string");
    // ZodNativeEnum: values is an object
    if (isRecord(values)) return Object.values(values).filter((v): v is string => typeof v === "string");
    return null;
  }
  const entries = safeGet(node.def, "entries");
  if (!isRecord(entries)) return null;
  return Object.values(entries).filter((v): v is string => typeof v === "string");
}

function objectShape(node: Node): Record<string, unknown> | null {
  let shape = safeGet(node.def, "shape");
  if (typeof shape === "function") {
    try {
      shape = (shape as () => unknown)();
    } catch {
      return null;
    }
  }
  return isRecord(shape) ? shape : null;
}

function numberBounds(node: Node): { min?: number; max?: number; int?: boolean } {
  const out: { min?: number; max?: number; int?: boolean } = {};
  const checks = safeGet(node.def, "checks");
  if (!Array.isArray(checks)) return out;
  const pending: Array<{ side: "min" | "max"; value: number; inclusive: boolean }> = [];
  for (const check of checks) {
    if (node.major === 3) {
      const kind = safeGet(check, "kind");
      const value = safeGet(check, "value");
      const inclusive = safeGet(check, "inclusive") !== false;
      if (kind === "int") out.int = true;
      else if ((kind === "min" || kind === "max") && typeof value === "number") pending.push({ side: kind, value, inclusive });
    } else {
      const cdef = safeGet(safeGet(check, "_zod"), "def");
      const kind = safeGet(cdef, "check");
      const value = safeGet(cdef, "value");
      const inclusive = safeGet(cdef, "inclusive") !== false;
      if (kind === "number_format") {
        const format = safeGet(cdef, "format");
        if (format === "safeint" || format === "int32" || format === "uint32") out.int = true;
      } else if (kind === "greater_than" && typeof value === "number") pending.push({ side: "min", value, inclusive });
      else if (kind === "less_than" && typeof value === "number") pending.push({ side: "max", value, inclusive });
    }
  }
  for (const { side, value, inclusive } of pending) {
    // Exclusive bounds are only representable for integers (e.g. `.positive().int()` → min 1).
    if (!inclusive && !out.int) continue;
    const bound = inclusive ? value : side === "min" ? value + 1 : value - 1;
    if (side === "min") out.min = out.min === undefined ? bound : Math.max(out.min, bound);
    else out.max = out.max === undefined ? bound : Math.min(out.max, bound);
  }
  return out;
}

const MAX_DEPTH = 16;

function describe(schema: unknown, depth: number): FormFieldDescriptor {
  if (depth > MAX_DEPTH) return { kind: "unsupported", reason: "Schema is nested too deeply", optional: false };
  let node = readNode(schema);
  let optional = false;
  let hasDefault = false;
  let defaultValue: unknown;
  let description: string | undefined;

  // Peel wrappers, outermost first. The outermost description / default wins.
  for (let guard = 0; node && guard < MAX_DEPTH; guard += 1) {
    description ??= node.description;
    if (node.tag === "optional" || node.tag === "nullable") optional = true;
    else if (node.tag === "default") {
      if (!hasDefault) {
        hasDefault = true;
        defaultValue = readDefault(node);
      }
    } else if (node.tag !== "wrapper") break;
    node = readNode(innerOf(node));
  }

  const base: DescriptorBase = { optional };
  if (hasDefault) base.defaultValue = defaultValue;
  if (description !== undefined) base.description = description;

  if (!node) return { ...base, kind: "unsupported", reason: "Not a recognised Zod schema" };

  switch (node.tag) {
    case "string":
      return { ...base, kind: "string" };
    case "number":
      return { ...base, kind: "number", ...numberBounds(node) };
    case "boolean":
      return { ...base, kind: "boolean" };
    case "enum": {
      const values = enumValues(node);
      return values ? { ...base, kind: "enum", values } : { ...base, kind: "unsupported", reason: "Unreadable enum" };
    }
    case "object": {
      const shape = objectShape(node);
      if (!shape) return { ...base, kind: "unsupported", reason: "Unreadable object shape" };
      const children = Object.keys(shape).map((key) => ({ key, field: describe(shape[key], depth + 1) }));
      return { ...base, kind: "object", children };
    }
    case "array": {
      const element = node.major === 3 ? safeGet(node.def, "type") : safeGet(node.def, "element");
      const el = describe(element, depth + 1);
      if (el.kind === "object") {
        const byKey = new Map(el.children.map((c) => [c.key, c.field]));
        const label = byKey.get("label");
        const value = byKey.get("value");
        const color = byKey.get("color");
        if (label?.kind === "string" && value?.kind === "string") {
          return { ...base, kind: "optionList", hasColor: color?.kind === "string" };
        }
      }
      return { ...base, kind: "unsupported", reason: "Arrays are only supported as {label, value} option lists" };
    }
    default:
      return { ...base, kind: "unsupported", reason: `Unsupported Zod type: ${node.typeName}` };
  }
}

export function introspectZod(schema: unknown): FormFieldDescriptor {
  try {
    return describe(schema, 0);
  } catch (error) {
    return { kind: "unsupported", reason: error instanceof Error ? error.message : "Introspection failed", optional: false };
  }
}
