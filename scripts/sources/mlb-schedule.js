import { writeFile } from 'node:fs/promises';
import { rootPath, dayOfWeek } from '../utils.js';

const BASE_URL = 'https://statsapi.mlb.com/api/v1';
const RED_SOX_TEAM_ID = 111;

/**
 * Fetch the Red Sox home schedule from the MLB Stats API.
 * Caches result to data/schedule.json.
 * Returns an array of home game objects.
 */
export async function fetchSchedule() {
  const season = new Date().getFullYear();
  const url = `${BASE_URL}/schedule?sportId=1&teamId=${RED_SOX_TEAM_ID}&gameType=R&season=${season}`;

  console.log(`[MLB] Fetching ${season} Red Sox schedule...`);
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });

  if (!res.ok) {
    throw new Error(`[MLB] Schedule fetch failed: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  const homeGames = [];

  for (const dateEntry of data.dates || []) {
    for (const game of dateEntry.games || []) {
      // Only home games (Red Sox as home team)
      if (game.teams?.home?.team?.id !== RED_SOX_TEAM_ID) continue;

      const gameDate = dateEntry.date; // YYYY-MM-DD
      const opponent = game.teams?.away?.team?.name || 'TBD';
      const gameId = `mlb-${game.gamePk}`;

      homeGames.push({
        game_id: gameId,
        date: gameDate,
        day_of_week: dayOfWeek(gameDate),
        opponent,
      });
    }
  }

  // Sort by date
  homeGames.sort((a, b) => a.date.localeCompare(b.date));

  // Cache to disk
  const schedulePath = rootPath('data', 'schedule.json');
  await writeFile(schedulePath, JSON.stringify(homeGames, null, 2));
  console.log(`[MLB] Found ${homeGames.length} home games, cached to data/schedule.json`);

  return homeGames;
}
