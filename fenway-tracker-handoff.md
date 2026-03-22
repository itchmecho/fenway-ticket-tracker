# Fenway Ticket Tracker — Claude Code Handoff

## Project Summary

A fully free, serverless ticket price tracker for Red Sox home games at Fenway Park.
Targets field box seats near home plate (sections TBD), minimum 2 seats together.
Runs on GitHub Actions, stores data as JSON in the repo, and serves a static PWA dashboard via GitHub Pages.

---

## Repository Structure

```
fenway-tracker/
├── .github/
│   └── workflows/
│       └── fetch-tickets.yml        # Scheduled + manual GitHub Action
├── data/
│   ├── latest.json                  # Current best prices per game/section
│   ├── schedule.json                # Cached Red Sox home schedule (from MLB Stats API)
│   └── history/
│       └── YYYY-MM-DD.json          # Daily price snapshots (committed by Action)
├── dashboard/
│   ├── index.html                   # Main PWA dashboard
│   ├── manifest.json                # PWA web app manifest
│   ├── sw.js                        # Service worker for offline support
│   └── icons/                       # PWA icons (192x192, 512x512)
├── scripts/
│   └── fetch.js                     # Node.js script executed by the Action
└── config.json                      # User-editable settings (sections, threshold, etc.)
```

---

## Data Sources

### Source Availability Summary

| Source | Type | Cost | Access | Priority |
|---|---|---|---|---|
| MLB Stats API | Schedule | Free, no key | Instant | Required |
| Open-Meteo | Weather | Free, no key | Instant | Required |
| Ticketmaster Discovery | Primary market (face value) | Free, self-serve | Registration required | Co-primary |
| SeatGeek | Resale | Free, approval required | Pending | Co-primary |

All ticket sources should be implemented as independent, feature-flagged modules. If a secret is absent, that source skips silently and logs a warning. The system should degrade gracefully down to just Ticketmaster if SeatGeek approval is denied.

**Note on other resale platforms:** StubHub, VividSeats, Gametime, and TickPick do not offer free public consumer-facing APIs — their developer programs are broker/seller-only, built for listing and managing inventory. Paid aggregators (e.g. TicketsData, starting at $499/month) exist but are not appropriate for a personal project. Scraping is technically possible but fragile, against ToS on most platforms, and GitHub Actions runner IPs are well-known datacenter ranges that get flagged quickly by anti-bot systems. SeatGeek and Ticketmaster are the only viable free sources for this use case.

---

### 1. MLB Stats API — Schedule (Free, No Key Required)
- **Base URL:** `https://statsapi.mlb.com/api/v1/`
- **Endpoint:** `schedule?sportId=1&teamId=111&gameType=R&season=2025`
- `teamId=111` is the Boston Red Sox
- Returns full regular season home/away schedule with dates, opponents, and game IDs
- Use this as the authoritative schedule source — more reliable than deriving it from SeatGeek event searches
- No API key needed, no attribution required for personal use
- **Note:** Review MLB's terms of use before any public distribution of data

### 2. Ticketmaster Discovery API — Primary Market Prices (Free, Self-Serve)
- **Registration:** `developer.ticketmaster.com` — instant key on signup, no approval required
- **Base URL:** `https://app.ticketmaster.com/discovery/v2/`
- **Auth:** `?apikey=YOUR_KEY` as a query param
- **Rate limit:** 5,000 calls/day free — more than sufficient for this use case
- Key endpoints:
  - `events.json?keyword=boston+red+sox&venueId=KovZpZA7AAEA` — Fenway Park venue ID
  - Returns `priceRanges` (min/max) and `url` for each event
- Covers **face value / primary market** tickets — distinct from and complementary to resale sources
- Store key as GitHub Actions secret: `TICKETMASTER_API_KEY`
- **Note:** Ticketmaster is Fenway's official ticketer, so primary inventory coverage is complete

### 3. SeatGeek API — Resale Ticket Prices (Free, Approval Required)
- **Base URL:** `https://api.seatgeek.com/2/`
- **Auth:** `?client_id=YOUR_CLIENT_ID` as a query param
- Register at `developer.seatgeek.com` — requires manual approval
- Key endpoints:
  - `events?performers.slug=boston-red-sox&venue.id=21` — Fenway events (venue ID 21)
  - `listings?event_id=EVENT_ID&section=SECTION_NAME&quantity=2` — filter by section + pair
- Returns resale/secondary market prices with section-level and quantity filtering
- SeatGeek logo attribution required wherever data is displayed
- Store client ID as GitHub Actions secret: `SEATGEEK_CLIENT_ID`
- **If approval is denied:** system falls back to Ticketmaster-only gracefully

### 4. Open-Meteo — Weather Forecast (Free, No Key Required)
- **Base URL:** `https://api.open-meteo.com/v1/forecast`
- No API key, no account, no attribution required
- Fetch for Fenway coordinates: `latitude=42.3467&longitude=-71.0972`
- Pull `temperature_2m_max`, `precipitation_sum`, `weathercode` for each game date
- Only fetch weather for games within 14 days (forecast accuracy window)
- Store weather snapshot per game in `latest.json`

### 5. TicketsData — Aggregated Resale (Paid, Escalation Path Only)
- **URL:** `ticketsdata.com`
- Wraps Ticketmaster, StubHub, SeatGeek, VividSeats, Gametime, TickPick, and Viagogo in a single normalized API
- Instant access, no approval process — but requires a paid subscription
- Only implement if SeatGeek approval is denied AND broader resale coverage is desired
- All other resale platforms (VividSeats, StubHub, Gametime, TickPick) do not offer free public consumer APIs — their developer programs are broker/seller-only
- Store key as GitHub Actions secret: `TICKETSDATA_API_KEY`
- Architecture should support dropping this in as a replacement for SeatGeek with minimal changes

---

## Configuration — `config.json`

```json
{
  "sections": [],
  "min_quantity": 2,
  "price_alert_threshold": 75,
  "preferred_days": ["Saturday", "Sunday"],
  "check_days_ahead": 30,
  "weather_forecast_window_days": 14,
  "velocity_window_days": 7
}
```

`sections` starts empty — user will populate with exact SeatGeek section identifiers once confirmed.
All values should be overridable via GitHub Actions env vars (env vars take precedence over config.json).

---

## GitHub Actions Workflow

### Triggers
```yaml
on:
  schedule:
    - cron: '0 12 * * *'     # Daily at 12:00 UTC (8am ET)
  workflow_dispatch:           # Manual trigger from GitHub UI anytime
```

### Required Secrets
| Secret | Purpose | Required? |
|---|---|---|
| `TICKETMASTER_API_KEY` | Ticketmaster Discovery API | Yes — register at developer.ticketmaster.com |
| `SEATGEEK_CLIENT_ID` | SeatGeek resale API | Optional — pending approval |

### Required Permissions
```yaml
permissions:
  contents: write    # Required to commit data files back to repo
```

### Steps
1. Checkout repo
2. Setup Node.js
3. Run `scripts/fetch.js`
4. Commit any changed files in `data/` back to the repo
5. GitHub Pages auto-deploys on push (configured separately in repo settings)

---

## `scripts/fetch.js` — Logic Overview

### Execution Flow

```
1. Load config.json + env var overrides
2. Fetch Red Sox home schedule from MLB Stats API → cache to data/schedule.json
3. Filter games: upcoming only, within check_days_ahead window
4. For each qualifying game:
   a. Fetch Ticketmaster Discovery listings (always — key is always present)
   b. Fetch SeatGeek listings filtered by section(s) + min_quantity (if SEATGEEK_CLIENT_ID present)
   c. Fetch Open-Meteo weather for game date (if within forecast window)
   d. Calculate price velocity (see below)
   e. Build game record
5. Write data/latest.json
6. Write data/history/YYYY-MM-DD.json (today's snapshot)
7. Exit — GitHub Action commits the changes
```

### Game Record Structure (`latest.json`)

```json
{
  "generated_at": "2025-04-10T12:00:00Z",
  "games": [
    {
      "game_id": "mlb-717465",
      "date": "2025-04-18",
      "day_of_week": "Friday",
      "opponent": "New York Yankees",
      "is_preferred_day": false,
      "tickets": {
        "ticketmaster": {
          "min_price": 68.00,
          "max_price": 320.00,
          "listing_url": "https://ticketmaster.com/...",
          "source": "primary"
        },
        "seatgeek": {
          "low_price": 82.00,
          "median_price": 140.00,
          "pairs_available": 14,
          "best_section": "Field Box 34",
          "listing_url": "https://seatgeek.com/...",
          "source": "resale"
        }
      },
      "best_available": {
        "price": 68.00,
        "source": "ticketmaster",
        "is_primary": true
      },
      "price_alert": true,
      "weather": {
        "high_temp_f": 64,
        "precipitation_in": 0.0,
        "condition": "Partly cloudy",
        "forecast_available": true
      },
      "velocity": {
        "direction": "falling",
        "change_7d": -18.00,
        "change_pct_7d": -18.0,
        "trend": "good_time_to_buy"
      }
    }
  ]
}
```

### Price Velocity Logic

- On each run, compare today's `low_price` to the price stored 7 days ago in `data/history/`
- If history file for 7 days ago doesn't exist, use the oldest available snapshot
- `direction`: `"falling"` | `"rising"` | `"stable"` (< 2% change = stable)
- `trend` classification:
  - `"good_time_to_buy"` — price falling, still above floor
  - `"act_now"` — price falling AND under threshold
  - `"rising"` — price increasing
  - `"stable"` — minimal movement
  - `"insufficient_data"` — not enough history yet

### Game-Day Awareness

- Always run the full schedule fetch regardless of season (lightweight, no key needed)
- Only hit ticket APIs if there are home games within `check_days_ahead`
- Log clearly when skipping ticket fetch due to no upcoming games — keeps Actions logs readable

### Rate Limiting

- Add a 500ms delay between SeatGeek requests for different games
- Log HTTP status codes — 429 means back off, not retry immediately

---

## Dashboard — `dashboard/index.html`

### Views
- **Game list** — all upcoming home games, sorted by date
  - Each row: date, day of week, opponent, weather icon + forecast, best available price with source label (Ticketmaster vs. SeatGeek), pairs available count (where known), deal badge if under threshold, preferred day badge
  - "Primary" vs "Resale" label on each price — face value and resale are meaningfully different and should be visually distinct
  - Click to expand: price trend sparkline, velocity indicator, direct buy links per source
- **Price trend chart** — per-game price history, rendered from `data/history/*.json`
  - X axis: date of snapshot; Y axis: lowest available price
  - Show Ticketmaster and SeatGeek as separate series when both are available
  - Overlay: price threshold line
- **Filters** — toggle preferred days only, toggle deals only, sort by price / date / velocity

### Deal Badge Logic
- Show "🔥 Deal" badge when `low_price < price_alert_threshold`
- Show "📉 Falling" badge when `velocity.direction === "falling"`
- Show "⭐ Weekend" badge when `is_preferred_day === true`

### Data Loading
- Dashboard is fully static — uses `fetch()` to load `../data/latest.json` and `../data/history/*.json` client-side
- Show "Last updated: [generated_at timestamp]" prominently
- Gracefully handle missing history files (some games won't have history yet early in the season)

---

## PWA Configuration

### `manifest.json`
```json
{
  "name": "Fenway Ticket Tracker",
  "short_name": "Fenway Tix",
  "start_url": "/dashboard/",
  "display": "standalone",
  "background_color": "#0d1f2d",
  "theme_color": "#bd3039",
  "icons": [
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

Use Red Sox color palette: `#bd3039` (red), `#0d1f2d` (navy), `#ffffff`.

### `sw.js` — Service Worker
- Cache strategy: **network-first for JSON data, cache-first for static assets**
- Cache `latest.json` so the dashboard loads offline with the last-fetched data
- Show a subtle "offline — showing cached data" banner when network is unavailable
- Cache version key in a constant at the top of `sw.js` — increment to bust cache on deploy

---

## GitHub Pages Setup

1. Go to repo **Settings → Pages**
2. Source: **Deploy from a branch**
3. Branch: `main`, folder: `/` (root) or `/dashboard` — either works, just set `start_url` in manifest accordingly
4. Dashboard will be live at `https://USERNAME.github.io/fenway-tracker/dashboard/`

---

## Open Items (User to Resolve)

- **Target sections:** Confirm exact section name strings for field boxes near home plate. For SeatGeek, verify by fetching a known Fenway event and inspecting the `section` field on listings. For Ticketmaster, section filtering is less granular — may need to filter by price range as a proxy.
- **Price threshold:** Set `price_alert_threshold` in `config.json` (per-ticket price)
- **Preferred days:** Currently `["Saturday", "Sunday"]` — adjust as needed
- **SeatGeek approval:** If denied, Ticketmaster Discovery is the sole ticket source. No other free resale APIs exist for this use case — all major resale platforms (StubHub, VividSeats, Gametime, TickPick) are broker-only.
- **Ticketmaster registration:** Register at `developer.ticketmaster.com` — instant, no approval needed. Do this now regardless of SeatGeek outcome.

---

## Dependencies

```json
{
  "node": ">=18",
  "dependencies": {
    "node-fetch": "^3.0.0"
  }
}
```

No build step, no bundler — keep the fetch script as plain Node.js and the dashboard as vanilla HTML/CSS/JS. Keeps maintenance surface minimal.

---

## Notes for Claude Code

- **Source architecture:** Each ticket source (Ticketmaster, SeatGeek) should be a separate module in `scripts/sources/`. The main `fetch.js` imports and calls each one, checks for its required secret, and skips with a warning if absent. This makes adding/removing sources a one-line change in the future.
- **Ticketmaster section filtering:** The Discovery API returns `priceRanges` at the event level, not per-section. Section-level data requires the Partner API (not available). For this project, use Ticketmaster for overall floor price and SeatGeek for section-specific filtering when available.
- **SeatGeek section name mapping:** The API field value and the printed section name on the ticket may not match. Build in a `SECTION_MAP` object in config for aliasing.
- **best_available field:** Always compute and store a `best_available` object that picks the lowest price across all active sources — this is what the dashboard's primary display uses so it doesn't need source-specific logic.
- **History directory:** Will accumulate one JSON file per day over a full season (~180 files, all small). This is fine for GitHub — do not implement any cleanup/pruning logic.
- **Open-Meteo weather codes:** Returns `weathercode` as a WMO integer. Include a small lookup table to convert to human-readable strings and emoji icons.
- **All times in stored JSON** should be UTC ISO 8601. The dashboard converts to ET for display.
- **GitHub Action git commit:** Must set `git config user.email` and `user.name` before committing data files, or the commit will fail.
