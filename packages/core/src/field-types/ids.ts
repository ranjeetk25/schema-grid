export const BUILTIN_FIELD_TYPE_IDS = [
  "text",
  "longText",
  "number",
  "currency",
  "boolean",
  "date",
  "datetime",
  "select",
  "multiSelect",
  "creatableSelect",
  "user",
  "url",
  "email",
  "phone",
  "link",
  "formula",
] as const;

export type BuiltinFieldTypeId = (typeof BUILTIN_FIELD_TYPE_IDS)[number];

/** Built-in ids plus any custom string id. */
export type FieldTypeId = BuiltinFieldTypeId | (string & {});
