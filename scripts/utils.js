import { readFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

/** Load .env file from repo root if it exists. */
function loadDotenv() {
  const envPath = resolve(ROOT, '.env');
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    // Don't override existing env vars (e.g. from GitHub Actions secrets)
    if (!process.env[key]) process.env[key] = val;
  }
}

/**
 * Load config.json and merge env var overrides (FENWAY_ prefix).
 */
export async function loadConfig() {
  loadDotenv();
  const raw = await readFile(resolve(ROOT, 'config.json'), 'utf-8');
  const config = JSON.parse(raw);

  const envOverrides = {
    FENWAY_MIN_QUANTITY: 'min_quantity',
    FENWAY_PRICE_ALERT_THRESHOLD: 'price_alert_threshold',
    FENWAY_CHECK_DAYS_AHEAD: 'check_days_ahead',
    FENWAY_WEATHER_FORECAST_WINDOW_DAYS: 'weather_forecast_window_days',
    FENWAY_VELOCITY_WINDOW_DAYS: 'velocity_window_days',
  };

  for (const [envKey, configKey] of Object.entries(envOverrides)) {
    if (process.env[envKey]) {
      const n = Number(process.env[envKey]);
      if (!isNaN(n)) config[configKey] = n;
    }
  }

  // Array overrides (comma-separated)
  if (process.env.FENWAY_PREFERRED_DAYS) {
    config.preferred_days = process.env.FENWAY_PREFERRED_DAYS.split(',').map(d => d.trim());
  }
  if (process.env.FENWAY_SECTIONS) {
    config.sections = process.env.FENWAY_SECTIONS.split(',').map(s => s.trim());
  }

  return config;
}

export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/** Format a Date as YYYY-MM-DD */
export function formatDate(date) {
  return date.toISOString().split('T')[0];
}

/** Ensure a directory exists, creating it recursively if needed. */
export async function ensureDir(dirPath) {
  await mkdir(dirPath, { recursive: true });
}

/** Resolve a path relative to the repo root. */
export function rootPath(...segments) {
  return resolve(ROOT, ...segments);
}

/** Day of week name from a YYYY-MM-DD string. */
export function dayOfWeek(dateStr) {
  // Anchor to UTC noon to avoid midnight-boundary timezone shifts
  const d = new Date(dateStr + 'T12:00:00Z');
  return d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/New_York' });
}
