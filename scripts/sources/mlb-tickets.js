/**
 * MLB ticketing-client.com API — primary market ticket links + sold-out detection.
 * Free, no auth required. Called once with all games (batch source).
 */

const BASE_URL = 'https://www.ticketing-client.com/ticketing-client/json/EventTicketPromotion.tiksrv';
const RED_SOX_TEAM_ID = '111';

/**
 * Fetch primary market ticket links and sold-out status for Red Sox home games.
 * Returns a Map<schedule_id, { primary_url, sold_out }>.
 */
export async function fetchMlbTickets() {
  const year = new Date().getFullYear();
  const url = `${BASE_URL}?ticket_category=Tickets&team_id=${RED_SOX_TEAM_ID}&home_team_id=${RED_SOX_TEAM_ID}&recSP=1&site_section=Default&offer_group=SGTPG&price_group=Dynamic&begin_date=${year}0101&end_date=${year}1231&grouping_name=Default&display_if_past=false&leave_empty_games=false`;

  console.log('[MLB-Tickets] Fetching primary market ticket links...');

  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  } catch (err) {
    console.warn(`[MLB-Tickets] Request failed: ${err.message} — skipping`);
    return new Map();
  }
  if (!res.ok) {
    console.warn(`[MLB-Tickets] HTTP ${res.status} — skipping`);
    return new Map();
  }

  const data = await res.json();
  const games = data.events?.game || [];
  const map = new Map();

  for (const game of games) {
    const scheduleId = game.schedule_id;
    if (!scheduleId) continue;

    const tlink = game.ticket_link?.tlink || null;
    const soldOut = tlink ? tlink.includes('sold-out') : false;

    map.set(scheduleId, {
      primary_url: soldOut ? null : tlink,
      sold_out: soldOut,
    });
  }

  const soldOutCount = [...map.values()].filter(v => v.sold_out).length;
  console.log(`[MLB-Tickets] ${map.size} games, ${soldOutCount} sold out on primary market`);

  return map;
}
