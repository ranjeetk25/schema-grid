/**
 * Tabler icons used by ui-mantine, imported one module per icon instead of via the
 * `@tabler/icons-react` barrel (6k+ icons). Bundlers that tree-shake still end up
 * with the same code, but nothing has to parse/evaluate the barrel: Vite dev,
 * vitest and non-tree-shaking consumers load only these files.
 *
 * The per-icon `.mjs` files ship without typings (see ./tabler-icons.d.ts); each
 * export is re-typed as the barrel's `TablerIcon` so public types are unchanged.
 * The CJS build swaps this module for a barrel re-export (tsup.config.ts).
 *
 * To add an icon: import its default from `@tabler/icons-react/dist/esm/icons/<Name>.mjs`
 * and export it below.
 */
/// <reference path="./tabler-icons.d.ts" />
import type { TablerIcon } from "@tabler/icons-react";
import IconAlertCircleModule from "@tabler/icons-react/dist/esm/icons/IconAlertCircle.mjs";
import IconAlignLeftModule from "@tabler/icons-react/dist/esm/icons/IconAlignLeft.mjs";
import IconArrowAutofitContentModule from "@tabler/icons-react/dist/esm/icons/IconArrowAutofitContent.mjs";
import IconArrowAutofitWidthModule from "@tabler/icons-react/dist/esm/icons/IconArrowAutofitWidth.mjs";
import IconArrowDownModule from "@tabler/icons-react/dist/esm/icons/IconArrowDown.mjs";
import IconArrowRightModule from "@tabler/icons-react/dist/esm/icons/IconArrowRight.mjs";
import IconArrowUpModule from "@tabler/icons-react/dist/esm/icons/IconArrowUp.mjs";
import IconArrowsJoin2Module from "@tabler/icons-react/dist/esm/icons/IconArrowsJoin2.mjs";
import IconArrowsSortModule from "@tabler/icons-react/dist/esm/icons/IconArrowsSort.mjs";
import IconCalendarModule from "@tabler/icons-react/dist/esm/icons/IconCalendar.mjs";
import IconCalendarTimeModule from "@tabler/icons-react/dist/esm/icons/IconCalendarTime.mjs";
import IconCheckModule from "@tabler/icons-react/dist/esm/icons/IconCheck.mjs";
import IconChevronDownModule from "@tabler/icons-react/dist/esm/icons/IconChevronDown.mjs";
import IconChevronRightModule from "@tabler/icons-react/dist/esm/icons/IconChevronRight.mjs";
import IconChevronUpModule from "@tabler/icons-react/dist/esm/icons/IconChevronUp.mjs";
import IconCircleChevronDownModule from "@tabler/icons-react/dist/esm/icons/IconCircleChevronDown.mjs";
import IconCircleDotModule from "@tabler/icons-react/dist/esm/icons/IconCircleDot.mjs";
import IconCirclePlusModule from "@tabler/icons-react/dist/esm/icons/IconCirclePlus.mjs";
import IconCoinModule from "@tabler/icons-react/dist/esm/icons/IconCoin.mjs";
import IconColumnInsertLeftModule from "@tabler/icons-react/dist/esm/icons/IconColumnInsertLeft.mjs";
import IconColumnInsertRightModule from "@tabler/icons-react/dist/esm/icons/IconColumnInsertRight.mjs";
import IconCurrencyRupeeModule from "@tabler/icons-react/dist/esm/icons/IconCurrencyRupee.mjs";
import IconDeviceFloppyModule from "@tabler/icons-react/dist/esm/icons/IconDeviceFloppy.mjs";
import IconDownloadModule from "@tabler/icons-react/dist/esm/icons/IconDownload.mjs";
import IconEyeOffModule from "@tabler/icons-react/dist/esm/icons/IconEyeOff.mjs";
import IconFileSpreadsheetModule from "@tabler/icons-react/dist/esm/icons/IconFileSpreadsheet.mjs";
import IconFilterModule from "@tabler/icons-react/dist/esm/icons/IconFilter.mjs";
import IconHashModule from "@tabler/icons-react/dist/esm/icons/IconHash.mjs";
import IconLayoutListModule from "@tabler/icons-react/dist/esm/icons/IconLayoutList.mjs";
import IconLetterCaseModule from "@tabler/icons-react/dist/esm/icons/IconLetterCase.mjs";
import IconLetterTModule from "@tabler/icons-react/dist/esm/icons/IconLetterT.mjs";
import IconLinkModule from "@tabler/icons-react/dist/esm/icons/IconLink.mjs";
import IconLinkPlusModule from "@tabler/icons-react/dist/esm/icons/IconLinkPlus.mjs";
import IconLockModule from "@tabler/icons-react/dist/esm/icons/IconLock.mjs";
import IconMailModule from "@tabler/icons-react/dist/esm/icons/IconMail.mjs";
import IconMathFunctionModule from "@tabler/icons-react/dist/esm/icons/IconMathFunction.mjs";
import IconPencilModule from "@tabler/icons-react/dist/esm/icons/IconPencil.mjs";
import IconPhoneModule from "@tabler/icons-react/dist/esm/icons/IconPhone.mjs";
import IconPinnedModule from "@tabler/icons-react/dist/esm/icons/IconPinned.mjs";
import IconPinnedOffModule from "@tabler/icons-react/dist/esm/icons/IconPinnedOff.mjs";
import IconPlusModule from "@tabler/icons-react/dist/esm/icons/IconPlus.mjs";
import IconSearchModule from "@tabler/icons-react/dist/esm/icons/IconSearch.mjs";
import IconSortAscendingModule from "@tabler/icons-react/dist/esm/icons/IconSortAscending.mjs";
import IconSortDescendingModule from "@tabler/icons-react/dist/esm/icons/IconSortDescending.mjs";
import IconSquareCheckModule from "@tabler/icons-react/dist/esm/icons/IconSquareCheck.mjs";
import IconTagsModule from "@tabler/icons-react/dist/esm/icons/IconTags.mjs";
import IconTrashModule from "@tabler/icons-react/dist/esm/icons/IconTrash.mjs";
import IconUploadModule from "@tabler/icons-react/dist/esm/icons/IconUpload.mjs";
import IconUserModule from "@tabler/icons-react/dist/esm/icons/IconUser.mjs";
import IconUserCircleModule from "@tabler/icons-react/dist/esm/icons/IconUserCircle.mjs";
import IconWorldModule from "@tabler/icons-react/dist/esm/icons/IconWorld.mjs";
import IconXModule from "@tabler/icons-react/dist/esm/icons/IconX.mjs";

export type { Icon, TablerIcon } from "@tabler/icons-react";

export const IconAlertCircle: TablerIcon = IconAlertCircleModule;
export const IconAlignLeft: TablerIcon = IconAlignLeftModule;
export const IconArrowAutofitContent: TablerIcon = IconArrowAutofitContentModule;
export const IconArrowAutofitWidth: TablerIcon = IconArrowAutofitWidthModule;
export const IconArrowDown: TablerIcon = IconArrowDownModule;
export const IconArrowRight: TablerIcon = IconArrowRightModule;
export const IconArrowUp: TablerIcon = IconArrowUpModule;
export const IconArrowsJoin2: TablerIcon = IconArrowsJoin2Module;
export const IconArrowsSort: TablerIcon = IconArrowsSortModule;
export const IconCalendar: TablerIcon = IconCalendarModule;
export const IconCalendarTime: TablerIcon = IconCalendarTimeModule;
export const IconCheck: TablerIcon = IconCheckModule;
export const IconChevronDown: TablerIcon = IconChevronDownModule;
export const IconChevronRight: TablerIcon = IconChevronRightModule;
export const IconChevronUp: TablerIcon = IconChevronUpModule;
export const IconCircleChevronDown: TablerIcon = IconCircleChevronDownModule;
export const IconCircleDot: TablerIcon = IconCircleDotModule;
export const IconCirclePlus: TablerIcon = IconCirclePlusModule;
export const IconCoin: TablerIcon = IconCoinModule;
export const IconColumnInsertLeft: TablerIcon = IconColumnInsertLeftModule;
export const IconColumnInsertRight: TablerIcon = IconColumnInsertRightModule;
export const IconCurrencyRupee: TablerIcon = IconCurrencyRupeeModule;
export const IconDeviceFloppy: TablerIcon = IconDeviceFloppyModule;
export const IconDownload: TablerIcon = IconDownloadModule;
export const IconEyeOff: TablerIcon = IconEyeOffModule;
export const IconFileSpreadsheet: TablerIcon = IconFileSpreadsheetModule;
export const IconFilter: TablerIcon = IconFilterModule;
export const IconHash: TablerIcon = IconHashModule;
export const IconLayoutList: TablerIcon = IconLayoutListModule;
export const IconLetterCase: TablerIcon = IconLetterCaseModule;
export const IconLetterT: TablerIcon = IconLetterTModule;
export const IconLink: TablerIcon = IconLinkModule;
export const IconLinkPlus: TablerIcon = IconLinkPlusModule;
export const IconLock: TablerIcon = IconLockModule;
export const IconMail: TablerIcon = IconMailModule;
export const IconMathFunction: TablerIcon = IconMathFunctionModule;
export const IconPencil: TablerIcon = IconPencilModule;
export const IconPhone: TablerIcon = IconPhoneModule;
export const IconPinned: TablerIcon = IconPinnedModule;
export const IconPinnedOff: TablerIcon = IconPinnedOffModule;
export const IconPlus: TablerIcon = IconPlusModule;
export const IconSearch: TablerIcon = IconSearchModule;
export const IconSortAscending: TablerIcon = IconSortAscendingModule;
export const IconSortDescending: TablerIcon = IconSortDescendingModule;
export const IconSquareCheck: TablerIcon = IconSquareCheckModule;
export const IconTags: TablerIcon = IconTagsModule;
export const IconTrash: TablerIcon = IconTrashModule;
export const IconUpload: TablerIcon = IconUploadModule;
export const IconUser: TablerIcon = IconUserModule;
export const IconUserCircle: TablerIcon = IconUserCircleModule;
export const IconWorld: TablerIcon = IconWorldModule;
export const IconX: TablerIcon = IconXModule;
