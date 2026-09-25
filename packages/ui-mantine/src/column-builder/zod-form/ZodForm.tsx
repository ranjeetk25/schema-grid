import { Fieldset, NumberInput, Select, Stack, Switch, TextInput } from "@mantine/core";
import { useMemo } from "react";
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
  return children.some(
    ({ field }) => field.defaultValue !== undefined || (field.kind === "object" && hasAnyDefault(field.children)),
  );
}

interface FieldProps {
  name: string;
  path: string;
  field: FormFieldDescriptor;
  value: unknown;
  onChange: (next: unknown) => void;
  errors: Record<string, string>;
}

function Field({ name, path, field, value, onChange, errors }: FieldProps) {
  const label = field.optional ? `${humanizeKey(name)} (optional)` : humanizeKey(name);
  const description = field.description;
  const error = errors[path];

  switch (field.kind) {
    case "string":
      return (
        <TextInput
          label={label}
          description={description}
          error={error}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => {
            const text = e.currentTarget.value;
            onChange(text === "" && field.optional ? undefined : text);
          }}
        />
      );
    case "number":
      return (
        <NumberInput
          label={label}
          description={description}
          error={error}
          value={typeof value === "number" ? value : ""}
          min={field.min}
          max={field.max}
          allowDecimal={!field.int}
          onChange={(next) => onChange(typeof next === "number" ? next : undefined)}
        />
      );
    case "boolean":
      return (
        <Switch
          label={label}
          description={description}
          error={error}
          checked={value === true}
          onChange={(e) => onChange(e.currentTarget.checked)}
        />
      );
    case "enum":
      return (
        <Select
          label={label}
          description={description}
          error={error}
          data={field.values}
          value={typeof value === "string" ? value : null}
          clearable={field.optional}
          comboboxProps={{ withinPortal: false }}
          onChange={(next) => onChange(next ?? undefined)}
        />
      );
    case "optionList":
      return (
        <OptionListField
          label={label}
          description={description}
          error={error}
          value={value}
          hasColor={field.hasColor}
          valueKey={field.valueKey}
          onChange={onChange}
          rowError={(index, key) => errors[`${path}.${index}.${key}`]}
        />
      );
    case "object": {
      const objectValue = isPlainObject(value) ? value : {};
      return (
        <Fieldset legend={label}>
          {description && <div style={{ fontSize: "var(--mantine-font-size-xs)", marginBottom: 8 }}>{description}</div>}
          <Fields
            fields={field.children}
            value={objectValue}
            onChange={onChange}
            errors={errors}
            pathPrefix={`${path}.`}
          />
          {error && (
            <div role="alert" style={{ color: "var(--mantine-color-error)", fontSize: "var(--mantine-font-size-xs)" }}>
              {error}
            </div>
          )}
        </Fieldset>
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
}: {
  fields: FormFieldChild[];
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  errors: Record<string, string>;
  pathPrefix: string;
}) {
  const effective = withDefaults(fields, value);
  const setKey = (key: string, next: unknown) => {
    const out = { ...effective };
    if (next === undefined) delete out[key];
    else out[key] = next;
    onChange(out);
  };
  return (
    <Stack gap="sm">
      {fields.map(({ key, field }) => (
        <Field
          key={key}
          name={key}
          path={`${pathPrefix}${key}`}
          field={field}
          value={effective[key]}
          onChange={(next) => setKey(key, next)}
          errors={errors}
        />
      ))}
    </Stack>
  );
}

const EMPTY_ERRORS: Record<string, string> = {};

/** Auto-form driven by a Zod object schema (v3 or v4). Missing keys display — and emit — schema defaults. */
export function ZodForm({ schema, value, onChange, errors = EMPTY_ERRORS }: ZodFormProps) {
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
  return <Fields fields={descriptor.children} value={value ?? {}} onChange={onChange} errors={errors} pathPrefix="" />;
}
