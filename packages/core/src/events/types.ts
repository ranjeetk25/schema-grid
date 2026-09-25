import type { Option } from "../common/types";
import type { ColumnDef, ViewDef } from "../schema/types";
import type {
  ChangeBatch,
  ChangeConflict,
  ChangeFeedEntry,
  ChangeResult,
  GridRow,
} from "../rows/types";

export interface GridEvents<Row extends GridRow = GridRow> {
  beforeCellsChange?(batch: ChangeBatch): Promise<ChangeBatch | false>;
  onCellsChange?(result: ChangeResult): void;
  onRowsCreate?(rows: Row[]): void;
  onRowsDelete?(ids: string[]): void;
  onColumnCreate?(column: ColumnDef): void;
  onColumnUpdate?(column: ColumnDef, prev: ColumnDef): void;
  onColumnDelete?(column: ColumnDef): void;
  onOptionCreate?(columnId: string, option: Option): void;
  onViewChange?(view: ViewDef): void;
  onConflict?(conflicts: ChangeConflict[]): void;
  onRemoteChanges?(entry: ChangeFeedEntry<Row>): void;
}

export type GridEventName = keyof GridEvents;
