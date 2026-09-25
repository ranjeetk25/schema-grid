import type { GridSchema } from "./types";

export type SchemaMigrationErrorCode = "gap" | "duplicate" | "versionMismatch";

export interface SchemaMigration {
  toVersion: number;
  description?: string;
  migrate(schema: GridSchema): GridSchema;
}

export class SchemaMigrationError extends Error {
  code: SchemaMigrationErrorCode;

  constructor(code: SchemaMigrationErrorCode, message: string) {
    super(message);
    this.name = "SchemaMigrationError";
    this.code = code;
  }
}

function cloneSchema(schema: GridSchema): GridSchema {
  return structuredClone(schema);
}

/**
 * Runs ordered `schemaVersion` migrations against a schema and returns a new
 * GridSchema. Never mutates its input.
 */
export function migrateSchema(
  schema: GridSchema,
  migrations: SchemaMigration[],
  targetVersion?: number,
): GridSchema {
  const sorted = [...migrations].sort((a, b) => a.toVersion - b.toVersion);

  const seenVersions = new Set<number>();
  for (const migration of sorted) {
    if (seenVersions.has(migration.toVersion)) {
      throw new SchemaMigrationError(
        "duplicate",
        `Duplicate migration for schemaVersion ${migration.toVersion}`,
      );
    }
    seenVersions.add(migration.toVersion);
  }

  let current = cloneSchema(schema);

  const applicable = sorted.filter((migration) => migration.toVersion > current.schemaVersion);
  const bounded =
    targetVersion === undefined
      ? applicable
      : applicable.filter((migration) => migration.toVersion <= targetVersion);

  let expected = current.schemaVersion + 1;
  for (const migration of bounded) {
    if (migration.toVersion !== expected) {
      throw new SchemaMigrationError(
        "gap",
        `Expected a migration to schemaVersion ${expected} before ${migration.toVersion}`,
      );
    }
    expected = migration.toVersion + 1;
  }

  for (const migration of bounded) {
    const result = migration.migrate(cloneSchema(current));
    if (result.schemaVersion !== migration.toVersion) {
      throw new SchemaMigrationError(
        "versionMismatch",
        `Migration to ${migration.toVersion} returned schemaVersion ${result.schemaVersion}`,
      );
    }
    current = { ...result, schemaVersion: migration.toVersion };
  }

  return current;
}
