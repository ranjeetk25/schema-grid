import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Field as FieldShell } from "../../ui/field";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/select";
import { Switch } from "../../ui/switch";
import { JsonFallbackField } from "./JsonFallbackField";
import { OptionListField } from "./OptionListField";
import { type FormFieldChild, type FormFieldDescriptor, introspectZod } from "./introspect";

export interface ZodFormProps {
  /** A Zod (v3 or v4) object schema. */
  schema: unknown;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  /** Dot-path → message, e.g. `{ "options.0.label": "Required" }`. */
  errors?: Record<string, string>;
  /** Roles for option lists' per-option "Who can set" control (core `Option.settableBy`). */
  roles?: string[];
}

/** "maxLength" / "max_length" → "Max length". */
export function humanizeKey(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-.]+/g, " ")
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Fills missing keys with schema defaults (recursively into nested objects). */
function withDefaults(children: FormFieldChild[], value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...value };
  for (const { key, field } of children) {
    if (out[key] === undefined && "defaultValue" in field && field.defaultValue !== undefined) out[key] = field.defaultValue;
    if (field.kind === "object") {
      const current = out[key];
      if (isPlainObject(current)) out[key] = withDefaults(field.children, current);
      else if (current === undefined && hasAnyDefault(field.children)) out[key] = withDefaults(field.children, {});
    }
  }
  return out;
}

function hasAnyDefault(children: FormFieldChild[]): boolean {
  return children.some(({ field }) => field.defaultValue !== undefined || (field.kind === "object" && hasAnyDefault(field.children)));
}

const NONE = "__sg_none__";

/** Text box that keeps the raw text while typing and emits a number (or undefined when blank/partial). */
function NumberField({
  label,
  description,
  error,
  value,
  onChange,
  int,
}: {
  label: string;
  description?: string;
  error?: string;
  value: unknown;
  onChange: (next: number | undefined) => void;
  int?: boolean;
}) {
  const external = typeof value === "number" ? value : undefined;
  const [text, setText] = useState(external === undefined ? "" : String(external));
  const lastEmitted = useRef<number | undefined>(external);
  useEffect(() => {
    if (external === lastEmitted.current) return;
    lastEmitted.current = external;
    setText(external === undefined ? "" : String(external));
  }, [external]);

  return (
    <FieldShell label={label} description={description} error={error}>
      {({ id, describedBy, invalid }) => (
        <Input
          id={id}
          type="text"
          inputMode={int ? "numeric" : "decimal"}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          value={text}
          className="sg:w-40"
          onChange={(e) => {
            const raw = e.currentTarget.value;
            setText(raw);
            const trimmed = raw.trim();
            const parsed = trimmed === "" ? undefined : Number(trimmed);
            const next = parsed !== undefined && Number.isFinite(parsed) ? parsed : undefined;
            lastEmitted.current = next;
            onChange(next);
          }}
        />
      )}
    </FieldShell>
  );
}

function SwitchField({
  label,
  description,
  error,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  error?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="sg:flex sg:items-start sg:justify-between sg:gap-4">
      <div className="sg:flex sg:flex-col sg:gap-0.5">
        <Label htmlFor={id}>{label}</Label>
        {description ? <p className="sg:text-xs sg:text-muted-foreground">{description}</p> : null}
        {error ? (
          <p role="alert" className="sg:text-xs sg:text-danger">
            {error}
          </p>
        ) : null}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} className="sg:mt-0.5" />
    </div>
  );
}

interface FieldProps {
  name: string;
  path: string;
  field: FormFieldDescriptor;
  value: unknown;
  onChange: (next: unknown) => void;
  errors: Record<string, string>;
  roles?: string[];
}

function Field({ name, path, field, value, onChange, errors, roles }: FieldProps) {
  const label = field.optional ? `${humanizeKey(name)} (optional)` : humanizeKey(name);
  const description = field.description;
  const error = errors[path];

  switch (field.kind) {
    case "string":
      return (
        <FieldShell label={label} description={description} error={error}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              value={typeof value === "string" ? value : ""}
              onChange={(e) => {
                const text = e.currentTarget.value;
                onChange(text === "" && field.optional ? undefined : text);
              }}
            />
          )}
        </FieldShell>
      );
    case "number":
      return (
        <NumberField
          label={label}
          description={description}
          error={error}
          value={value}
          int={field.int}
          onChange={onChange}
        />
      );
    case "boolean":
      return <SwitchField label={label} description={description} error={error} checked={value === true} onChange={onChange} />;
    case "enum":
      return (
        <FieldShell label={label} description={description} error={error}>
          {({ id, describedBy, invalid }) => (
            <Select
              value={typeof value === "string" ? value : field.optional ? NONE : ""}
              onValueChange={(next) => onChange(next === NONE ? undefined : next)}
            >
              <SelectTrigger id={id} aria-describedby={describedBy} aria-invalid={invalid || undefined}>
                <SelectValue placeholder="Choose…" />
              </SelectTrigger>
              <SelectContent>
                {field.optional ? (
                  <SelectItem value={NONE} className="sg:text-muted-foreground">
                    Not set
                  </SelectItem>
                ) : null}
                {field.values.map((v) => (
                  <SelectItem key={v} value={v}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FieldShell>
      );
    case "optionList":
      return (
        <OptionListField
          label={label === "Options" ? "Choices" : label}
          description={description}
          error={error}
          value={value}
          hasColor={field.hasColor}
          valueKey={field.valueKey}
          onChange={onChange}
          {...(roles ? { roles } : {})}
          rowError={(index, key) => errors[`${path}.${index}.${key}`]}
        />
      );
    case "object": {
      const objectValue = isPlainObject(value) ? value : {};
      return (
        <fieldset className="sg:m-0 sg:flex sg:min-w-0 sg:flex-col sg:gap-3 sg:border-0 sg:border-l sg:border-border sg:p-0 sg:pl-3">
          <legend className="sg:mb-2 sg:p-0 sg:text-sm sg:font-medium sg:text-foreground">{label}</legend>
          {description ? <p className="sg:-mt-1 sg:text-xs sg:text-muted-foreground">{description}</p> : null}
          <Fields fields={field.children} value={objectValue} onChange={onChange} errors={errors} pathPrefix={`${path}.`} {...(roles ? { roles } : {})} />
          {error ? (
            <p role="alert" className="sg:text-xs sg:text-danger">
              {error}
            </p>
          ) : null}
        </fieldset>
      );
    }
    case "unsupported":
      return <JsonFallbackField label={label} description={description ?? field.reason} error={error} value={value} onChange={onChange} />;
  }
}

function Fields({
  fields,
  value,
  onChange,
  errors,
  pathPrefix,
  roles,
}: {
  fields: FormFieldChild[];
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  errors: Record<string, string>;
  pathPrefix: string;
  roles?: string[];
}) {
  const effective = withDefaults(fields, value);
  const setKey = (key: string, next: unknown) => {
    const out = { ...effective };
    if (next === undefined) delete out[key];
    else out[key] = next;
    onChange(out);
  };
  return (
    <div className="sg:flex sg:flex-col sg:gap-4">
      {fields.map(({ key, field }) => (
        <Field
          key={key}
          name={key}
          path={`${pathPrefix}${key}`}
          field={field}
          value={effective[key]}
          onChange={(next) => setKey(key, next)}
          errors={errors}
          {...(roles ? { roles } : {})}
        />
      ))}
    </div>
  );
}

const EMPTY_ERRORS: Record<string, string> = {};

/** Auto-form driven by a Zod object schema (v3 or v4). Missing keys display — and emit — schema defaults. */
export function ZodForm({ schema, value, onChange, errors = EMPTY_ERRORS, roles }: ZodFormProps) {
  const descriptor = useMemo(() => introspectZod(schema), [schema]);
  if (descriptor.kind !== "object") {
    return (
      <JsonFallbackField
        label="Configuration"
        description={descriptor.kind === "unsupported" ? descriptor.reason : undefined}
        value={value}
        onChange={(next) => {
          if (isPlainObject(next)) onChange(next);
        }}
      />
    );
  }
  return <Fields fields={descriptor.children} value={value ?? {}} onChange={onChange} errors={errors} pathPrefix="" {...(roles ? { roles } : {})} />;
}
