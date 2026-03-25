
const BASE_URL = 'https://api.open-meteo.com/v1/forecast';
const FENWAY_LAT = 42.3467;
const FENWAY_LON = -71.0972;

/** WMO weather code lookup table. */
const WMO_CODES = {
  0:  { condition: 'Clear sky',            emoji: '☀️' },
  1:  { condition: 'Mainly clear',         emoji: '🌤️' },
  2:  { condition: 'Partly cloudy',        emoji: '⛅' },
  3:  { condition: 'Overcast',             emoji: '☁️' },
  45: { condition: 'Foggy',                emoji: '🌫️' },
  48: { condition: 'Depositing rime fog',  emoji: '🌫️' },
  51: { condition: 'Light drizzle',        emoji: '🌦️' },
  53: { condition: 'Moderate drizzle',     emoji: '🌦️' },
  55: { condition: 'Dense drizzle',        emoji: '🌧️' },
  61: { condition: 'Slight rain',          emoji: '🌧️' },
  63: { condition: 'Moderate rain',        emoji: '🌧️' },
  65: { condition: 'Heavy rain',           emoji: '🌧️' },
  66: { condition: 'Light freezing rain',  emoji: '🌨️' },
  67: { condition: 'Heavy freezing rain',  emoji: '🌨️' },
  71: { condition: 'Slight snow',          emoji: '🌨️' },
  73: { condition: 'Moderate snow',        emoji: '❄️' },
  75: { condition: 'Heavy snow',           emoji: '❄️' },
  77: { condition: 'Snow grains',          emoji: '❄️' },
  80: { condition: 'Slight rain showers',  emoji: '🌦️' },
  81: { condition: 'Moderate rain showers',emoji: '🌧️' },
  82: { condition: 'Violent rain showers', emoji: '⛈️' },
  85: { condition: 'Slight snow showers',  emoji: '🌨️' },
  86: { condition: 'Heavy snow showers',   emoji: '❄️' },
  95: { condition: 'Thunderstorm',         emoji: '⛈️' },
  96: { condition: 'Thunderstorm w/ hail', emoji: '⛈️' },
  99: { condition: 'Thunderstorm w/ heavy hail', emoji: '⛈️' },
};

function celsiusToFahrenheit(c) {
  return Math.round(c * 9 / 5 + 32);
}

function mmToInches(mm) {
  return Math.round(mm / 25.4 * 100) / 100;
}

function decodeWeatherCode(code) {
  return WMO_CODES[code] || { condition: 'Unknown', emoji: '❓' };
}

/**
 * Fetch weather forecasts for a list of games.
 * Only fetches for games within the forecast window.
 * Returns a Map<game_date, weatherData>.
 */
export async function fetchWeather(games, config) {
  const windowDays = config.weather_forecast_window_days || 14;
  // Use string comparison on YYYY-MM-DD dates (consistent with fetch.js)
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const cutoffDate = new Date(now);
  cutoffDate.setDate(cutoffDate.getDate() + windowDays);
  const cutoffStr = cutoffDate.toISOString().split('T')[0];

  const forecastGames = games.filter(g => g.date >= todayStr && g.date <= cutoffStr);

  const weatherMap = new Map();

  if (forecastGames.length === 0) {
    console.log('[Weather] No games within forecast window — skipping');
    return weatherMap;
  }

  // Open-Meteo supports date range queries — batch all dates in one call
  const dates = forecastGames.map(g => g.date);
  const startDate = dates[0];
  const endDate = dates[dates.length - 1];

  const url = `${BASE_URL}?latitude=${FENWAY_LAT}&longitude=${FENWAY_LON}&daily=temperature_2m_max,precipitation_sum,weathercode&timezone=America/New_York&start_date=${startDate}&end_date=${endDate}`;

  console.log(`[Weather] Fetching forecast for ${dates.length} games (${startDate} to ${endDate})...`);

  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  } catch (err) {
    console.warn(`[Weather] Request failed: ${err.message} — skipping weather data`);
    return weatherMap;
  }

  if (!res.ok) {
    console.warn(`[Weather] HTTP ${res.status} — skipping weather data`);
    return weatherMap;
  }

  const data = await res.json();
  const daily = data.daily || {};
  const responseDates = daily.time || [];
  const temps = daily.temperature_2m_max || [];
  const precip = daily.precipitation_sum || [];
  const codes = daily.weathercode || [];

  // Index the API response by date for fast lookup
  const dateIndex = new Map();
  for (let i = 0; i < responseDates.length; i++) {
    dateIndex.set(responseDates[i], i);
  }

  // Map forecast data to each game date
  for (const gameDate of dates) {
    const idx = dateIndex.get(gameDate);
    if (idx === undefined) continue;

    const decoded = decodeWeatherCode(codes[idx]);
    weatherMap.set(gameDate, {
      high_temp_f: celsiusToFahrenheit(temps[idx]),
      precipitation_in: mmToInches(precip[idx]),
      condition: decoded.condition,
      emoji: decoded.emoji,
      forecast_available: true,
    });
  }

  console.log(`[Weather] Got forecasts for ${weatherMap.size} game dates`);
  return weatherMap;
}
