# Smart Water Supply — Vercel + Postgres

This is a rebuild of the original app, restructured to actually work on Vercel:

- **`sql.js` (WASM SQLite) → Postgres** via `@vercel/postgres` — no more WASM asset
  resolution failures, no more writing to a local file that Vercel's serverless
  filesystem can't persist.
- **`app.listen()` → exported Express handler** (`api/index.js`) — Vercel invokes
  the app per-request instead of expecting a long-running process.
- **Manual `?` placeholder string-splicing → real parameterized queries**
  (`sql\`...${value}...\``) — safer and Postgres-native.
- Schema creation + default admin/zone seeding now happens once per warm
  serverless instance (cached), not on every request.

Everything else — routes, auth flow, JWT cookie, the login page, the
dashboard UI — is unchanged, so your API contract and frontend behavior are
identical to before.

## Deploy steps

### 1. Push this to GitHub
Replace your existing repo contents with these files (or push as a new repo),
then connect it in Vercel as you would normally.

### 2. Create a Postgres database
In your Vercel project dashboard:
- Go to **Storage** → **Create Database** → **Postgres** (this is Neon under
  the hood; the free tier is enough for this app)
- Once created, click **Connect** and link it to this project — Vercel will
  automatically inject `POSTGRES_URL` and related env vars into your
  deployment. You don't need to copy/paste a connection string yourself.

### 3. Set your JWT secret
Project → **Settings** → **Environment Variables**:

| Key | Value |
|---|---|
| `JWT_SECRET` | any long random string (e.g. from randomkeygen.com) |

### 4. Deploy
Push to `main` (or trigger a redeploy). Vercel will:
- Install dependencies
- Build `api/index.js` as a serverless function via `@vercel/node`
- Route every request through it (see `vercel.json`), which serves both
  your static HTML (`/public`) and your API routes (`/api/*`)

On first request, `ensureSchema()` creates the tables and seeds:
- Default admin: `admin@waterboard.com` / `Admin@1234`
- Default zones: Zone A–D

**Change the default admin password after your first login** — it's public
in this README/repo.

## Local development

```bash
npm install
vercel env pull .env.development.local   # pulls POSTGRES_URL etc. from your Vercel project
npm run dev
```

`vercel env pull` requires the Vercel CLI (`npm i -g vercel`) and that
you've linked this folder to your Vercel project (`vercel link`). Without a
real `POSTGRES_URL`, the app has no database to talk to — there's no local
file fallback anymore, so local dev depends on being connected to the same
Postgres instance (or a separate dev branch/database, if you create one).

## What's different from a plain persistent-server deploy (Render/Railway)

Because this now uses a real always-on database instead of a local file,
data survives redeploys, cold starts, and scaling to multiple instances —
none of which was true of the SQLite-file version. This is the more
"production-correct" version of the two paths.

## 💧 Meter Readings & Automated Billing

- **Member Self-Read Submission**: Members can input their current water meter reading ($m^3$) with optional meter serial number and notes.
- **Tiered Tariff Calculation**:
  - Base monthly service fee: KSh 50.00
  - Tier 1 (0 – 6 $m^3$ Lifeline): KSh 45.00 / $m^3$
  - Tier 2 (7 – 20 $m^3$ Normal Domestic): KSh 65.00 / $m^3$
  - Tier 3 (21 – 50 $m^3$ High Domestic): KSh 85.00 / $m^3$
  - Tier 4 (> 50 $m^3$ Heavy/Commercial): KSh 110.00 / $m^3$
- **Instant Official Reply & Statement**: Upon submission, members immediately receive an official utility statement and notification detailing previous reading, current reading, net volume consumed ($m^3$), itemized charges, total amount due, payment due date (14 days), and M-Pesa Paybill instructions (Paybill 247247, Account WAT-{id}).
- **Payments**: Members can simulate M-Pesa payments or pay directly from their dashboard.
- **Admin Management**: Administrators can monitor all meter readings and bills across zones, track revenue metrics, filter by payment status, and toggle bill settlement status.

