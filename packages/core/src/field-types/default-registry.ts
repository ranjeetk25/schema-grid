import { booleanFieldType } from "./builtins/boolean";
import { creatableSelectFieldType } from "./builtins/creatable-select";
import { currencyFieldType } from "./builtins/currency";
import { dateFieldType } from "./builtins/date";
import { datetimeFieldType } from "./builtins/datetime";
import { emailFieldType } from "./builtins/email";
import { formulaFieldType } from "./builtins/formula";
import { linkFieldType } from "./builtins/link";
import { longTextFieldType } from "./builtins/long-text";
import { multiSelectFieldType } from "./builtins/multi-select";
import { numberFieldType } from "./builtins/number";
import { phoneFieldType } from "./builtins/phone";
import { selectFieldType } from "./builtins/select";
import { textFieldType } from "./builtins/text";
import { urlFieldType } from "./builtins/url";
import { userFieldType } from "./builtins/user";
import { createFieldTypeRegistry, type FieldTypeRegistry } from "./registry";
import type { AnyFieldType } from "./types";

/** The 16 built-in field types, in BUILTIN_FIELD_TYPE_IDS order. */
export const builtinFieldTypes: readonly AnyFieldType[] = Object.freeze([
  textFieldType,
  longTextFieldType,
  numberFieldType,
  currencyFieldType,
  booleanFieldType,
  dateFieldType,
  datetimeFieldType,
  selectFieldType,
  multiSelectFieldType,
  creatableSelectFieldType,
  userFieldType,
  urlFieldType,
  emailFieldType,
  phoneFieldType,
  linkFieldType,
  formulaFieldType,
] as AnyFieldType[]);

/** Returns a new, independent registry containing all built-in types. */
export function createDefaultRegistry(): FieldTypeRegistry {
  return createFieldTypeRegistry(builtinFieldTypes);
}
