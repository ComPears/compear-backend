# ComPears Backend

Node.js + Express + TypeScript API for the ComPears grocery price comparison platform. Live catalogs: **NL**, **UK**, and **Germany** (`de` — Edeka, Rewe, Lidl, Aldi Süd, Penny; sample data for v1). Pass `?country=nl|uk|de`.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy environment file:
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and set `PORT` (default 4000). Optionally set `OPENAI_API_KEY` for AI normalization.

3. Seed product data and store locations (optional; run from project root so `compears-data-wrangling` is a sibling of `backend`):
   ```bash
   npm run seed
   npm run import-stores
   ```
   Or set `WRANGLING_PATH` to the path of `compears-data-wrangling` if it lives elsewhere.

   Store locations are imported from **OpenStreetMap** (not hand-maintained). Re-run `npm run import-stores` to refresh; CI updates weekly with product seed.

4. Start the server:
   ```bash
   npm run dev
   ```
   API runs at `http://localhost:4000`.

## Stores (NL)

All seven data-wrangling stores are supported: **Albert Heijn**, **Jumbo**, **ALDI**, **Dirk**, **Lidl**, **Coop**, **PLUS**. Seed from `compears-data-wrangling` with `npm run seed`.

## API Endpoints

- `GET /health` / `GET /health/live` – Liveness
- `GET /health/ready` – Readiness (catalog freshness / memory)
- `GET /health/metrics` – Runtime metrics + AI spend summary (requires `x-api-key`: `ADMIN_API_KEY` or `SCRAPE_API_KEY`)
- `GET /stores` – List stores and product counts
- `GET /products` – List products (query: `?search=...`, `?store=albert-heijn`, `?barcode=8710...`, `?labels=vegan,gluten-free`)
- `GET /products/:id` – Get product by id
- `GET /stores/locations` – Store locator (query: `?chain=jumbo`, `?lat=52.37&lng=4.89&radius=25`)
- `GET /compare/:canonicalName` – Compare prices across stores for a canonical product name
- `GET /deals` – Paginated promo deals (`?limit=50&offset=0`; max limit 100) → `{ items, total, limit, offset }`
- `GET /deals/digest` – Weekly deals summary
- `POST /lists` – Create a shareable shopping list (returns `editToken`; keep it private)
- `GET /lists/:id` – Fetch shared list by id (public; `editToken` stripped)
- `PATCH /lists/:id` – Update shared list (requires `x-list-edit-token` or `body.editToken`)
- `GET /api/v1/docs` – Partner API documentation (no API key; describes keyed data endpoints)
- `GET /api/v1/health` – Partner API health (no API key)
- `GET /api/v1/*` – Partner API v1 data routes (`PUBLIC_API_KEY` via `x-api-key`; required in production). Consumer routes (`/products`, `/stores`, `/deals`, `/compare`) stay open for the SPA and are gated by CORS + rate limits.
- `POST /receipts/session` – Issue `{ userId, token }` for receipt auth (rate-limited; no prior auth)
- `POST /receipts/parse` – Parse, safely match, and persist a receipt
- `GET /receipts` – List the caller's receipts (`x-compear-user-id` + `x-compear-user-token`)
- `PATCH /receipts/:id/lines/:lineIndex` – Re-match a line (`{ action: "rematch", correctedName }`) or mark it unmatched (`{ action: "unmatched" }`)
- `DELETE /receipts/:id` / `DELETE /receipts` – Delete one or all receipts
- `POST /scrape/:store` – Trigger scraper or seed for a store (e.g. `albert-heijn`, `seed-all`)
- `GET /scrape/status` – Last scrape run status (requires scrape/admin API key)

### Receipt session auth

Receipt endpoints (except `POST /receipts/session`) require credentials issued by the session
endpoint. Send `x-compear-user-id` and `x-compear-user-token` (HMAC of the user id with
`RECEIPT_AUTH_SECRET`), or `Authorization: Bearer userId:token`. Tokens cannot be forged without
the server secret.

### Shared list edit tokens

`POST /lists` returns an `editToken`. Anonymous `GET /lists/:id` omits it. Updates require the
token via `x-list-edit-token` or `body.editToken`. Legacy lists created before edit tokens may be
claimed on the first successful `PATCH` (a new `editToken` is minted and returned).

### AI monthly budget

OpenAI calls are gated by an approximate monthly USD budget (`AI_MONTHLY_BUDGET_USD`, default
`10`). Spend is tracked in `src/data/ai-spend.json`. When exhausted, AI endpoints return `429`.
Estimates use hardcoded per-model token prices (overridable via env) and are not billing-accurate.
Current spend appears on protected `GET /health/metrics`.

## Scraper

- Run Albert Heijn scraper via API: `POST /scrape/albert-heijn`
- Or CLI: `npm run scrape:ah`
- Requires Playwright: `npx playwright install chromium`

## Docker

```bash
docker build -t compears-backend .
docker run -p 4000:4000 compears-backend
```

Product JSON is baked into the image at `dist/data/` during `npm run build`.

## Deploy to Render

1. Push this `backend/` folder to GitHub (own repo, or as `backend/` in your monorepo with **Root Directory** set to `backend` in Render).
2. In [Render](https://render.com): **New → Blueprint** and point at `render.yaml`, or **New → Web Service** with:
   - **Build command:** `npm ci && npm run build`
   - **Start command:** `npm start`
   - **Health check path:** `/health`
3. Set environment variables (see `.env.example`). Render sets `PORT` automatically.
4. After deploy, set on Netlify: `VITE_API_URL=https://<your-render-service>.onrender.com`

| Variable | Required | Notes |
|----------|----------|--------|
| `ALLOWED_ORIGINS` | Yes | `https://compears.shop,https://www.compears.shop` |
| `SCRAPE_API_KEY` | Yes | Long random string; `x-api-key` on scrape routes and metrics |
| `ADMIN_API_KEY` | No | Optional additional ops key; accepted alongside `SCRAPE_API_KEY` |
| `PUBLIC_API_KEY` | Prod | Required in production for `/api/v1`; generated in `render.yaml` |
| `RECEIPT_AUTH_SECRET` | Prod | HMAC secret for receipt session tokens |
| `AI_MONTHLY_BUDGET_USD` | No | Approximate OpenAI spend cap (default `10`) |
| `OPENAI_API_KEY` | No | AI normalization, promo interpretation, receipt OCR. Rotate if ever exposed outside secrets managers. |
| `OPENAI_MODEL` | No | Text AI model (default `gpt-5.5`) |
| `OPENAI_VISION_MODEL` | No | Receipt image model (default `gpt-4o`) |
| `AI_MAX_VISION_PER_USER_HOUR` | No | Receipt uploads per user per hour (default `5`) |
| `AI_MAX_VISION_PER_USER_DAY` | No | Vision calls per user per day (default `20`) |
| `AI_MAX_TEXT_PER_RECEIPT` | No | Name-normalization AI calls per receipt (default `15`) |
| `AI_MAX_GLOBAL_DAY` | No | Total OpenAI calls per day (default `600`) |
| `RECEIPT_RETENTION_DAYS` | No | Parsed receipt retention in days (default `365`; enforced when receipt data is accessed) |

**Note:** Playwright scrapers (`POST /scrape/:store`) are not suitable on Render’s free tier (no browser, ephemeral disk). Use the data-wrangling pipeline + `npm run seed` locally or via CI, then commit updated `src/data/*.json`.

## Data

- JSON files in `src/data/` (e.g. `albert-heijn.json`, `jumbo.json`)
- AI cache: `src/data/ai-cache.json` (created when using OpenAI)
- AI spend: `src/data/ai-spend.json` (monthly approximate USD totals; gitignored)

## Receipt privacy and retention

Receipt images are held in memory only while they are prepared and sent to the configured AI
provider; ComPear does not persist the image itself. Parsed line items, totals, match decisions,
upload time, and image MIME type are persisted per pseudonymous receipt identity
(`x-compear-user-id` + signed `x-compear-user-token` from `POST /receipts/session`), with at most
200 receipts per user and a default retention of 365 days. Deployments should review the AI
provider's own data-handling terms separately.

Deleting a receipt, clearing receipt history, expiry, or eviction from the 200-receipt limit also
removes AI-cache entries tracked while processing that receipt. Older receipts created before cache
tracking do not contain enough information to identify those cache entries safely, so unrelated
shared cache entries are deliberately left intact.

## Receipt matching evaluation

Offline labelled fixtures live under `test/fixtures/receipt-matching/`:

- `mini-catalog.json` — small deterministic NL catalog (AH/Jumbo/Lidl/etc.)
- `nl-cases.json` — labelled receipt lines (`rawName`, `expectedStatus`, optional canonical/store hints)

`matchReceiptLine` in `src/services/receiptMatching.ts` scores candidates with catalog search +
lexical confidence only (no OpenAI). Optional `aiNormalizedName` simulates a prior AI rewrite for
abbrev rescue cases.

Run the full eval:

```bash
npm run eval:receipt-matching
```

It prints JSON metrics (`statusAccuracy`, `autoMatchPrecision` / `autoMatchRecall`,
`falseAutoMatchRate`, `coverage`) and exits non-zero if `falseAutoMatchRate > 0.05` or
`statusAccuracy < 0.75`. The same gates are asserted in `tests/receiptMatchingEval.test.ts`
during `npm test`.
