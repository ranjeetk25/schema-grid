import {
  IconAlignLeft,
  IconArrowsJoin2,
  IconCalendar,
  IconCalendarTime,
  IconCircleChevronDown,
  IconCirclePlus,
  IconCoin,
  IconHash,
  IconLetterCase,
  IconLink,
  IconMail,
  IconMathFunction,
  IconPhone,
  IconSquareCheck,
  IconTags,
  IconUserCircle,
} from "../internal/icons";
import type { FieldTypeId } from "../internal/core-contracts";

type TablerIcon = typeof IconHash;

const ICONS: Record<string, TablerIcon> = {
  text: IconLetterCase,
  longText: IconAlignLeft,
  number: IconHash,
  currency: IconCoin,
  boolean: IconSquareCheck,
  date: IconCalendar,
  datetime: IconCalendarTime,
  select: IconCircleChevronDown,
  multiSelect: IconTags,
  creatableSelect: IconCirclePlus,
  user: IconUserCircle,
  url: IconLink,
  email: IconMail,
  phone: IconPhone,
  link: IconArrowsJoin2,
  formula: IconMathFunction,
};

/** The Tabler icon of a field type (unknown types read as text). */
export function columnTypeIconComponent(type: FieldTypeId | string | undefined): TablerIcon {
  return (type && ICONS[type]) || IconLetterCase;
}

/** 14px type glyph for pickers and menus (decorative). */
export function ColumnTypeIcon({ type, size = 14 }: { type: FieldTypeId | string | undefined; size?: number }) {
  const Icon = columnTypeIconComponent(type);
  return <Icon size={size} stroke={1.75} aria-hidden />;
}
