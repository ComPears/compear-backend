# ComPears Backend

Node.js + Express + TypeScript API for the ComPears grocery price comparison platform. Data is currently **NL** (Dutch supermarkets); the API is structured so **DE** (Germany) and **UK** can be added later (e.g. `?country=de` or separate data dirs).

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

- `GET /health` – Health check
- `GET /stores` – List stores and product counts
- `GET /products` – List products (query: `?search=...`, `?store=albert-heijn`, `?barcode=8710...`, `?labels=vegan,gluten-free`)
- `GET /products/:id` – Get product by id
- `GET /stores/locations` – Store locator (query: `?chain=jumbo`, `?lat=52.37&lng=4.89&radius=25`)
- `GET /compare/:canonicalName` – Compare prices across stores for a canonical product name
- `GET /deals` – Products with active promotions
- `GET /deals/digest` – Weekly deals summary
- `POST /lists` – Create a shareable shopping list (JSON body: `{ name, items[] }`)
- `GET /lists/:id` – Fetch shared list by id
- `PATCH /lists/:id` – Update shared list
- `GET /api/v1/docs` – Public API documentation (read-only mirror of product/store/deals endpoints)
- `GET /api/v1/*` – Public API v1 (optional `PUBLIC_API_KEY` via `x-api-key`)
- `POST /scrape/:store` – Trigger scraper or seed for a store (e.g. `albert-heijn`, `seed-all`)
- `GET /scrape/status` – Last scrape run status

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
| `SCRAPE_API_KEY` | Yes | Long random string; send as `x-api-key` on scrape routes |
| `OPENAI_API_KEY` | No | AI normalization, promo interpretation, receipt OCR |
| `OPENAI_MODEL` | No | Text AI model (default `gpt-5.5`) |
| `OPENAI_VISION_MODEL` | No | Receipt image model (default `gpt-5.5`) |
| `AI_MAX_VISION_PER_USER_HOUR` | No | Receipt uploads per user per hour (default `5`) |
| `AI_MAX_VISION_PER_USER_DAY` | No | Vision calls per user per day (default `20`) |
| `AI_MAX_TEXT_PER_RECEIPT` | No | Name-normalization AI calls per receipt (default `15`) |
| `AI_MAX_GLOBAL_DAY` | No | Total OpenAI calls per day (default `600`) |

**Note:** Playwright scrapers (`POST /scrape/:store`) are not suitable on Render’s free tier (no browser, ephemeral disk). Use the data-wrangling pipeline + `npm run seed` locally or via CI, then commit updated `src/data/*.json`.

## Data

- JSON files in `src/data/` (e.g. `albert-heijn.json`, `jumbo.json`)
- AI cache: `src/data/ai-cache.json` (created when using OpenAI)
