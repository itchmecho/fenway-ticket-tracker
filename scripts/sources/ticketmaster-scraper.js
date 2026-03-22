/**
 * Ticketmaster price scraper via Playwright.
 * Loads each event page and intercepts the internal pricing API response.
 * CORS prevents cross-event API calls, so each game needs its own page load.
 *
 * Called once with all games (batch source). Falls back gracefully if
 * Playwright isn't installed or the browser can't launch.
 */

let _browser = null;
let _context = null;

/**
 * Scrape Ticketmaster pricing for a list of games.
 * @param {Array} eventIds - array of { game_id, tm_event_id } mappings
 * @returns {Map<game_id, priceData>}
 */
export async function scrapeTmPrices(eventIds) {
  if (eventIds.length === 0) return new Map();

  let chromium;
  try {
    const pw = await import('playwright');
    chromium = pw.chromium;
  } catch {
    console.log('[TM-Scraper] Playwright not available — skipping price scraper');
    return new Map();
  }

  const results = new Map();

  try {
    console.log(`[TM-Scraper] Launching browser for ${eventIds.length} events...`);
    _browser = await chromium.launch({ headless: true });
    _context = await _browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });

    for (const { game_id, tm_event_id } of eventIds) {
      try {
        const data = await scrapeEventPage(tm_event_id);
        if (data) {
          results.set(game_id, data);
        }
      } catch (err) {
        console.warn(`[TM-Scraper] Error on ${tm_event_id}: ${err.message}`);
      }
    }

    console.log(`[TM-Scraper] Got pricing for ${results.size}/${eventIds.length} events`);
  } finally {
    await cleanup();
  }

  return results;
}

/**
 * Load a single TM event page and intercept the pricing API response.
 */
async function scrapeEventPage(tmEventId) {
  const page = await _context.newPage();
  let priceData = null;

  // Listen for the facets response that contains pricing
  const pricingPromise = new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), 40000);

    page.on('response', async (res) => {
      const url = res.url();
      // Match the facets endpoint that returns listpricerange
      if (url.includes('offeradapter.ticketmaster.com') &&
          url.includes(tmEventId) &&
          url.includes('facets') &&
          url.includes('listpricerange') &&
          url.includes('inventorytypes') &&
          res.status() === 200) {
        try {
          const data = await res.json();
          const parsed = parseFacets(data);
          if (parsed) {
            clearTimeout(timeout);
            resolve(parsed);
          }
        } catch {}
      }
    });
  });

  try {
    const url = `https://www.ticketmaster.com/event/${tmEventId}`;
    // Don't wait for full networkidle — just wait for the pricing response
    page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    priceData = await pricingPromise;

    if (priceData) {
      console.log(`[TM-Scraper] ${tmEventId}: $${priceData.min_price} - $${priceData.max_price} (${priceData.total_listings} listings)`);
    } else {
      console.log(`[TM-Scraper] ${tmEventId}: no pricing response intercepted`);
    }
  } finally {
    await page.close();
  }

  return priceData;
}

function parseFacets(data) {
  const facets = data.facets || [];
  if (facets.length === 0) return null;

  let overallMin = Infinity;
  let overallMax = 0;
  let totalListings = 0;
  const inventoryTypes = new Set();
  const sectionMap = new Map(); // section name -> { min, max, count }

  for (const facet of facets) {
    for (const t of facet.inventoryTypes || []) inventoryTypes.add(t);
    totalListings += facet.count || 0;

    let facetMin = Infinity;
    let facetMax = 0;
    for (const pr of facet.listPriceRange || []) {
      if (pr.min < facetMin) facetMin = pr.min;
      if (pr.max > facetMax) facetMax = pr.max;
      if (pr.min < overallMin) overallMin = pr.min;
      if (pr.max > overallMax) overallMax = pr.max;
    }

    // Extract section name from facet (TM uses various field names)
    const sectionName = facet.section || facet.sectionName || facet.name || null;
    if (sectionName && facetMin !== Infinity) {
      const existing = sectionMap.get(sectionName);
      if (existing) {
        existing.min = Math.min(existing.min, facetMin);
        existing.max = Math.max(existing.max, facetMax);
        existing.count += facet.count || 0;
      } else {
        sectionMap.set(sectionName, {
          min: facetMin,
          max: facetMax,
          count: facet.count || 0,
        });
      }
    }
  }

  if (overallMin === Infinity) return null;

  // Convert section map to sorted array
  const sections = [];
  for (const [name, data] of sectionMap) {
    sections.push({ name, min_price: data.min, max_price: data.max, listings: data.count });
  }
  sections.sort((a, b) => a.min_price - b.min_price);

  const result = {
    min_price: overallMin,
    max_price: overallMax,
    total_listings: totalListings,
    inventory_types: [...inventoryTypes],
    source: 'ticketmaster_scraped',
  };

  // Only include sections array if we found section data
  if (sections.length > 0) {
    result.sections = sections;
  }

  return result;
}

async function cleanup() {
  if (_browser) {
    try { await _browser.close(); } catch {}
    _browser = null;
    _context = null;
  }
}
