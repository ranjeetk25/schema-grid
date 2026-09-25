import { describe, expect, it } from "vitest";
import type { ColumnDef, GridSchema } from "../../src/schema/types";
import { migrateSchema, SchemaMigrationError, type SchemaMigration } from "../../src/schema/migrate";
import { getColumnById, getColumnByKey, indexColumns } from "../../src/schema/lookup";

function makeColumn(overrides: Partial<ColumnDef> = {}): ColumnDef {
  return {
    id: "col-1",
    key: "status",
    label: "Status",
    type: "text",
    config: {},
    order: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeSchema(overrides: Partial<GridSchema> = {}): GridSchema {
  return {
    id: "schema-1",
    schemaVersion: 1,
    columns: [makeColumn()],
    ...overrides,
  };
}

describe("migrateSchema", () => {
  it("applies migrations in ascending toVersion order even when shuffled", () => {
    const order: number[] = [];
    const migrations: SchemaMigration[] = [
      {
        toVersion: 3,
        migrate: (schema) => {
          order.push(3);
          return { ...schema, schemaVersion: 3 };
        },
      },
      {
        toVersion: 2,
        migrate: (schema) => {
          order.push(2);
          return { ...schema, schemaVersion: 2 };
        },
      },
    ];
    const result = migrateSchema(makeSchema(), migrations);
    expect(order).toEqual([2, 3]);
    expect(result.schemaVersion).toBe(3);
  });

  it("skips migrations whose toVersion is at or below the current schemaVersion", () => {
    const migrations: SchemaMigration[] = [
      { toVersion: 1, migrate: (schema) => ({ ...schema, schemaVersion: 1 }) },
      { toVersion: 2, migrate: (schema) => ({ ...schema, schemaVersion: 2 }) },
    ];
    const result = migrateSchema(makeSchema({ schemaVersion: 1 }), migrations);
    expect(result.schemaVersion).toBe(2);
  });

  it("sets schemaVersion to each migration's toVersion after it runs", () => {
    const migrations: SchemaMigration[] = [
      { toVersion: 2, migrate: (schema) => ({ ...schema, schemaVersion: 2 }) },
    ];
    const result = migrateSchema(makeSchema({ schemaVersion: 1 }), migrations);
    expect(result.schemaVersion).toBe(2);
  });

  it("stops at targetVersion when one is given", () => {
    const migrations: SchemaMigration[] = [
      { toVersion: 2, migrate: (schema) => ({ ...schema, schemaVersion: 2 }) },
      { toVersion: 3, migrate: (schema) => ({ ...schema, schemaVersion: 3 }) },
    ];
    const result = migrateSchema(makeSchema({ schemaVersion: 1 }), migrations, 2);
    expect(result.schemaVersion).toBe(2);
  });

  it("throws code 'gap' when versions jump", () => {
    const migrations: SchemaMigration[] = [
      { toVersion: 3, migrate: (schema) => ({ ...schema, schemaVersion: 3 }) },
    ];
    expect(() => migrateSchema(makeSchema({ schemaVersion: 1 }), migrations)).toThrow(
      SchemaMigrationError,
    );
    try {
      migrateSchema(makeSchema({ schemaVersion: 1 }), migrations);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(SchemaMigrationError);
      expect((err as SchemaMigrationError).code).toBe("gap");
    }
  });

  it("throws code 'duplicate' when two migrations share a toVersion", () => {
    const migrations: SchemaMigration[] = [
      { toVersion: 2, migrate: (schema) => ({ ...schema, schemaVersion: 2 }) },
      { toVersion: 2, migrate: (schema) => ({ ...schema, schemaVersion: 2 }) },
    ];
    try {
      migrateSchema(makeSchema({ schemaVersion: 1 }), migrations);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(SchemaMigrationError);
      expect((err as SchemaMigrationError).code).toBe("duplicate");
    }
  });

  it("throws code 'versionMismatch' when a migrate function returns a mismatched schemaVersion", () => {
    const migrations: SchemaMigration[] = [
      { toVersion: 2, migrate: (schema) => ({ ...schema, schemaVersion: 5 }) },
    ];
    try {
      migrateSchema(makeSchema({ schemaVersion: 1 }), migrations);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(SchemaMigrationError);
      expect((err as SchemaMigrationError).code).toBe("versionMismatch");
    }
  });

  it("does not mutate the input schema", () => {
    const input = Object.freeze(makeSchema({ schemaVersion: 1 }));
    const migrations: SchemaMigration[] = [
      {
        toVersion: 2,
        migrate: (schema) => ({
          ...schema,
          schemaVersion: 2,
          columns: [makeColumn({ label: "Changed" })],
        }),
      },
    ];
    expect(() => migrateSchema(input, migrations)).not.toThrow();
    expect(input.schemaVersion).toBe(1);
    expect(input.columns[0]?.label).toBe("Status");
  });

  it("returns a structurally equal schema when no migrations apply", () => {
    const input = makeSchema({ schemaVersion: 5 });
    const migrations: SchemaMigration[] = [
      { toVersion: 2, migrate: (schema) => ({ ...schema, schemaVersion: 2 }) },
    ];
    const result = migrateSchema(input, migrations);
    expect(result).toEqual(input);
    expect(result).not.toBe(input);
  });
});

describe("schema lookups", () => {
  const schema = makeSchema({
    columns: [
      makeColumn({ id: "col-1", key: "status" }),
      makeColumn({ id: "col-2", key: "owner", label: "Owner" }),
    ],
  });

  it("getColumnById finds by id and returns undefined for unknown", () => {
    expect(getColumnById(schema, "col-2")?.key).toBe("owner");
    expect(getColumnById(schema, "missing")).toBeUndefined();
  });

  it("getColumnByKey finds by key and returns undefined for unknown", () => {
    expect(getColumnByKey(schema, "status")?.id).toBe("col-1");
    expect(getColumnByKey(schema, "missing")).toBeUndefined();
  });

  it("indexColumns returns byId and byKey maps", () => {
    const index = indexColumns(schema);
    expect(index.byId.get("col-1")?.key).toBe("status");
    expect(index.byKey.get("owner")?.id).toBe("col-2");
    expect(index.byId.size).toBe(2);
    expect(index.byKey.size).toBe(2);
  });
});
