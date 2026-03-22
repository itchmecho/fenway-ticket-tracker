# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Fenway Ticket Tracker — a serverless Red Sox ticket price tracker. Runs on GitHub Actions (daily cron), stores price data as JSON in the repo, and serves a static PWA dashboard via GitHub Pages. No build step, no bundler.

The full project spec lives in `fenway-tracker-handoff.md`.

## Tech Stack

- **Fetch script:** Plain Node.js (>=18), single dependency (`node-fetch`)
- **Dashboard:** Vanilla HTML/CSS/JS (no framework, no build tools)
- **CI/Data pipeline:** GitHub Actions (scheduled + manual trigger)
- **Hosting:** GitHub Pages (static, deployed from main branch)

## Commands

```bash
# Run the fetch script locally (requires env vars for API keys)
TICKETMASTER_API_KEY=xxx node scripts/fetch.js

# With optional SeatGeek
TICKETMASTER_API_KEY=xxx SEATGEEK_CLIENT_ID=yyy node scripts/fetch.js

# No test framework yet — run fetch.js and inspect data/ output manually
```

## Architecture

### Data Pipeline (`scripts/`)

- `scripts/fetch.js` — main entry point, orchestrates the full fetch flow
- `scripts/sources/` — each ticket source (Ticketmaster, SeatGeek) is a separate module; main script imports each, checks for its required secret, skips with warning if absent
- Sources are feature-flagged by secret presence: if `SEATGEEK_CLIENT_ID` is missing, SeatGeek silently skips

### Data Flow

1. MLB Stats API (free, no key) -> `data/schedule.json` (home game schedule)
2. Ticketmaster Discovery API -> primary/face-value prices per event
3. SeatGeek API (if approved) -> resale prices filtered by section + quantity
4. Open-Meteo (free, no key) -> weather forecasts for games within 14 days
5. Results merged into `data/latest.json` + daily snapshot in `data/history/YYYY-MM-DD.json`

### Dashboard (`dashboard/`)

- `index.html` — static PWA, fetches `../data/latest.json` and `../data/history/*.json` client-side
- `sw.js` — service worker (network-first for JSON, cache-first for static assets)
- Color palette: `#bd3039` (Red Sox red), `#0d1f2d` (navy), `#ffffff`

## Key Design Decisions

- **`best_available` field:** Always computed across all active sources — dashboard reads this for primary display, never source-specific logic
- **Ticketmaster gives event-level `priceRanges` only** (no per-section data without Partner API). SeatGeek handles section-specific filtering.
- **SeatGeek section names** may differ from printed ticket names — use `SECTION_MAP` in config for aliasing
- **Config precedence:** GitHub Actions env vars override `config.json` values
- **All stored timestamps:** UTC ISO 8601. Dashboard converts to ET for display.
- **History files accumulate** (~180/season) — no cleanup/pruning needed
- **Open-Meteo `weathercode`** is a WMO integer — needs a lookup table for human-readable strings + emoji
- **Rate limiting:** 500ms delay between SeatGeek requests for different games; log 429s, don't retry immediately

## GitHub Actions

- Workflow: `.github/workflows/fetch-tickets.yml`
- Cron: daily at 12:00 UTC (8am ET) + manual `workflow_dispatch`
- Secrets: `TICKETMASTER_API_KEY` (required), `SEATGEEK_CLIENT_ID` (optional)
- Must set `git config user.email` and `user.name` before committing data files
- Needs `contents: write` permission to commit data back to repo
