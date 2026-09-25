import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import type { GridSchema } from "@masai/schema-grid-core";

/**
 * In-memory holder of the grid schema, persisted as JSON to `filePath`
 * (`null` = memory only). The persisted file is always the last schema whose
 * DDL was applied, so a restart diffs generated columns against it.
 */
export class SchemaStore {
  private current: GridSchema;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly filePath: string | null,
    fallback: () => GridSchema,
  ) {
    this.current = this.readFile() ?? fallback();
  }

  /** The schema read from disk at construction, or null (fresh install). */
  static readPersisted(filePath: string | null): GridSchema | null {
    if (!filePath || !existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, "utf8")) as GridSchema;
  }

  private readFile(): GridSchema | null {
    return SchemaStore.readPersisted(this.filePath);
  }

  get(): GridSchema {
    return this.current;
  }

  /** Replaces the schema and writes it to disk (atomic rename). */
  set(schema: GridSchema): void {
    this.current = schema;
    if (!this.filePath) return;
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(schema, null, 2)}\n`);
    renameSync(tmp, this.filePath);
  }

  /** Deletes the persisted file (the in-memory schema is left as is). */
  clearFile(): void {
    if (this.filePath && existsSync(this.filePath)) rmSync(this.filePath);
  }

  /** Serialises read-modify-write updates (PUT /schema, createOption, reset). */
  exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }
}
