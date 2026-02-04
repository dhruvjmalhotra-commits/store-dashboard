import pg from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.warn("⚠️ DATABASE_URL is not set. Set it in your .env (local) or Render env vars (production).");
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === "false" ? false : { rejectUnauthorized: false }
});

// Creates tables if they don't exist
export async function ensureSchema() {
  const sql = `
  CREATE TABLE IF NOT EXISTS stores (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS daily_reports (
    id SERIAL PRIMARY KEY,
    store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    report_date DATE NOT NULL,

    inside_sales NUMERIC(12,2) NOT NULL DEFAULT 0,
    fuel_sales NUMERIC(12,2) NOT NULL DEFAULT 0,
    cash_collected NUMERIC(12,2) NOT NULL DEFAULT 0,
    credit_total NUMERIC(12,2) NOT NULL DEFAULT 0,
    gas_deposit NUMERIC(12,2) NOT NULL DEFAULT 0,
    tax NUMERIC(12,2) NOT NULL DEFAULT 0,
    ebt NUMERIC(12,2) NOT NULL DEFAULT 0,
    delivery_apps NUMERIC(12,2) NOT NULL DEFAULT 0,
    cash_payout NUMERIC(12,2) NOT NULL DEFAULT 0,
    check_payout NUMERIC(12,2) NOT NULL DEFAULT 0,
    cash_over_short NUMERIC(12,2) NOT NULL DEFAULT 0,
    bank_deposit NUMERIC(12,2) NOT NULL DEFAULT 0,

    notes TEXT NOT NULL DEFAULT '',
    submitted_by TEXT NOT NULL DEFAULT '',

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(store_id, report_date)
  );

  CREATE INDEX IF NOT EXISTS idx_daily_reports_date ON daily_reports(report_date);
  `;
  await pool.query(sql);
}
