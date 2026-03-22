const BASE_URL = 'https://app.ticketmaster.com/discovery/v2';
const FENWAY_VENUE_ID = 'KovZpZAaaI7A';

/**
 * Fetch Ticketmaster Discovery API data for a single game.
 * Called once per qualifying game.
 * Returns ticket data object or null if no match found.
 */
export async function fetchTicketmaster(game, apiKey) {
  if (!apiKey) {
    console.warn('[Ticketmaster] No API key — skipping');
    return null;
  }

  // Search for events at Fenway on the game date
  const startDate = `${game.date}T00:00:00Z`;
  const endDate = `${game.date}T23:59:59Z`;
  const url = `${BASE_URL}/events.json?apikey=${apiKey}&venueId=${FENWAY_VENUE_ID}&classificationName=baseball&startDateTime=${startDate}&endDateTime=${endDate}&size=5`;

  let res = await fetch(url);

  // Retry once on 429 with backoff
  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get('retry-after') || '5', 10);
    const waitMs = Math.min(retryAfter * 1000, 30000);
    console.warn(`[Ticketmaster] Rate limited (429) for ${game.date} — waiting ${waitMs / 1000}s...`);
    await new Promise(r => setTimeout(r, waitMs));
    res = await fetch(url);
  }

  if (!res.ok) {
    if (res.status === 429) {
      console.warn(`[Ticketmaster] Still rate limited for ${game.date} — skipping`);
      return null;
    }
    console.warn(`[Ticketmaster] HTTP ${res.status} for ${game.date} — skipping`);
    return null;
  }

  const data = await res.json();
  const events = data._embedded?.events || [];

  if (events.length === 0) {
    console.log(`[Ticketmaster] No events found for ${game.date} vs ${game.opponent}`);
    return null;
  }

  // Take the first matching event
  const event = events[0];
  const listingUrl = event.url || null;
  const priceRanges = event.priceRanges || [];

  // MLB events often don't expose priceRanges through the Discovery API.
  // Still return the event data with the listing URL so the dashboard can link out.
  if (priceRanges.length === 0) {
    console.log(`[Ticketmaster] Event found for ${game.date} vs ${game.opponent} (no price data — link only)`);
    return {
      min_price: null,
      max_price: null,
      listing_url: listingUrl,
      source: 'primary',
    };
  }

  const minPrice = Math.min(...priceRanges.map(p => p.min));
  const maxPrice = Math.max(...priceRanges.map(p => p.max));

  return {
    min_price: minPrice,
    max_price: maxPrice,
    listing_url: listingUrl,
    source: 'primary',
  };
}
