import type { GridDb } from "@ranjeetk25/schema-grid-server/drizzle";
import { sql } from "drizzle-orm";
import { boolean, date, int, mysqlEnum, mysqlTable, timestamp, varchar } from "drizzle-orm/mysql-core";
import { rawQuery } from "../db";

export const PAYMENT_STATUSES = ["paid", "pending", "failed"] as const;
export const LEADS_SEED_COUNT = 1200;

/** A plain, pre-existing-style table: no `cells` JSON, no version column. */
export function leadsTable(name = "leads") {
  return mysqlTable(name, {
    id: int("id").autoincrement().primaryKey(),
    name: varchar("name", { length: 120 }).notNull(),
    email: varchar("email", { length: 190 }).notNull(),
    paymentStatus: mysqlEnum("payment_status", PAYMENT_STATUSES),
    callDate: date("call_date", { mode: "string" }),
    aiVerified: boolean("ai_verified").notNull().default(false),
    updatedAt: timestamp("updated_at", { mode: "string", fsp: 3 }).notNull().defaultNow().onUpdateNow(),
  });
}

export type LeadsTable = ReturnType<typeof leadsTable>;

const quote = (name: string) => `\`${name.replace(/`/g, "``")}\``;

/** `CREATE TABLE IF NOT EXISTS` for the leads table. */
export function createLeadsTableDDL(name = "leads"): string {
  return `CREATE TABLE IF NOT EXISTS ${quote(name)} (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(190) NOT NULL,
  payment_status ENUM('paid','pending','failed') NULL,
  call_date DATE NULL,
  ai_verified BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY ${quote(`${name}_updated_at`)} (updated_at)
)`;
}

export interface LeadSeed {
  id: number;
  name: string;
  email: string;
  paymentStatus: (typeof PAYMENT_STATUSES)[number] | null;
  callDate: string;
  aiVerified: boolean;
}

/** The i-th seeded lead (1-based), deterministic for a given clock: status cycles every 4, call date every 7 days. */
export function leadSeed(i: number, now: Date, tz: string): LeadSeed {
  const day = new Date(now.getTime() - (i % 7) * 86_400_000);
  return {
    id: i,
    name: `Lead ${String(i).padStart(4, "0")}`,
    email: `lead${i}@example.com`,
    paymentStatus: [null, "paid", "pending", "failed"][i % 4] as LeadSeed["paymentStatus"],
    callDate: day.toLocaleDateString("en-CA", { timeZone: tz }),
    aiVerified: i % 3 === 0,
  };
}

/** Creates the table if missing and seeds `count` leads when it is empty. Returns the number inserted. */
export async function ensureLeads(
  db: GridDb,
  table: LeadsTable,
  name: string,
  now: Date,
  tz: string,
  count = LEADS_SEED_COUNT,
): Promise<number> {
  await db.execute(sql.raw(createLeadsTableDDL(name)));
  const [row] = await rawQuery<{ n: number | string }>(db, `SELECT COUNT(*) AS n FROM ${quote(name)}`);
  if (Number(row?.n ?? 0) > 0) return 0;
  for (let start = 1; start <= count; start += 500) {
    const batch = [];
    for (let i = start; i < Math.min(start + 500, count + 1); i++) batch.push(leadSeed(i, now, tz));
    await db.insert(table).values(batch);
  }
  return count;
}

/** Empties and reseeds the leads table (dev reset). */
export async function resetLeads(db: GridDb, table: LeadsTable, name: string, now: Date, tz: string): Promise<void> {
  await db.execute(sql.raw(createLeadsTableDDL(name)));
  await db.execute(sql.raw(`TRUNCATE TABLE ${quote(name)}`));
  await ensureLeads(db, table, name, now, tz);
}
