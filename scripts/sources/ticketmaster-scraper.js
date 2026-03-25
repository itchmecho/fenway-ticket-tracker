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

    // Process in batches of 10 with a pause between batches
    const BATCH_SIZE = 10;
    for (let i = 0; i < eventIds.length; i += BATCH_SIZE) {
      const batch = eventIds.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(eventIds.length / BATCH_SIZE);

      if (totalBatches > 1) {
        console.log(`[TM-Scraper] Batch ${batchNum}/${totalBatches} (${batch.length} events)`);
      }

      for (const { game_id, tm_event_id } of batch) {
        try {
          const data = await scrapeEventPage(tm_event_id);
          if (data) {
            results.set(game_id, data);
          }
        } catch (err) {
          console.warn(`[TM-Scraper] Error on ${tm_event_id}: ${err.message}`);
        }
      }

      // Pause between batches to avoid bot detection
      if (i + BATCH_SIZE < eventIds.length) {
        console.log(`[TM-Scraper] Pausing 10s between batches...`);
        await new Promise(r => setTimeout(r, 10000));
        // Fresh browser context for next batch
        if (_context) await _context.close();
        _context = await _browser.newContext({
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        });
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

  // Listen for both the pricing facets and section-level facets responses
  let priceResult = null;
  let sectionResult = null;

  const pricingPromise = new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), 40000);

    page.on('response', async (res) => {
      const url = res.url();
      if (!url.includes(tmEventId) || !url.includes('facets') || res.status() !== 200) return;

      try {
        // Pricing facets (offeradapter, has listpricerange + inventorytypes)
        if (url.includes('offeradapter.ticketmaster.com') &&
            url.includes('listpricerange') &&
            url.includes('inventorytypes')) {
          const data = await res.json();
          priceResult = parseFacets(data);
          if (priceResult && sectionResult) { clearTimeout(timeout); resolve(true); }
          else if (priceResult) { setTimeout(() => resolve(true), 5000); } // give sections 5s to arrive
        }

        // Section-level facets (services.ticketmaster.com, has section + offer + area)
        if (url.includes('services.ticketmaster.com') &&
            url.includes('section') &&
            url.includes('offer')) {
          const data = await res.json();
          sectionResult = parseSections(data);
          if (priceResult) { clearTimeout(timeout); resolve(true); }
        }
      } catch {}
    });
  });

  try {
    const url = `https://www.ticketmaster.com/event/${tmEventId}`;
    // Don't wait for full networkidle — just wait for the pricing response
    page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await pricingPromise;

    if (priceResult) {
      // Merge section data into price result
      if (sectionResult && sectionResult.length > 0) {
        priceResult.sections = sectionResult;
      }
      priceData = priceResult;
      const secCount = sectionResult?.length || 0;
      console.log(`[TM-Scraper] ${tmEventId}: $${priceData.min_price} - $${priceData.max_price} (${priceData.total_listings} listings, ${secCount} sections)`);
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

// Target section prefixes at Fenway — only keep sections we care about
const SECTION_FILTERS = [
  { prefix: 'F', group: 'Field Box' },
  { prefix: 'AC', group: 'Aura Club' },
  { prefix: 'AP', group: 'Aura Pavilion' },
  { prefix: 'AURA', group: 'Aura Pavilion' },
  { prefix: 'HCB', group: 'Home Club Box' },
  { prefix: 'PB', group: 'Pavilion Box' },
  { prefix: 'PC', group: 'Pavilion Club' },
  { prefix: 'DTC', group: 'Dugout Club' },
];

function classifySection(name) {
  const upper = name.toUpperCase();
  // Check longest prefixes first to avoid false matches (e.g. "F" matching "FB" before "FB" is checked)
  for (const { prefix, group } of SECTION_FILTERS.sort((a, b) => b.prefix.length - a.prefix.length)) {
    if (upper.startsWith(prefix)) return group;
  }
  return null;
}

/**
 * Parse the section-level facets response from services.ticketmaster.com.
 * Filters to target sections only (Field Box, Aura, Club, Pavilion).
 */
function parseSections(data) {
  const facets = data.facets || [];
  if (facets.length === 0) return null;

  // Aggregate by section name, filtering to target sections
  const sectionMap = new Map();
  for (const facet of facets) {
    const section = facet.section;
    if (!section) continue;

    const group = classifySection(section);
    if (!group) continue; // Skip sections we don't care about

    const existing = sectionMap.get(section);
    const count = facet.count || 0;
    if (existing) {
      existing.count += count;
      existing.rows.add(facet.row || '?');
    } else {
      sectionMap.set(section, {
        group,
        count,
        rows: new Set([facet.row || '?']),
      });
    }
  }

  if (sectionMap.size === 0) return null;

  const sections = [];
  for (const [name, info] of sectionMap) {
    sections.push({ name, group: info.group, listings: info.count, rows: [...info.rows].sort() });
  }
  sections.sort((a, b) => b.listings - a.listings);
  return sections;
}

async function cleanup() {
  if (_browser) {
    try { await _browser.close(); } catch {}
    _browser = null;
    _context = null;
  }
}
