import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { pool, ensureSchema } from "./src/db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const ADMIN_PIN = process.env.ADMIN_PIN || "9999";
const STORE_PIN = process.env.STORE_PIN || "1234";

const app = express();

// Allow JSON
app.use(express.json({ limit: "1mb" }));

// Serve static site
app.use(express.static(path.join(__dirname, "public")));

// Health check
app.get("/api/ping", async (_req, res) => {
  res.json({ ok: true, msg: "API is working" });
});

// Initialize schema (safe to call repeatedly)
app.post("/api/init", async (req, res) => {
  const pin = String(req.body?.pin || "");
  if (pin !== ADMIN_PIN) return res.status(401).json({ ok: false, error: "Unauthorized" });

  try {
    await ensureSchema();
    res.json({ ok: true, msg: "Schema ensured" });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Submit daily report
app.post("/api/report", async (req, res) => {
  const pin = String(req.body?.pin || "");
  if (pin !== STORE_PIN) return res.status(401).json({ ok: false, error: "Unauthorized" });

  const storeName = String(req.body?.store || "").trim();
  const reportDate = String(req.body?.date || "").trim(); // YYYY-MM-DD

  if (!storeName || !reportDate) {
    return res.status(400).json({ ok: false, error: "store and date are required" });
  }

  // Numeric helpers
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  const payload = {
    inside_sales: num(req.body?.inside_sales),
    fuel_sales: num(req.body?.fuel_sales),
    cash_collected: num(req.body?.cash_collected),
    credit_total: num(req.body?.credit_total),
    gas_deposit: num(req.body?.gas_deposit),
    tax: num(req.body?.tax),
    ebt: num(req.body?.ebt),
    delivery_apps: num(req.body?.delivery_apps),
    cash_payout: num(req.body?.cash_payout),
    check_payout: num(req.body?.check_payout),
    cash_over_short: num(req.body?.cash_over_short),
    bank_deposit: num(req.body?.bank_deposit),
    notes: String(req.body?.notes || ""),
    submitted_by: String(req.body?.submitted_by || "")
  };

  try {
    await ensureSchema();

    // Ensure store exists
    const storeResult = await pool.query(
      `INSERT INTO stores (name)
       VALUES ($1)
       ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
       RETURNING id, name`,
      [storeName]
    );
    const storeId = storeResult.rows[0].id;

    // Upsert report per store+date
    const q = `
      INSERT INTO daily_reports (
        store_id, report_date,
        inside_sales, fuel_sales,
        cash_collected, credit_total,
        gas_deposit, tax, ebt, delivery_apps,
        cash_payout, check_payout,
        cash_over_short, bank_deposit,
        notes, submitted_by
      )
      VALUES (
        $1, $2,
        $3, $4,
        $5, $6,
        $7, $8, $9, $10,
        $11, $12,
        $13, $14,
        $15, $16
      )
      ON CONFLICT (store_id, report_date)
      DO UPDATE SET
        inside_sales = EXCLUDED.inside_sales,
        fuel_sales = EXCLUDED.fuel_sales,
        cash_collected = EXCLUDED.cash_collected,
        credit_total = EXCLUDED.credit_total,
        gas_deposit = EXCLUDED.gas_deposit,
        tax = EXCLUDED.tax,
        ebt = EXCLUDED.ebt,
        delivery_apps = EXCLUDED.delivery_apps,
        cash_payout = EXCLUDED.cash_payout,
        check_payout = EXCLUDED.check_payout,
        cash_over_short = EXCLUDED.cash_over_short,
        bank_deposit = EXCLUDED.bank_deposit,
        notes = EXCLUDED.notes,
        submitted_by = EXCLUDED.submitted_by,
        updated_at = NOW()
      RETURNING id
    `;
    const vals = [
      storeId, reportDate,
      payload.inside_sales, payload.fuel_sales,
      payload.cash_collected, payload.credit_total,
      payload.gas_deposit, payload.tax, payload.ebt, payload.delivery_apps,
      payload.cash_payout, payload.check_payout,
      payload.cash_over_short, payload.bank_deposit,
      payload.notes, payload.submitted_by
    ];

    await pool.query(q, vals);
    res.json({ ok: true, msg: "Saved" });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// List reports (admin)
app.get("/api/reports", async (req, res) => {
  const pin = String(req.query.pin || "");
  if (pin !== ADMIN_PIN) return res.status(401).json({ ok: false, error: "Unauthorized" });

  const date = String(req.query.date || "").trim();  // YYYY-MM-DD optional
  const store = String(req.query.store || "").trim(); // optional

  try {
    await ensureSchema();

    const conditions = [];
    const params = [];
    let i = 1;

    if (date) {
      conditions.push(`dr.report_date = $${i++}`);
      params.push(date);
    }
    if (store) {
      conditions.push(`s.name = $${i++}`);
      params.push(store);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const q = `
      SELECT
        s.name AS store,
        dr.report_date AS date,
        dr.inside_sales,
        dr.fuel_sales,
        dr.cash_collected,
        dr.credit_total,
        dr.gas_deposit,
        dr.tax,
        dr.ebt,
        dr.delivery_apps,
        dr.cash_payout,
        dr.check_payout,
        dr.cash_over_short,
        dr.bank_deposit,
        dr.notes,
        dr.submitted_by,
        dr.updated_at
      FROM daily_reports dr
      JOIN stores s ON s.id = dr.store_id
      ${where}
      ORDER BY dr.report_date DESC, s.name ASC
      LIMIT 500
    `;

    const result = await pool.query(q, params);
    res.json({ ok: true, rows: result.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
