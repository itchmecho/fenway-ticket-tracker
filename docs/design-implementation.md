# Dashboard Visual Redesign — Implementation Guide

Reference: [MLB Visualizer](https://itchmecho.github.io/mlb-visualizer/)

This document captures the design patterns from the MLB Visualizer and maps them onto the Fenway Ticket Tracker dashboard. The goal is visual parity with the reference site while keeping our vanilla HTML/CSS/JS stack (no React, no Tailwind, no build step).

---

## 1. Color System

### Current Palette (simple flat vars)
```css
--navy: #0d1f2d;
--red: #bd3039;
--white: #f0f0f0;
```

### Target: CSS Custom Property Token System

Adopt the MLB Visualizer's semantic token approach. We only need dark mode (our current theme), but structuring as tokens makes future light mode trivial.

```css
:root {
  /* Backgrounds */
  --color-bg-primary:    #0a0a0f;      /* page bg — near-black, not navy */
  --color-bg-secondary:  #12121a;      /* secondary surfaces */
  --color-bg-tertiary:   #1a1a28;      /* pill backgrounds, stat bar tracks */
  --color-bg-card:       #16161f;      /* card backgrounds */
  --color-bg-elevated:   #1e1e2a;      /* hover states, expanded sections */
  --color-bg-input:      #1a1a28;      /* form inputs, selects */

  /* Text */
  --color-text-primary:  #f8f9fa;      /* main text */
  --color-text-secondary: #adb5bd;     /* supporting text */
  --color-text-muted:    #949fb0;      /* labels, metadata — min 4.5:1 on card bg for WCAG AA */
  --color-text-inverse:  #1a1a2e;      /* text on accent buttons */

  /* Borders */
  --color-border:        #2d2d3a;      /* default borders */
  --color-border-light:  #252532;      /* subtle interior borders */

  /* Accent — Red Sox red, brightened for dark bg */
  --color-accent:        #ef4444;      /* primary accent (brighter red for dark mode) */
  --color-accent-hover:  #dc2626;      /* accent hover */
  --color-accent-soft:   #1f1315;      /* red tint background */

  /* Status */
  --color-green:         #22c55e;
  --color-green-monster: #006847;      /* Fenway Park Green Monster — use for "Primary/Face Value" badges */
  --color-amber:         #eab308;
  --color-orange:        #f97316;
}
```

**Key shift:** Move away from "navy" tones toward the MLB Visualizer's cooler near-black with slight blue-purple undertone (`#0a0a0f`, `#16161f`). This gives a more modern, OLED-friendly look.

**Migration note:** Replace every `var(--navy*)` / `var(--white*)` with the semantic token. Find-and-replace mapping:

| Old | New |
|-----|-----|
| `--navy` | `--color-bg-primary` |
| `--navy-light` | `--color-bg-card` |
| `--navy-mid` | `--color-bg-tertiary` |
| `--red` | `--color-accent` |
| `--red-glow` | `--color-accent` (same now) |
| `--white` | `--color-text-primary` |
| `--white-dim` | `--color-text-secondary` |
| `--green` | `--color-green` |
| `--green-dim` | `--color-green-monster` |
| `--amber` | `--color-amber` |

### Accessibility Notes

- **Muted text contrast:** `--color-text-muted` was bumped from `#6c757d` to `#949fb0` to meet WCAG AA (4.5:1) against `--color-bg-card`. The original value only hit 3.42:1.
- **Touch targets:** All interactive elements (filter pills, buy buttons, card tap areas) must maintain a minimum 44x44px hit area for mobile. Pad with `min-height: 44px` where needed.

---

## 2. Typography

### Current
Already using the correct fonts (`Bebas Neue` + `DM Sans`), which matches the reference exactly.

### Changes Needed

| Element | Current | Target |
|---------|---------|--------|
| Body font weights | 300, 400, 500, 600 | 400, 500, 600, 700 (drop 300, add 700) |
| Category headers (filter labels, source labels) | Inconsistent | `text-xs font-semibold tracking-[0.15em] uppercase` — standardise at `font-size: 11px; font-weight: 600; letter-spacing: 0.15em; text-transform: uppercase;` |
| Price numbers | `font-size: 32px` | Keep, already Bebas Neue display — add `font-variant-numeric: tabular-nums` for alignment |
| Small labels | Various 10-12px | Standardise muted labels at `11px` |

Update the Google Fonts import to include weight 700 and italic:
```html
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&display=swap" rel="stylesheet">
```

---

## 3. Layout & Spacing

### Max Width Container
```css
/* Add a content wrapper */
.content-wrap {
  max-width: 1280px;   /* max-w-7xl equivalent */
  margin: 0 auto;
  padding: 0 16px;
}

@media (min-width: 768px) {
  .content-wrap { padding: 0 24px; }
}
```

Currently the game list is capped at `600px`. For a single-column card list this is fine, but if we add a summary stats row or wider cards later, the `1280px` container gives room to grow. For now, cards can stay at `max-width: 640px; margin: 0 auto` within the wider container.

### Spacing Scale
The reference uses Tailwind's 4px base scale consistently. Map these to custom properties:

```css
--space-1: 4px;
--space-2: 8px;
--space-3: 12px;
--space-4: 16px;
--space-5: 20px;
--space-6: 24px;
--space-8: 32px;
```

---

## 4. Sticky Header with Backdrop Blur

### Current
Header is `position: relative` — scrolls away.

### Target
```css
header {
  position: sticky;
  top: 0;
  z-index: 40;
  background: rgba(10, 10, 15, 0.95);  /* bg-primary at 95% opacity */
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}
```

This gives the frosted-glass pinned header effect from the reference. The `0.95` opacity + blur lets content underneath bleed through subtly.

**Important:** Use a slightly transparent `border-bottom` (e.g. `rgba(255,255,255,0.1)`) rather than a solid token color — without it the frosted glass looks muddy against near-black backgrounds.

---

## 5. Navigation / Filter Bar

### Current
Horizontal scrolling pills with a `<select>` dropdown.

### Target: Pill Toggle Bar (MLB Visualizer style)

```css
.filters {
  display: flex;
  background: var(--color-bg-tertiary);
  border-radius: 8px;          /* rounded-lg */
  padding: 4px;                /* p-1 */
  border: 1px solid var(--color-border);
  gap: 4px;
}

.filter-pill {
  padding: 10px 16px;
  min-height: 44px;             /* WCAG touch target minimum */
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.filter-pill.active {
  background: var(--color-accent);
  color: var(--color-text-inverse);
  box-shadow: 0 1px 2px rgba(0,0,0,0.3);
}

.filter-pill:hover:not(.active) {
  background: var(--color-bg-elevated);
}
```

The sort `<select>` should also adopt the reference's custom-styled select:
```css
.sort-select {
  background: var(--color-bg-tertiary);
  border: 1px solid var(--color-border);
  color: var(--color-text-secondary);
  border-radius: 8px;
  padding: 8px 32px 8px 12px;
  appearance: none;
  background-image: url("data:image/svg+xml,...chevron...");
  background-repeat: no-repeat;
  background-position: right 10px center;
  background-size: 12px;
}
```

---

## 6. Card Redesign

### Current
Cards use `--navy-light` background, `12px` radius, subtle border.

### Target

```css
.game-card {
  background: var(--color-bg-card);
  border-radius: 16px;          /* rounded-2xl */
  border: 1px solid var(--color-border);
  overflow: hidden;
  transition: background-color 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease;
}

.game-card:hover {
  border-color: var(--color-border-light);
  box-shadow: 0 20px 25px rgba(0,0,0,0.5), 0 10px 10px rgba(0,0,0,0.3);
}
```

**Key differences from current:**
- Larger border radius (16px vs 12px)
- Explicit border color from token system
- Heavier shadow on hover (reference uses much more dramatic shadows in dark mode)
- Remove the `::after` pill indicator — the reference doesn't use one

### Date Block
Keep the existing date block design — it's already good and fits the reference's aesthetic. Adjust colors to new tokens:
```css
.date-block {
  background: var(--color-bg-primary);  /* was --navy */
  border-radius: 8px;
}
.date-block .month { color: var(--color-accent); }
```

### Price Block
The current design is solid. Apply the accent color glow treatment from the reference's percentile system:
```css
.game-card.has-deal .best-price {
  color: var(--color-accent);
  text-shadow: 0 0 24px rgba(239, 68, 68, 0.4);
}
```

### Opponent Team Accent

The MLB Visualizer gets a lot of visual mileage from team logos/colors. We can approximate this in vanilla CSS by adding a thin color bar to each card based on the opponent's primary color. This makes the card list far more scannable.

In `fetch.js` or a config file, maintain a map of opponent → primary hex:
```js
const TEAM_COLORS = {
  'New York Yankees': '#003087',
  'Toronto Blue Jays': '#134A8E',
  'Tampa Bay Rays': '#092C5C',
  'Baltimore Orioles': '#DF4601',
  // ... etc
};
```

Then render a 3px left-border accent on each card:
```css
.game-card {
  border-left: 3px solid var(--opponent-color, var(--color-border));
}
```
```html
<div class="game-card" style="--opponent-color: #003087">
```

This is a small touch that adds a ton of visual identity without requiring image assets.

---

## 7. Expanded Card Detail Section

### Current
Dark background (`--navy`), simple two-column price comparison grid.

### Target
```css
.card-detail {
  background: var(--color-bg-primary);
  border-top: 1px solid var(--color-border-light);
}

.price-source-card {
  background: var(--color-bg-card);
  border: 1px solid var(--color-border-light);
  border-radius: 12px;          /* rounded-xl, up from 8px */
  padding: 14px;
}
```

### Price Type Badges (Primary / Resale)
Adopt the reference's tinted-pill pattern:
```css
.source-type {
  display: inline-flex;
  align-items: center;
  padding: 3px 8px;
  border-radius: 9999px;        /* rounded-full pill */
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.type-primary {
  background: rgba(0, 104, 71, 0.18);
  color: var(--color-green-monster);   /* Fenway Green Monster green */
  border: 1px solid rgba(0, 104, 71, 0.35);
}

.type-resale {
  background: rgba(234, 179, 8, 0.13);
  color: var(--color-amber);
  border: 1px solid rgba(234, 179, 8, 0.25);
}
```

---

## 8. Badges

### Current
Simple colored rectangles with `4px` radius.

### Target: Rounded Pills with Tinted Backgrounds

```css
.badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border-radius: 9999px;        /* full pill */
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  border: 1px solid transparent;
}

.badge-deal {
  background: rgba(239, 68, 68, 0.15);
  color: var(--color-accent);
  border-color: rgba(239, 68, 68, 0.3);
}

.badge-falling {
  background: rgba(34, 197, 94, 0.15);
  color: var(--color-green);
  border-color: rgba(34, 197, 94, 0.3);
}

.badge-weekend {
  background: rgba(234, 179, 8, 0.15);
  color: var(--color-amber);
  border-color: rgba(234, 179, 8, 0.3);
}
```

This matches the reference's percentile chip / status badge pattern — tinted background at ~15% opacity, matching text color, subtle border at ~30% opacity.

---

## 9. Animations & Transitions

### Keep
- `cardIn` fade-up animation (already matches reference's `fade-in`)
- Loading dot bounce

### Add: Theme Transitions
```css
.theme-transition {
  transition: background-color 0.3s ease,
              border-color 0.3s ease,
              color 0.3s ease,
              box-shadow 0.3s ease;
}
```
Apply to cards, header, filter pills, and detail sections. This future-proofs for light/dark toggle.

### Add: Staggered Card Entrance
The reference staggers child animations by 50ms increments. We already do `animation-delay: ${index * 0.04}s` — bump to `0.05s` to match.

### Add: Velocity Bar Animation (if we add stat bars later)
```css
@keyframes grow-bar {
  from { width: 0%; }
}
.stat-bar-animated {
  animation: grow-bar 0.6s ease-out forwards;
}
```

---

## 10. Skeleton Loading States

### Current
Three bouncing dots.

### Target: Shimmer Skeleton Cards

Replace the dots with 3-4 placeholder card shapes that shimmer while loading.

```css
@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

.skeleton-card {
  background: var(--color-bg-card);
  border-radius: 16px;
  border: 1px solid var(--color-border);
  padding: 14px 16px;
  height: 80px;
  margin-bottom: 10px;
}

.skeleton-bar {
  height: 14px;
  border-radius: 4px;
  background: linear-gradient(
    90deg,
    var(--color-bg-tertiary) 25%,
    var(--color-bg-elevated) 50%,
    var(--color-bg-tertiary) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s ease-in-out infinite;
}
```

Loading HTML:
```html
<div class="skeleton-card">
  <div class="skeleton-bar" style="width: 30%; margin-bottom: 8px;"></div>
  <div class="skeleton-bar" style="width: 60%; margin-bottom: 6px;"></div>
  <div class="skeleton-bar" style="width: 40%;"></div>
</div>
<!-- repeat 3-4x -->
```

---

## 11. Buy Buttons

### Current
Flat colored buttons, full-width flex.

### Target
```css
.buy-link {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 11px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
  transition: all 0.2s ease;
}

.buy-link-tm {
  background: var(--color-accent);
  color: var(--color-text-inverse);
}
.buy-link-tm:hover {
  background: var(--color-accent-hover);
}

.buy-link-sg {
  background: var(--color-bg-tertiary);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border);
}
.buy-link-sg:hover {
  background: var(--color-bg-elevated);
}
```

---

## 12. Custom Scrollbar

Add the reference's scrollbar styling:
```css
::-webkit-scrollbar {
  width: 8px;
}
::-webkit-scrollbar-track {
  background: var(--color-bg-tertiary);
}
::-webkit-scrollbar-thumb {
  background: var(--color-text-muted);
  border-radius: 4px;
}
::-webkit-scrollbar-thumb:hover {
  background: var(--color-text-secondary);
}
```

---

## 13. Background Texture

### Current
Radial gradient red glows on `body::before`.

### Target
Keep the concept but tone it down to match the reference's subtler dark aesthetic:
```css
body::before {
  content: '';
  position: fixed;
  inset: 0;
  background:
    radial-gradient(ellipse at 20% 0%, rgba(239,68,68,0.025) 0%, transparent 50%),
    radial-gradient(ellipse at 80% 100%, rgba(239,68,68,0.015) 0%, transparent 40%);
  pointer-events: none;
  z-index: 0;
}
```

The reference doesn't use background gradients at all — it's pure flat dark. Keep the Red Sox red glow as a brand touch but make it barely perceptible — opacity should stay under `0.03`. If it's noticeable on an OLED screen, it's too strong.

---

## 14. Velocity Row

### Current
Simple row with arrow + text.

### Target: Stat Bar Treatment
Upgrade the velocity display to use the reference's horizontal stat bar pattern. A "stat bar" for price velocity is the most baseball-native way to visualise this data — it should feel like a scouting percentile chart.

```css
.velocity-row {
  background: var(--color-bg-card);
  border: 1px solid var(--color-border-light);
  border-radius: 12px;
  padding: 12px 14px;
}

.velocity-bar-track {
  height: 28px;
  background: var(--color-bg-tertiary);
  border-radius: 4px;
  position: relative;
  overflow: hidden;
}

.velocity-bar-fill {
  height: 100%;
  border-radius: 4px;
  animation: grow-bar 0.6s ease-out forwards;
}

/* Center line (represents 0% change) */
.velocity-bar-center {
  position: absolute;
  left: 50%;
  top: 0;
  bottom: 0;
  width: 1px;
  border-left: 1px dashed var(--color-text-muted);
  z-index: 1;
}
```

Use the `grow-bar` animation (Section 9) to animate the fill when the card expands — it makes the data feel alive.

---

## 15. Font Smoothing & Scrollbar

Already have `-webkit-font-smoothing: antialiased` — matches reference.

Add smooth scrolling:
```css
html {
  scroll-behavior: smooth;
}
```

---

## 16. Weather Badge Prominence

Fenway is an outdoor park — weather directly impacts ticket prices. Rain forecasts should be more visually prominent than a plain text tag.

### Current
```html
<span class="weather-tag">🌧 58°</span>
```
Just muted text inline with other metadata.

### Target
Add a weather-specific badge style for bad weather conditions:
```css
.badge-weather-rain {
  background: rgba(59, 130, 246, 0.15);
  color: #60a5fa;
  border: 1px solid rgba(59, 130, 246, 0.3);
}

.badge-weather-cold {
  background: rgba(147, 197, 253, 0.12);
  color: #93c5fd;
  border: 1px solid rgba(147, 197, 253, 0.25);
}
```

Promote rain/snow forecasts from the `.game-meta` row into the `.badges` row so they sit alongside "Deal" and "Weekend" badges. Clear/sunny weather stays as a subtle inline tag.

---

## 17. Fenway-Specific Design Touches

These are unique to a Red Sox tracker and differentiate us from generic ticket apps:

1. **Green Monster green for face-value tickets** — Already covered in Section 7. The `#006847` hex is iconic and instantly signals "primary/Fenway" to Sox fans.

2. **Opponent team color bars** — Already covered in Section 6. Thin left-border accent per card using opponent's primary color.

3. **Rivalry badges** — Yankees, Dodgers, and other marquee opponents could get a special badge treatment (e.g., "Rivalry" badge in a distinct color) since those games have significantly different pricing dynamics.

4. **Font choices already nailed** — Bebas Neue + DM Sans is the exact combo the MLB Visualizer uses. Bebas Neue in particular has a very "ballpark scoreboard" feel that fits perfectly.

---

## Summary: Implementation Order

1. **Token swap** — Replace all color vars with semantic tokens (pure CSS, zero risk, audits every line)
2. **Sticky header + backdrop blur** — Small CSS change, big visual impact
3. **Card styling** — Border radius, border color, shadow, hover states
4. **Opponent color bars** — Add team color map + left-border accent (JS + CSS)
5. **Filter bar** — Pill toggle container style with 44px touch targets
6. **Badges** — Tinted pill treatment (deal, falling, weekend, weather, rivalry)
7. **Typography cleanup** — Standardise label sizes, add tabular-nums
8. **Expanded detail** — Card borders, Green Monster green for primary badges
9. **Velocity stat bar** — Replace text with animated horizontal bar
10. **Skeleton loading** — Replace dots with shimmer cards
11. **Weather badge prominence** — Promote rain/cold into badge row
12. **Scrollbar + smooth scroll** — Polish
13. **Background texture** — Reduce glow to < 0.03 opacity

Each step is independent and can be done as a single commit. Steps 1-3, 5-8, 10, 12-13 are CSS-only. Steps 4, 9, 11 require minor JS changes.
