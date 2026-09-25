import type { LinkRef, Option } from "../common/types";
import type { GridQuery, QueryResult } from "../query/types";
import type { ChangeBatch, ChangeFeedEntry, ChangeResult, GridRow } from "../rows/types";

/** An optional id plus a partial cells record, used to create rows. */
export type RowPartial<Row extends GridRow = GridRow> = {
  id?: string;
  cells?: Partial<Row["cells"]>;
};

export interface DataSource<Row extends GridRow = GridRow> {
  fetch(query: GridQuery): Promise<QueryResult<Row>>;
  applyChanges(batch: ChangeBatch): Promise<ChangeResult>;
  createRows(partials: RowPartial<Row>[]): Promise<Row[]>;
  deleteRows(ids: string[]): Promise<void>;
  getChanges?(since: string): Promise<ChangeFeedEntry<Row>>;
  getOptions?(columnId: string, search?: string): Promise<Option[]>;
  createOption?(columnId: string, label: string): Promise<Option>;
  lookup?(columnId: string, search: string): Promise<LinkRef[]>;
}
