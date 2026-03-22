import { writeFile, readFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { loadConfig, formatDate, ensureDir, rootPath, sleep } from './utils.js';
import { fetchSchedule } from './sources/mlb-schedule.js';
import { fetchTicketmaster } from './sources/ticketmaster.js';
import { scrapeTmPrices } from './sources/ticketmaster-scraper.js';
import { fetchSeatGeek } from './sources/seatgeek.js';
import { fetchWeather } from './sources/weather.js';
import { fetchMlbTickets } from './sources/mlb-tickets.js';

async function main() {
  const config = await loadConfig();
  const now = new Date();
  console.log(`\n=== Fenway Ticket Tracker — ${now.toISOString()} ===\n`);

  // Ensure data dirs exist before any writes
  await ensureDir(rootPath('data'));
  await ensureDir(rootPath('data', 'history'));

  // 1. Fetch full home schedule
  const allGames = await fetchSchedule();

  // 2. Filter to upcoming games within check_days_ahead
  const today = formatDate(now);
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() + config.check_days_ahead);
  const cutoffStr = formatDate(cutoff);

  const upcomingGames = allGames.filter(g => g.date >= today && g.date <= cutoffStr);

  if (upcomingGames.length === 0) {
    console.log(`\nNo home games within next ${config.check_days_ahead} days — skipping ticket fetch.\n`);
    await writeEmptyLatest(now);
    return;
  }

  console.log(`\n${upcomingGames.length} upcoming home games within ${config.check_days_ahead} days\n`);

  // 3. Fetch weather and primary market links
  const weatherMap = await fetchWeather(upcomingGames, config);
  const mlbTicketsMap = await fetchMlbTickets();

  // 4. Load historical data for velocity calculation
  const historyMap = await loadHistory(config.velocity_window_days);

  // 5. Fetch ticket data for each game
  const tmApiKey = process.env.TICKETMASTER_API_KEY;
  if (!tmApiKey) {
    console.error('[ERROR] TICKETMASTER_API_KEY is required but not set');
    process.exit(1);
  }

  const sgClientId = process.env.SEATGEEK_CLIENT_ID || null;
  if (!sgClientId) {
    console.log('[SeatGeek] No SEATGEEK_CLIENT_ID set — skipping resale data');
  }

  const gameRecords = [];
  let tmCount = 0;
  let sgCount = 0;
  let scrapeCount = 0;
  let weatherCount = 0;
  let failCount = 0;
  let sgRateLimited = false;

  for (let i = 0; i < upcomingGames.length; i++) {
    const game = upcomingGames[i];
    try {
      const record = await buildGameRecord(game, config, tmApiKey, sgClientId, sgRateLimited, weatherMap, historyMap, mlbTicketsMap);
      gameRecords.push(record);
      if (record.tickets.ticketmaster) tmCount++;
      if (record.tickets.seatgeek) sgCount++;
      if (record.weather.forecast_available) weatherCount++;

      // Check if SeatGeek got rate limited
      if (record._sgRateLimited) sgRateLimited = true;
    } catch (err) {
      failCount++;
      console.error(`[ERROR] Failed to process ${game.date} vs ${game.opponent}: ${err.message}`);
    }

    // Delay between games to avoid rate limits (TM Discovery + SeatGeek)
    if (i < upcomingGames.length - 1) {
      await sleep(500);
    }
  }

  // 5b. Scrape real pricing via Playwright (fills in prices the Discovery API doesn't provide)
  const scrapePricing = process.env.FENWAY_DISABLE_SCRAPER !== '1';
  if (scrapePricing) {
    // Build event ID list from Discovery API results (ticketmaster module stores the TM event ID in listing_url)
    const eventIds = [];
    for (const record of gameRecords) {
      const tmUrl = record.tickets.ticketmaster?.listing_url;
      if (tmUrl) {
        // Extract TM event ID from URL like https://www.ticketmaster.com/event/Z7r9jZ1A7Q8Fv
        const match = tmUrl.match(/\/event\/([A-Za-z0-9]+)/);
        if (match) {
          eventIds.push({ game_id: record.game_id, tm_event_id: match[1] });
        }
      }
    }

    if (eventIds.length > 0) {
      const scraped = await scrapeTmPrices(eventIds);

      // Merge scraped prices into game records
      for (const record of gameRecords) {
        const priceData = scraped.get(record.game_id);
        if (priceData) {
          // Update ticketmaster prices if Discovery API didn't have them
          if (record.tickets.ticketmaster && record.tickets.ticketmaster.min_price == null) {
            record.tickets.ticketmaster.min_price = priceData.min_price;
            record.tickets.ticketmaster.max_price = priceData.max_price;
          }
          record.tickets.ticketmaster_scraped = priceData;
          scrapeCount++;

          // Recompute best_available with new data
          const best = computeBestAvailable(record.tickets.ticketmaster, record.tickets.seatgeek);
          record.best_available = best;
          record.price_alert = best ? best.price < config.price_alert_threshold : false;
          record.velocity = computeVelocity(record.game_id, best, historyMap, config.price_alert_threshold);
        }
      }
    }
  }

  // 6. Write output files
  const output = buildOutput(now, gameRecords);

  const latestPath = rootPath('data', 'latest.json');
  const historyPath = rootPath('data', 'history', `${today}.json`);

  await writeFile(latestPath, JSON.stringify(output, null, 2));
  await writeFile(historyPath, JSON.stringify(output, null, 2));

  console.log(`\n=== Done ===`);
  const parts = [`${tmCount} Ticketmaster`];
  if (scrapeCount) parts.push(`${scrapeCount} scraped prices`);
  if (sgClientId) parts.push(`${sgCount} SeatGeek`);
  parts.push(`${weatherCount} weather`);
  if (failCount) parts.push(`${failCount} failed`);
  console.log(`Fetched ${gameRecords.length} games: ${parts.join(', ')}`);
  console.log(`Wrote data/latest.json and data/history/${today}.json\n`);
}

async function buildGameRecord(game, config, tmApiKey, sgClientId, sgRateLimited, weatherMap, historyMap, mlbTicketsMap) {
  // Ticketmaster (per-game, always runs)
  const tmData = await fetchTicketmaster(game, tmApiKey);

  // SeatGeek (per-game, feature-flagged, skip if rate limited)
  let sgData = null;
  let rateLimited = false;
  if (sgClientId && !sgRateLimited) {
    const result = await fetchSeatGeek(game, sgClientId, config);
    if (result?._rateLimited) {
      rateLimited = true;
    } else {
      sgData = result;
    }
  }

  // Primary market (mlb.tickets.com) — sold-out status + buy link
  const scheduleId = game.game_id.replace('mlb-', '');
  const primaryMarket = mlbTicketsMap.get(scheduleId) || null;

  // Weather
  const weather = weatherMap.get(game.date) || { forecast_available: false };

  // Best available — lowest price across all sources
  const bestAvailable = computeBestAvailable(tmData, sgData);

  // Price alert
  const priceAlert = bestAvailable ? bestAvailable.price < config.price_alert_threshold : false;

  // Preferred day
  const isPreferredDay = config.preferred_days.includes(game.day_of_week);

  // Velocity — compare to historical best price
  const velocity = computeVelocity(game.game_id, bestAvailable, historyMap, config.price_alert_threshold);

  const record = {
    game_id: game.game_id,
    date: game.date,
    day_of_week: game.day_of_week,
    opponent: game.opponent,
    is_preferred_day: isPreferredDay,
    tickets: {
      ticketmaster: tmData,
      seatgeek: sgData,
    },
    primary_market: primaryMarket,
    best_available: bestAvailable,
    price_alert: priceAlert,
    weather,
    velocity,
  };

  // Internal flag for rate limit propagation (not written to JSON)
  if (rateLimited) record._sgRateLimited = true;

  return record;
}

function computeBestAvailable(tmData, sgData) {
  const candidates = [];

  // Only include sources that have actual price data
  if (tmData?.min_price != null) {
    candidates.push({
      price: tmData.min_price,
      source: 'ticketmaster',
      is_primary: true,
    });
  }

  if (sgData?.low_price != null) {
    candidates.push({
      price: sgData.low_price,
      source: 'seatgeek',
      is_primary: false,
    });
  }

  if (candidates.length === 0) return null;
  return candidates.reduce((best, c) => c.price < best.price ? c : best);
}

/**
 * Load the history file from velocity_window_days ago for price comparison.
 * Falls back to the oldest available history file if exact date not found.
 * Returns a Map<game_id, best_price> or empty map.
 */
async function loadHistory(velocityWindowDays) {
  const historyDir = rootPath('data', 'history');
  const map = new Map();

  // Target date: N days ago
  const target = new Date();
  target.setDate(target.getDate() - velocityWindowDays);
  const targetStr = formatDate(target);

  // Try exact match first
  const targetFile = rootPath('data', 'history', `${targetStr}.json`);
  if (existsSync(targetFile)) {
    return parseHistoryFile(targetFile);
  }

  // Fallback: find oldest available history file
  try {
    const files = readdirSync(historyDir)
      .filter(f => f.endsWith('.json'))
      .sort();

    if (files.length > 0) {
      const oldestFile = rootPath('data', 'history', files[0]);
      console.log(`[Velocity] No history for ${targetStr}, using oldest: ${files[0]}`);
      return parseHistoryFile(oldestFile);
    }
  } catch {
    // No history directory or empty — fine
  }

  console.log('[Velocity] No historical data available yet');
  return map;
}

async function parseHistoryFile(filePath) {
  const map = new Map();
  try {
    const raw = await readFile(filePath, 'utf-8');
    const data = JSON.parse(raw);
    for (const game of data.games || []) {
      if (game.best_available?.price != null) {
        map.set(game.game_id, game.best_available.price);
      }
    }
  } catch (err) {
    console.warn(`[Velocity] Failed to parse history file: ${err.message}`);
  }
  return map;
}

function computeVelocity(gameId, bestAvailable, historyMap, threshold) {
  if (!bestAvailable || historyMap.size === 0) {
    return { direction: null, change_7d: null, change_pct_7d: null, trend: 'insufficient_data' };
  }

  const historicalPrice = historyMap.get(gameId);
  if (historicalPrice == null) {
    return { direction: null, change_7d: null, change_pct_7d: null, trend: 'insufficient_data' };
  }

  const change = Math.round((bestAvailable.price - historicalPrice) * 100) / 100;
  const changePct = Math.round((change / historicalPrice) * 1000) / 10;

  let direction;
  if (changePct < -2) direction = 'falling';
  else if (changePct > 2) direction = 'rising';
  else direction = 'stable';

  let trend;
  if (direction === 'falling' && bestAvailable.price < threshold) {
    trend = 'act_now';
  } else if (direction === 'falling') {
    trend = 'good_time_to_buy';
  } else if (direction === 'rising') {
    trend = 'rising';
  } else {
    trend = 'stable';
  }

  return { direction, change_7d: change, change_pct_7d: changePct, trend };
}

function buildOutput(now, games = []) {
  // Strip internal flags before writing
  const cleanGames = games.map(({ _sgRateLimited, ...rest }) => rest);
  return { generated_at: now.toISOString(), games: cleanGames };
}

async function writeEmptyLatest(now) {
  await writeFile(rootPath('data', 'latest.json'), JSON.stringify(buildOutput(now), null, 2));
  console.log('Wrote empty data/latest.json');
}

main().catch(err => {
  console.error(`\n[FATAL] ${err.message}`);
  process.exit(1);
});
