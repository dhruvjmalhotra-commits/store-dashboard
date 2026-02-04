import "dotenv/config";
import express from "express";
import pg from "pg";
import path from "path";
import { fileURLToPath } from "url";

const { Pool } = pg;
const app = express();
const PORT = process.env.PORT || 3000;

// ====== CONFIG ======
const ADMIN_PIN = process.env.ADMIN_PIN || "9999";

// ====== DB ======
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ====== PATH HELPERS ======
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ====== MIDDLEWARE ======
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// ====== HEALTH CHECK ======
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// ====== INIT DB (ONE TIME) ======
app.post("/api/init", async (req, res) => {
  if (req.body.pin !== ADMIN_PIN) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS stores (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT UNIQUE NOT NULL
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS daily_reports (
        id SERIAL PRIMARY KEY,
        store_id INTEGER REFERENCES stores(id),
        report_date DATE NOT NULL,
        inside_sales NUMERIC DEFAULT 0,
        fuel_sales NUMERIC DEFAULT 0,
        cash_collected NUMERIC DEFAULT 0,
        credit_total NUMERIC DEFAULT 0,
        gas_deposit NUMERIC DEFAULT 0,
        tax NUMERIC DEFAULT 0,
        ebt NUMERIC DEFAULT 0,
        delivery_apps NUMERIC DEFAULT 0,
        cash_payout NUMERIC DEFAULT 0,
        check_payout NUMERIC DEFAULT 0,
        cash_over_short NUMERIC DEFAULT 0,
        bank_deposit NUMERIC DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE (store_id, report_date)
      );
    `);

    res.json({ ok: true, msg: "Database initialized" });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ====== SEED STORES (ADMIN – ONE TIME) ======
app.post("/api/seed-stores", async (req, res) => {
  if (req.body.pin !== ADMIN_PIN) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  const stores = [
    ["Kwik Shop Fairground", "kwik-shop-fairground"],
    ["Circlek Lower", "circlek-lower"],
    ["Circlek Troy", "circlek-troy"],
    ["Raceway Demopolis", "raceway-demopolis"],
    ["Raceway Selma", "raceway-selma"],
    ["Raceway Columbusf", "raceway-columbusf"],
    ["Raceway McComb", "raceway-mccomb"],
    ["Bp Phenix", "bp-phenix"],
    ["Gulf Baymedows", "gulf-baymedows"]
  ];

  try {
    for (const [name, slug] of stores) {
      await pool.query(
        `INSERT INTO stores (name, slug)
         VALUES ($1, $2)
         ON CONFLICT (slug) DO NOTHING`,
        [name, slug]
      );
    }

    res.json({ ok: true, msg: "Stores added" });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ====== FRONT DESK (PER STORE URL) ======
app.get("/store/:slug", async (req, res) => {
  const { slug } = req.params;

  const result = await pool.query(
    "SELECT * FROM stores WHERE slug = $1",
    [slug]
  );

  if (result.rows.length === 0) {
    return res.status(404).send("Store not found");
  }

  const store = result.rows[0];

  res.send(`
    <html>
      <head>
        <title>${store.name} - Front Desk</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body>
        <h2>${store.name}</h2>
        <form method="POST" action="/submit">
          <input type="hidden" name="store_id" value="${store.id}" />
          <label>Date</label><br/>
          <input type="date" name="report_date" required /><br/><br/>

          <label>Inside Sales</label><br/>
          <input name="inside_sales" /><br/>

          <label>Fuel Sales</label><br/>
          <input name="fuel_sales" /><br/>

          <label>Cash Collected</label><br/>
          <input name="cash_collected" /><br/>

          <label>Credit Total</label><br/>
          <input name="credit_total" /><br/>

          <br/>
          <button type="submit">Submit</button>
        </form>
      </body>
    </html>
  `);
});

// ====== SUBMIT REPORT ======
app.post("/submit", async (req, res) => {
  const {
    store_id,
    report_date,
    inside_sales = 0,
    fuel_sales = 0,
    cash_collected = 0,
    credit_total = 0
  } = req.body;

  try {
    await pool.query(
      `
      INSERT INTO daily_reports
      (store_id, report_date, inside_sales, fuel_sales, cash_collected, credit_total)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (store_id, report_date)
      DO UPDATE SET
        inside_sales = EXCLUDED.inside_sales,
        fuel_sales = EXCLUDED.fuel_sales,
        cash_collected = EXCLUDED.cash_collected,
        credit_total = EXCLUDED.credit_total
      `,
      [
        store_id,
        report_date,
        inside_sales,
        fuel_sales,
        cash_collected,
        credit_total
      ]
    );

    res.send("Saved successfully");
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// ====== OWNER DASHBOARD ======
app.get("/owner", async (_req, res) => {
  const result = await pool.query(`
    SELECT s.name, d.*
    FROM daily_reports d
    JOIN stores s ON s.id = d.store_id
    ORDER BY report_date DESC
  `);

  res.json(result.rows);
});

// ====== START SERVER ======
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
