# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Fenway Ticket Tracker — a serverless Red Sox ticket price tracker. Runs on GitHub Actions (daily cron), stores price data as JSON in the repo, and serves a static PWA dashboard via GitHub Pages.

The full project spec lives in `fenway-tracker-handoff.md`.

## Tech Stack

- **Fetch script:** Plain Node.js (>=18) with Playwright for price scraping
- **Dashboard:** Vanilla HTML/CSS/JS (no framework, no build tools)
- **CI/Data pipeline:** GitHub Actions (scheduled + manual trigger)
- **Hosting:** GitHub Pages (static, deployed from main branch)

## Commands

```bash
# Run the fetch script locally (requires .env with TICKETMASTER_API_KEY)
node scripts/fetch.js

# Disable Playwright scraper (faster, link-only mode)
FENWAY_DISABLE_SCRAPER=1 node scripts/fetch.js

# Serve dashboard locally
npx serve . -l 3000
# Then open http://localhost:3000/dashboard/
```

## Architecture

### Data Pipeline (`scripts/`)

- `scripts/fetch.js` — main orchestrator
- `scripts/utils.js` — config loading (with .env support), shared helpers
- `scripts/sources/` — modular source design, each independently feature-flagged:
  - `mlb-schedule.js` — MLB Stats API, no key needed (batch source)
  - `ticketmaster.js` — Discovery API for event URLs + links (per-game source)
  - `ticketmaster-scraper.js` — Playwright-based price scraper, loads each event page and intercepts internal pricing API responses (batch source)
  - `seatgeek.js` — resale prices with section filtering (per-game source, optional)
  - `weather.js` — Open-Meteo forecasts (batch source)

### Data Flow

1. MLB Stats API (free, no key) → `data/schedule.json`
2. Ticketmaster Discovery API → event URLs per game
3. Playwright scraper → real pricing from TM internal API (intercepted from page load)
4. SeatGeek API (optional) → resale prices filtered by section + quantity
5. Open-Meteo (free, no key) → weather forecasts for games within 14 days
6. Results merged into `data/latest.json` + daily snapshot in `data/history/YYYY-MM-DD.json`

### Dashboard (`dashboard/`)

- `index.html` — static PWA, fetches `../data/latest.json` client-side
- `sw.js` — service worker (network-first for JSON, cache-first for static)
- Color palette: `#bd3039` (Red Sox red), `#0d1f2d` (navy), `#ffffff`

## Key Design Decisions

- **Ticketmaster Discovery API doesn't return MLB prices** — it only gives event URLs. The Playwright scraper fills in actual pricing by intercepting the internal `offeradapter.ticketmaster.com` facets API from within a browser context. CORS prevents cross-event API reuse, so each game requires its own page load.
- **`best_available` field:** Always computed across all active sources — dashboard reads this for primary display
- **Config precedence:** env vars (FENWAY_ prefix) override `config.json` values; `.env` file loaded automatically but never overrides existing env vars
- **All stored timestamps:** UTC ISO 8601. Dashboard converts to ET for display.
- **History files accumulate** (~180/season) — no cleanup/pruning needed
- **Rate limiting:** 500ms delay between SeatGeek requests; log 429s, don't retry
- **Scraper can be disabled** via `FENWAY_DISABLE_SCRAPER=1` for faster runs without pricing
- **Dashboard deploys:** bump `CACHE_VERSION` in `sw.js` when changing `index.html` — otherwise returning users get stale cached HTML

## GitHub Actions

- Workflow: `.github/workflows/fetch-tickets.yml`
- Cron: daily at 12:00 UTC (8am ET) + manual `workflow_dispatch`
- Secrets: `TICKETMASTER_API_KEY` (required), `SEATGEEK_CLIENT_ID` (optional)
- Installs Playwright chromium browser for price scraping
- Needs `contents: write` permission to commit data back to repo
