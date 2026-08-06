# Shop Intelligence for Etsy

A lightweight Etsy analytics dashboard for sellers who want to understand sales, listings, coupons, countries, and Google Analytics traffic without building a full BI system.

Shop Intelligence is built for Etsy sellers who export their Etsy reports, connect Google Analytics, and want a clearer view of what is actually driving revenue.

![Status](https://img.shields.io/badge/status-active-brightgreen)
![Stack](https://img.shields.io/badge/stack-React%20%2B%20Cloudflare-orange)
![License](https://img.shields.io/badge/license-add%20license-lightgrey)

## What It Helps You Understand

| Question | Dashboard area |
|---|---|
| Which listings generate the most revenue? | Etsy Sales Analytics |
| Which products sell the most units? | Listing performance tables |
| Which countries buy from my shop? | Country performance |
| Which coupons help sales or hurt margin? | Discount efficiency |
| How much traffic comes from Google Analytics? | Google Analytics Dashboard |
| Which pages receive the most attention? | GA top pages |
| Where should I focus to grow sales? | Growth opportunity sections |
| What's driving a weird number, in plain language? | AI Analyst chat |
| Are my synced Etsy orders and payments consistent? | Data Center reconciliation |
| What happened in my shop and when? | Shop Journal |
| How do I generate on-brand listing images? | AI Image Studio |

## Main Features

### Etsy Sales Analytics

The Etsy dashboard uses exported Etsy CSV reports to show:

| Area | Metrics |
|---|---|
| Revenue | Gross revenue, net payout, Etsy fees, fee rate |
| Orders | Order count, units sold, average order value |
| Customers | Repeat buyer rate |
| Listings | Top listings by revenue and units sold |
| Countries | Revenue, orders, units, AOV by country |
| Coupons | Usage count, revenue, discount amount, discount rate |
| Opportunities | Listing growth, country opportunity, discount efficiency |

### Google Analytics Dashboard

The Google Analytics dashboard connects to GA4 data through Cloudflare Functions and stores synced results in Cloudflare D1.

| Area | Metrics |
|---|---|
| Traffic overview | Active users, sessions, page views, event count |
| Trend analysis | Daily traffic trend |
| Acquisition | Traffic sources |
| Content | Top pages |
| Audience | Countries and devices |
| Events | GA event list |

### Combined Analytics Foundation

The app includes a placeholder shell for future combined analytics between Etsy sales and Google Analytics traffic.

Future combined analytics may compare:

- listing traffic vs listing sales
- country traffic vs country revenue
- high-traffic / low-sales opportunities
- high-sales / low-traffic listings

This is handled carefully because true conversion attribution requires reliable shared data between Etsy and Google Analytics.

### Etsy API Sync (beyond CSV)

Instead of (or alongside) manual CSV uploads, the shop can connect its Etsy account via OAuth. A dedicated, privately-deployed Cloudflare Worker (`workers/etsy-sync`) then runs a generic, queue-driven sync engine that pulls:

- Shop profile and sections
- Listings, images, videos, personalization and inventory
- Receipts, transactions and receipt refunds
- Payments, payment adjustments and payment-account ledger entries
- Reviews

Cloudflare D1 is the single source of truth for this path; sync progress is resumable and crash-safe. See [`docs/archive/etsy-generic-sync-engine.md`](docs/archive/etsy-generic-sync-engine.md) for the full design.

### Data Center

The Data Center page is the control surface for shop data:

- **Commerce Sync** — pick a UTC date range (or month shortcut), then sync
  receipts, payments and ledger for that window. Progress shows a stage bar;
  a period run opens a one-time completion summary modal.
- Secondary actions update Shop, Listings or Reviews without a date range.
- Daily incremental commerce sync runs on the Worker cron (`0 3 * * *`).
- Coverage list + watermark show which periods are complete and how far
  automatic sync has reached.
- CSV upload remains available as a fallback for months without API data.
- Reconciliation compares CSV and API sources; the old financial cutover
  toggle is retired (canonical views prefer API rows when they exist).

### Shop Journal

A simple event log for shop-level context (price changes, promotions, notable events) that isn't captured by Etsy's own exports.

### AI Analyst

An in-app chat assistant (`functions/api/ai/`) backed by DeepSeek with tool-calling access to the shop's D1 data. It answers questions about the shop's own numbers only — it does not guess or invent figures. It defaults to Turkish responses and can switch to English on request.

It also keeps a short-term memory (`ai_memories` table) of goals, preferences, decisions, experiments, results, and shop facts — but only when explicitly asked to remember something (in chat or via the Memory panel's manual form). It never saves on its own judgment, and updates overwrite the previous value in place rather than keeping a history.

### AI Image Studio

A workspace (`functions/api/image-studio/`) for generating listing-ready images with [fal.ai](https://fal.ai) image models, with configurable scenes, aspect ratios, resolutions and output formats.

## Why Cloudflare Is Used

This project is designed around Cloudflare because it provides a simple full-stack deployment path.

| Cloudflare service | Purpose |
|---|---|
| Cloudflare Pages | Hosts the React frontend |
| Cloudflare Functions | Runs API routes |
| Cloudflare D1 | Stores imported Etsy and synced GA data |
| Cloudflare Access | Protects the private hosted dashboard behind email login |
| Cloudflare Queues | Drives the Etsy API sync engine one bounded page at a time, independent of the browser |

Recommended setup:

```text
Public GitHub repo: safe source code and example config
Private Cloudflare deployment: your real shop data and credentials
```

## Data Sources

### Etsy CSV Reports

The app expects Etsy CSV exports such as:

- Etsy Direct Checkout Payments
- Etsy Sold Orders
- Etsy Sold Order Items

Private CSV files should stay local and must not be committed to Git.

### Etsy API (OAuth)

As an alternative or complement to CSV uploads, the shop can connect its Etsy account via OAuth so the sync engine in `workers/etsy-sync` pulls data directly from the Etsy API into Cloudflare D1. See the [Etsy API Worker](#etsy-api-worker) section below.

### Google Analytics 4

Google Analytics data is synced using a Google service account and stored in Cloudflare D1.

Private credentials should be stored only in local environment files or Cloudflare environment variables.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vite, React, TypeScript |
| Charts | Apache ECharts |
| CSV parsing | Papa Parse |
| Backend/API | Cloudflare Functions |
| Etsy sync worker | Cloudflare Worker + Queues (`workers/etsy-sync`) |
| Database | Cloudflare D1 |
| Hosting | Cloudflare Pages |
| Analytics source | Google Analytics Data API |
| AI Analyst | DeepSeek (tool-calling over D1 data) |
| AI image generation | fal.ai |
| Access control | Cloudflare Access |

## Local Development

Install dependencies:

```bash
npm install
```

Run the frontend development server:

```bash
npm run dev
```

This is best for UI work, but Cloudflare Functions and D1 may not behave exactly like production in this mode.

For Cloudflare Pages-style local testing, build first:

```bash
npm run build
```

Then run:

```bash
npx wrangler pages dev dist --compatibility-date=2026-05-03
```

### CSV import behavior

Imports use natural keys (`payment_id`, `order_id`, `transaction_id`). Existing rows are **skipped**, not overwritten. `replacedCount` stays `0` unless an explicit overwrite mode is added later.

| Count | Meaning |
|---|---|
| `insertedCount` | New rows written |
| `skippedCount` | Duplicate key, duplicate file, missing required key, or missing parent order |
| `replacedCount` | Always `0` today |
| `errorCount` | Unexpected failures only |

Sold Order Items require matching Sold Orders to exist first. Re-uploading the same file (same `file_hash`) is detected and skipped.

If the default port is busy:

```bash
npx wrangler pages dev dist --compatibility-date=2026-05-03 --port 8789
```

## Environment Setup

Create your own local environment files from the examples:

```bash
cp .dev.vars.example .dev.vars
cp .env.example .env
cp wrangler.example.jsonc wrangler.jsonc
```

Then replace placeholder values with your own Cloudflare, D1, and Google Analytics configuration.

Never commit real secrets.

### Etsy API Worker

The Etsy integration is a separate private Worker in `workers/etsy-sync`. It
runs a generic, queue-driven sync engine covering shop profile, listings,
receipts, payments, ledger entries and reviews — see
[`docs/archive/etsy-generic-sync-engine.md`](docs/archive/etsy-generic-sync-engine.md) for the
full design. Copy its example Wrangler and local secret files, then add the
four production secrets with `wrangler secret put`:

```bash
cp workers/etsy-sync/wrangler.example.jsonc workers/etsy-sync/wrangler.jsonc
cp workers/etsy-sync/.dev.vars.example workers/etsy-sync/.dev.vars
npm run build:worker
```

The exact OAuth callback registered in Etsy must be:

```text
https://your-pages-project.pages.dev/api/etsy/oauth/callback
```

Deploy the Worker before Pages so the `ETSY_SYNC_SERVICE` binding can resolve.
The Worker has no public route; Pages calls it over a Service Binding.

## Public vs Private Setup

| Keep public | Keep private |
|---|---|
| Source code | `.env` |
| Migrations | `.dev.vars` |
| Example config files | real `wrangler.jsonc` |
| README | Etsy CSV exports |
| Public-safe sample data | service account JSON files |
| UI components | private screenshots |

## Security Notes

Do not commit:

- `.env`
- `.dev.vars`
- `wrangler.jsonc` with real database IDs
- service account JSON files
- Etsy CSV exports
- Cloudflare local state
- SQLite or D1 local database files
- screenshots containing private shop data

For a private hosted dashboard, use Cloudflare Access to restrict the live site to your own email address.

## Project Status

| Area | Status |
|---|---|
| Etsy CSV analytics | Active |
| Google Analytics sync | Active |
| Cloudflare D1 persistence | Active |
| Etsy API sync engine (OAuth) | Active |
| Data Center reconciliation | Active |
| AI Analyst | Active |
| AI Image Studio | Active |
| Shop Journal | Active |
| Combined analytics | Planned |
| Sample data mode | Planned |

## License

Add your preferred license before publishing this project publicly.
