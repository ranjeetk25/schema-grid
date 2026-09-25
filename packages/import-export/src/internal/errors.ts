/** Thrown when an export/clipboard operation includes a column the user may not see. */
export class HiddenColumnError extends Error {
  readonly columnIds: string[];
  constructor(columnIds: string[]) {
    super(
      `Cannot include hidden or unauthorised column(s): ${columnIds.join(", ")}`,
    );
    this.name = "HiddenColumnError";
    this.columnIds = columnIds;
  }
}

/** Thrown by validateRows when the mapping/options are unusable (before any row is read). */
export class ImportConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportConfigError";
  }
}

/** Thrown by XLSX parsing when the requested sheet does not exist. */
export class SheetNotFoundError extends Error {
  readonly sheet: string | number;
  readonly sheetNames: string[];
  constructor(sheet: string | number, sheetNames: string[]) {
    super(
      `Sheet ${JSON.stringify(sheet)} not found. Available sheets: ${sheetNames.join(", ")}`,
    );
    this.name = "SheetNotFoundError";
    this.sheet = sheet;
    this.sheetNames = sheetNames;
  }
}
