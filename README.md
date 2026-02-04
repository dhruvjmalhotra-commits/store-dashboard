# Store Daily Dashboard (Render DB, No Prisma)

This is a simple Express + Postgres app you can deploy on Render (just like your Sabor a Mexico KDS).
- Front Desk: enter daily numbers
- Owner: view all stores, totals, filters
- Uses Render PostgreSQL (DATABASE_URL)
- No Prisma, no migrations tooling — tables are created automatically.

## Local run
1) Create `.env` in project root:
   DATABASE_URL="your-postgres-url"
   ADMIN_PIN="9999"
   STORE_PIN="1234"

2) Install and run:
   npm install
   npm run dev

Open: http://localhost:3000

## Render deployment (Web Service)
- Build Command: `npm install`
- Start Command: `npm start`
- Env Vars:
  - DATABASE_URL = Render Postgres Internal Database URL (recommended) or External (works)
  - ADMIN_PIN = choose your admin pin
  - STORE_PIN = choose your store pin
  - PGSSL = true (default). Set PGSSL=false only if your DB doesn't need SSL.

After deploy:
- Open your site
- Go Owner tab and click "Init DB (first time)" once
