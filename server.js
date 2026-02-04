/**
 * Store Dashboard API (Render + Postgres)
 * --------------------------------------
 * ENV required on Render:
 *   DATABASE_URL = postgresql://user:pass@host:5432/dbname
 *   ADMIN_PIN    = 9999   (optional, defaults to 9999)
 *
 * Start command on Render:
 *   node server.js
 */

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();

// ---- Config ----
const PORT = process.env.PORT || 10000;
const ADMIN_PIN = process.env.ADMIN_PIN || "9999";
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("❌ Missing DATABASE_URL env var. Set it in Render → Environment.");
}

// ---- Middleware ----
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// ---- Postgres pool ----
// Render Postgres often requires SSL in many environments.
// If your DB is internal Render-to-Render, it may still work with ssl off,
// but this is safe for most Render Postgres connections.
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL && DATABASE_URL.includes("render.com")
    ? { rejectUnauthorized: false }
    : undefined,
});

// ---- Helpers ----
function requirePin(req, res, next) {
  const pin = req.body?.pin || req.query?.pin || req.headers["x-admin-pin"];
  if (String(pin || "") !== String(ADMIN_PIN)) {
    return res.status(401).json({ ok: false, error: "Invalid PIN" });
  }
  next();
}

function slugify(name) {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// Your store list (as provided)
const STORE_NAMES = [
  "Kwik Shop Fairground",
  "Circlek Lower",
  "Circlek Troy",
  "Raceway Demopolis",
  "Raceway Selma",
  "Raceway Columbusf",
  "Raceway McComb",
  "Bp Phenix",
  "Gulf Baymedows",
];

// ---- Health / Root ----
app.get("/", (req, res) => {
  res.type("text").send("Store Dashboard API is running ✅");
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// ---- DB Init (creates tables if not exist) ----
app.post("/api/init", requirePin, async (req, res) => {
  try {
    // stores table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS stores (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        slug TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // daily_reports table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS daily_reports (
        id SERIAL PRIMARY KEY,
        store_id INT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
        report_date DATE NOT NULL,

        inside_sale NUMERIC(12,2) DEFAULT 0,
        fuel_sale NUMERIC(12,2) DEFAULT 0,
        cash_collected NUMERIC(12,2) DEFAULT 0,
        credit_total NUMERIC(12,2) DEFAULT 0,
        gas_deposit NUMERIC(12,2) DEFAULT 0,
        tax NUMERIC(12,2) DEFAULT 0,
        ebt NUMERIC(12,2) DEFAULT 0,
        lula_doordash NUMERIC(12,2) DEFAULT 0,
        cash_payout NUMERIC(12,2) DEFAULT 0,
        check_payout NUMERIC(12,2) DEFAULT 0,
        cash_over_short NUMERIC(12,2) DEFAULT 0,
        bank_deposit NUMERIC(12,2) DEFAULT 0,

        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        UNIQUE(store_id, report_date)
      );
    `);

    // updated_at trigger helper (optional but nice)
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
          CREATE OR REPLACE FUNCTION set_updated_at()
          RETURNS TRIGGER AS $fn$
          BEGIN
            NEW.updated_at = NOW();
            RETURN NEW;
          END;
          $fn$ LANGUAGE plpgsql;
        END IF;
      END $$;
    `);

    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_trigger WHERE tgname = 'trg_daily_reports_updated_at'
        ) THEN
          CREATE TRIGGER trg_daily_reports_updated_at
          BEFORE UPDATE ON daily_reports
          FOR EACH ROW
          EXECUTE FUNCTION set_updated_at();
        END IF;
      END $$;
    `);

    res.json({ ok: true, msg: "Schema ensured" });
  } catch (err) {
    console.error("❌ /api/init error:", err);
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

// ---- Seed stores (admin) ----
// Supports BOTH routes to avoid confusion:
//   POST /api/seed
//   POST /api/seed-stores
async function seedStoresHandler(req, res) {
  try {
    // Ensure schema exists first (safe)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS stores (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        slug TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const seeded = [];

    for (const name of STORE_NAMES) {
      const slug = slugify(name);
      const result = await pool.query(
        `
        INSERT INTO stores(name, slug)
        VALUES ($1, $2)
        ON CONFLICT (name) DO UPDATE SET slug = EXCLUDED.slug
        RETURNING id, name, slug;
        `,
        [name, slug]
      );
      seeded.push(result.rows[0]);
    }

    res.json({ ok: true, msg: "Stores seeded", stores: seeded });
  } catch (err) {
    console.error("❌ seed error:", err);
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
}

app.post("/api/seed", requirePin, seedStoresHandler);
app.post("/api/seed-stores", requirePin, seedStoresHandler);

// ---- List stores (front desk + owner) ----
app.get("/api/stores", async (req, res) => {
  try {
    const r = await pool.query(`SELECT id, name, slug FROM stores ORDER BY name ASC;`);
    res.json({ ok: true, stores: r.rows });
  } catch (err) {
    console.error("❌ /api/stores error:", err);
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

// ---- Submit/Upsert a daily report ----
// Front desk submits per store per date.
// POST /api/report
// body: { storeSlug, reportDate, fields..., notes }
app.post("/api/report", async (req, res) => {
  try {
    const {
      storeSlug,
      reportDate, // "YYYY-MM-DD"
      insideSale,
      fuelSale,
      cashCollected,
      creditTotal,
      gasDeposit,
      tax,
      ebt,
      lulaOrDoordash,
      cashPayout,
      checkPayout,
      cashOverShort,
      bankDeposit,
      notes,
    } = req.body || {};

    if (!storeSlug) return res.status(400).json({ ok: false, error: "storeSlug is required" });
    if (!reportDate) return res.status(400).json({ ok: false, error: "reportDate is required (YYYY-MM-DD)" });

    const store = await pool.query(`SELECT id, name, slug FROM stores WHERE slug=$1 LIMIT 1;`, [storeSlug]);
    if (store.rowCount === 0) {
      return res.status(404).json({ ok: false, error: `Store not found for slug: ${storeSlug}` });
    }

    const storeId = store.rows[0].id;

    // helper to make numeric safe
    const n = (v) => (v === "" || v === null || v === undefined ? 0 : Number(v));

    const upsert = await pool.query(
      `
      INSERT INTO daily_reports(
        store_id, report_date,
        inside_sale, fuel_sale, cash_collected, credit_total,
        gas_deposit, tax, ebt, lula_doordash,
        cash_payout, check_payout, cash_over_short, bank_deposit,
        notes
      )
      VALUES (
        $1, $2,
        $3, $4, $5, $6,
        $7, $8, $9, $10,
        $11, $12, $13, $14,
        $15
      )
      ON CONFLICT (store_id, report_date)
      DO UPDATE SET
        inside_sale     = EXCLUDED.inside_sale,
        fuel_sale       = EXCLUDED.fuel_sale,
        cash_collected  = EXCLUDED.cash_collected,
        credit_total    = EXCLUDED.credit_total,
        gas_deposit     = EXCLUDED.gas_deposit,
        tax             = EXCLUDED.tax,
        ebt             = EXCLUDED.ebt,
        lula_doordash   = EXCLUDED.lula_doordash,
        cash_payout     = EXCLUDED.cash_payout,
        check_payout    = EXCLUDED.check_payout,
        cash_over_short = EXCLUDED.cash_over_short,
        bank_deposit    = EXCLUDED.bank_deposit,
        notes           = EXCLUDED.notes
      RETURNING id;
      `,
      [
        storeId,
        reportDate,
        n(insideSale),
        n(fuelSale),
        n(cashCollected),
        n(creditTotal),
        n(gasDeposit),
        n(tax),
        n(ebt),
        n(lulaOrDoordash),
        n(cashPayout),
        n(checkPayout),
        n(cashOverShort),
        n(bankDeposit),
        notes || null,
      ]
    );

    res.json({ ok: true, msg: "Report saved", id: upsert.rows[0].id });
  } catch (err) {
    console.error("❌ /api/report error:", err);
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

// ---- Owner load reports (by date, optional storeSlug) ----
// GET /api/reports?date=YYYY-MM-DD
// GET /api/reports?date=YYYY-MM-DD&storeSlug=kwik-shop-fairground
app.get("/api/reports", async (req, res) => {
  try {
    const { date, storeSlug } = req.query || {};
    if (!date) return res.status(400).json({ ok: false, error: "date is required (YYYY-MM-DD)" });

    let query = `
      SELECT
        s.name AS store_name,
        s.slug AS store_slug,
        r.report_date,
        r.inside_sale, r.fuel_sale, r.cash_collected, r.credit_total,
        r.gas_deposit, r.tax, r.ebt, r.lula_doordash,
        r.cash_payout, r.check_payout, r.cash_over_short, r.bank_deposit,
        r.notes,
        r.updated_at
      FROM daily_reports r
      JOIN stores s ON s.id = r.store_id
      WHERE r.report_date = $1
    `;
    const params = [date];

    if (storeSlug) {
      query += ` AND s.slug = $2`;
      params.push(storeSlug);
    }

    query += ` ORDER BY s.name ASC;`;

    const r = await pool.query(query, params);

    // aggregate totals (owner view)
    const totals = r.rows.reduce(
      (acc, row) => {
        const add = (k) => (acc[k] += Number(row[k] || 0));
        add("inside_sale");
        add("fuel_sale");
        add("cash_collected");
        add("credit_total");
        add("gas_deposit");
        add("tax");
        add("ebt");
        add("lula_doordash");
        add("cash_payout");
        add("check_payout");
        add("cash_over_short");
        add("bank_deposit");
        return acc;
      },
      {
        inside_sale: 0,
        fuel_sale: 0,
        cash_collected: 0,
        credit_total: 0,
        gas_deposit: 0,
        tax: 0,
        ebt: 0,
        lula_doordash: 0,
        cash_payout: 0,
        check_payout: 0,
        cash_over_short: 0,
        bank_deposit: 0,
      }
    );

    res.json({ ok: true, date, storeSlug: storeSlug || null, totals, reports: r.rows });
  } catch (err) {
    console.error("❌ /api/reports error:", err);
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

// ---- Helpful: show all routes quickly ----
app.get("/api", (req, res) => {
  res.json({
    ok: true,
    routes: [
      "GET  /",
      "GET  /health",
      "POST /api/init   (pin required)",
      "POST /api/seed   (pin required)",
      "POST /api/seed-stores (pin required)",
      "GET  /api/stores",
      "POST /api/report",
      "GET  /api/reports?date=YYYY-MM-DD&storeSlug=optional",
    ],
  });
});

// ---- Start server ----
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running on port ${PORT}`);
});
