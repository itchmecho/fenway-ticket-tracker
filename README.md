# Fenway Ticket Tracker

A serverless ticket price tracker for Red Sox home games at Fenway Park. Runs daily on GitHub Actions, scrapes real pricing data via Playwright, and serves a static PWA dashboard via GitHub Pages.

## How It Works

1. **GitHub Actions** runs daily at 8am ET (+ manual trigger)
2. Fetches the Red Sox home schedule from the MLB Stats API
3. Gets event URLs from the Ticketmaster Discovery API
4. Scrapes actual ticket prices using Playwright (headless browser)
5. Optionally pulls resale data from SeatGeek
6. Fetches weather forecasts from Open-Meteo for upcoming games
7. Writes results to `data/latest.json` and a daily history snapshot
8. Dashboard reads the JSON and displays everything

## Setup

### 1. Clone and install

```bash
git clone <repo-url>
cd fenway-ticket-tracker
npm install
npx playwright install chromium
```

### 2. Configure API keys

Create a `.env` file in the project root:

```
TICKETMASTER_API_KEY=your_consumer_key
SEATGEEK_CLIENT_ID=your_client_id
```

- **Ticketmaster** (required): Register at [developer.ticketmaster.com](https://developer.ticketmaster.com) — instant, no approval needed. Use the Consumer Key.
- **SeatGeek** (optional): Register at [developer.seatgeek.com](https://developer.seatgeek.com) — requires manual approval. System works without it.

### 3. Run locally

```bash
node scripts/fetch.js
```

### 4. View the dashboard

```bash
npx serve . -l 3000
# Open http://localhost:3000/dashboard/
```

### 5. GitHub Actions setup

Add these secrets in your repo's **Settings > Secrets and variables > Actions**:

| Secret | Required | Source |
|--------|----------|--------|
| `TICKETMASTER_API_KEY` | Yes | developer.ticketmaster.com |
| `SEATGEEK_CLIENT_ID` | No | developer.seatgeek.com |

The workflow triggers daily at 12:00 UTC (8am ET) and can be run manually from the Actions tab.

### 6. GitHub Pages

1. Go to **Settings > Pages**
2. Source: **Deploy from a branch**
3. Branch: `main`, folder: `/` (root)
4. Dashboard will be live at `https://<username>.github.io/fenway-ticket-tracker/dashboard/`

## Configuration

Edit `config.json` to customize:

| Key | Default | Description |
|-----|---------|-------------|
| `sections` | `[]` | SeatGeek section names to filter (empty = all) |
| `section_map` | `{}` | Map API section names to display names |
| `min_quantity` | `2` | Minimum seats together |
| `price_alert_threshold` | `75` | Price ($) below which a game gets a "Deal" badge |
| `preferred_days` | `["Saturday", "Sunday"]` | Days that get a "Weekend" badge |
| `check_days_ahead` | `30` | How far ahead to look for games |
| `weather_forecast_window_days` | `14` | Weather forecast accuracy window |
| `velocity_window_days` | `7` | Days to look back for price velocity |

All values can be overridden via env vars with a `FENWAY_` prefix (e.g., `FENWAY_PRICE_ALERT_THRESHOLD=100`).

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TICKETMASTER_API_KEY` | Yes | Ticketmaster Discovery API consumer key |
| `SEATGEEK_CLIENT_ID` | No | SeatGeek API client ID |
| `FENWAY_DISABLE_SCRAPER` | No | Set to `1` to skip Playwright price scraping |

## Data Sources

| Source | What It Provides | Cost | Key Required |
|--------|-----------------|------|-------------|
| MLB Stats API | Home game schedule | Free | No |
| Ticketmaster Discovery | Event URLs + links | Free | Yes |
| Ticketmaster (scraped) | Actual ticket prices | Free | No (uses Playwright) |
| SeatGeek | Resale prices by section | Free | Yes (approval required) |
| Open-Meteo | Weather forecasts | Free | No |

## v1.0.0

Initial release with full pipeline: schedule, pricing (Discovery API + Playwright scraper), weather, price velocity, and PWA dashboard.
