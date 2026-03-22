import { sleep } from '../utils.js';

const BASE_URL = 'https://api.seatgeek.com/2';
const FENWAY_VENUE_ID = 21;

/**
 * Fetch SeatGeek resale listings for a single game.
 * Called once per qualifying game. 500ms delay enforced by caller.
 * Returns listing data object or null if unavailable/skipped.
 */
export async function fetchSeatGeek(game, clientId, config) {
  if (!clientId) {
    return null;
  }

  // Step 1: Find the SeatGeek event matching this game date
  const eventsUrl = `${BASE_URL}/events?client_id=${clientId}&performers.slug=boston-red-sox&venue.id=${FENWAY_VENUE_ID}&datetime_utc=${game.date}`;
  const eventsRes = await fetch(eventsUrl);

  if (!eventsRes.ok) {
    if (eventsRes.status === 429) {
      console.warn(`[SeatGeek] Rate limited (429) for ${game.date} — skipping remaining games`);
      return { _rateLimited: true };
    }
    console.warn(`[SeatGeek] HTTP ${eventsRes.status} for ${game.date} — skipping`);
    return null;
  }

  const eventsData = await eventsRes.json();
  const events = eventsData.events || [];

  if (events.length === 0) {
    console.log(`[SeatGeek] No event found for ${game.date} vs ${game.opponent}`);
    return null;
  }

  const event = events[0];
  const eventId = event.id;

  // Step 2: Fetch listings with quantity filter
  let listingsUrl = `${BASE_URL}/listings?client_id=${clientId}&event_id=${eventId}&quantity=${config.min_quantity || 2}`;

  // Add section filter if configured
  const sections = config.sections || [];
  if (sections.length > 0) {
    // SeatGeek supports section filtering on the listings endpoint
    listingsUrl += `&section=${encodeURIComponent(sections.join(','))}`;
  }

  const listingsRes = await fetch(listingsUrl);

  if (!listingsRes.ok) {
    if (listingsRes.status === 429) {
      console.warn(`[SeatGeek] Rate limited (429) on listings for ${game.date}`);
      return { _rateLimited: true };
    }
    console.warn(`[SeatGeek] HTTP ${listingsRes.status} on listings for ${game.date} — skipping`);
    return null;
  }

  const listingsData = await listingsRes.json();
  const listings = listingsData.listings || [];

  if (listings.length === 0) {
    console.log(`[SeatGeek] No qualifying listings for ${game.date} vs ${game.opponent}`);
    return null;
  }

  // Compute stats from listings
  const prices = listings.map(l => l.price).filter(p => typeof p === 'number').sort((a, b) => a - b);

  if (prices.length === 0) return null;

  const lowPrice = prices[0];
  const medianPrice = prices[Math.floor(prices.length / 2)];

  // Find best section (lowest-priced listing's section)
  const bestListing = listings.reduce((best, l) =>
    (l.price < best.price) ? l : best, listings[0]);

  // Apply section name mapping
  const sectionMap = config.section_map || {};
  const rawSection = bestListing.section || 'Unknown';
  const bestSection = sectionMap[rawSection] || rawSection;

  const listingUrl = event.url || null;

  return {
    low_price: lowPrice,
    median_price: medianPrice,
    pairs_available: listings.length,
    best_section: bestSection,
    listing_url: listingUrl,
    source: 'resale',
  };
}
