import { db } from "./db";
import { sql } from "drizzle-orm";

// Idempotent startup migrations — each statement uses IF NOT EXISTS / IF EXISTS
// so it is safe to run on every boot. Add new entries below; never remove old ones.
export async function runMigrations() {
  // 2026-05-05 — hiring_offers table (merged in 8c8e832, db:push could not run)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS hiring_offers (
      id                     SERIAL PRIMARY KEY,
      candidate_name         TEXT    NOT NULL,
      role_offered           TEXT    NOT NULL DEFAULT '',
      yearly_gross_eur       REAL,
      age                    INTEGER,
      past_prof_tenure_years REAL,
      test_results           JSONB   DEFAULT '{}',
      languages              JSONB   DEFAULT '[]',
      outcome                TEXT    NOT NULL DEFAULT 'pending',
      decline_reason         TEXT,
      decision_date          TEXT,
      notes                  TEXT,
      created_at             TEXT    NOT NULL,
      updated_at             TEXT    NOT NULL
    )
  `);
}
