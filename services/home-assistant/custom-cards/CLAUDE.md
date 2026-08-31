# Custom Lovelace Cards — Steering Notes

Read this before touching any file in this directory, or before building a
new custom card for this Home Assistant instance. It captures hard-won
lessons from building `energy-cost-card.js` — mistakes already made once,
not to repeat.

## Architecture pattern: no helper entities

Group/Utility Meter helper entities were tried first and rejected for three
reasons, in this order of discovery:

1. They have no history — a Utility Meter's cumulative state only exists
   from the moment it's created forward.
2. Not reactive — a fixed source → cycle → sum pipeline baked in at
   creation time. A different grouping means a new helper, not a config
   change.
3. They don't participate in the Energy dashboard's date-picker — they're
   just regular entities with their own state history, disconnected from
   whatever range `energy-date-selection` has selected.

The replacement pattern, used by every card in this directory: **discover
what to chart dynamically from HA's own Energy APIs, and share the native
date-picker's live data instead of re-querying independently.**

## Discovering entity/stat IDs: never hardcode them

Two WS commands matter here, and they are **not interchangeable**:

- `energy/get_prefs` → `energy_sources[].stat_cost` — only populated when a
  source points **directly** at a pre-existing cost-tracking entity.
- `energy/info` → `cost_sensors: Record<consumption_stat_id, cost_stat_id>`
  — this is where the auto-generated cost stat shows up when cost is
  derived from a price entity or static price (the tariff setup here uses
  a price entity, `sensor.tshwane_marginal_rate`).

Getting this wrong silently returns zero results with no error — always
check both:

```js
const info = await hass.callWS({ type: "energy/info" });
const costStatId = source.stat_cost || info.cost_sensors[source.stat_energy_from];
```

Do this for whatever `energy_sources`/`device_consumption` entries are
relevant to the new card — never hardcode an entity_id. Add/remove a
source in Energy settings and the card's inputs should change with it,
zero code edits.

## Sharing the native date-picker (not re-implementing one)

`energy-date-selection` doesn't write its selection to any entity — it
mutates an in-memory object cached directly on `hass.connection`, keyed by
a string every energy-\* card (native or custom) derives the same way:

```js
function collectionKey(hass, configuredKey) {
  if (configuredKey) return `_${configuredKey}`;
  if (hass.panelUrl) return `_energy_${hass.panelUrl}`;
  return "_energy";
}
```

`hass.connection[key]` is the literal same collection object
`energy-date-selection` drives — attach with `.subscribe((data) => ...)`
and every future update (including date-range changes) arrives for free.
`data.stats` is keyed by stat_id, `data.prefs` is the same object
`energy/get_prefs` returns, and **`data.start`/`data.end` are the exact
boundaries of whatever period is currently selected** — use these, don't
compute "is this today or this month" yourself.

**Requirement, not optional**: a card built this way does nothing useful
without an `energy-date-selection` card on the same dashboard view. If
`hass.connection[key]` isn't populated yet, show a waiting message and
retry on the next `hass` update — don't build a fallback collection.

## Rendering: hand-rolled SVG, matched against real ha-chart-base source

No charting library is used (deliberately dependency-free, see the
duplication note at the bottom). Verified against actual
`ha-chart-base.ts`/ECharts source rather than guessed — a few of these
were *wrong guesses corrected later*, so don't re-guess:

- Font: literal `Roboto, Noto, sans-serif` — HA hardcodes this, there is
  no CSS variable for it.
- Axis label size: `var(--ha-font-size-s, 12px)`, color `--primary-text-color`.
- Gridlines: **solid**, `--divider-color`. Not dashed — an earlier version
  of this dashed them, guessing wrong.
- Hover/crosshair color: `--info-color`, not `--primary-color` or
  `--secondary-text-color`.
- Y-axis headroom: use a real "nice numbers" axis algorithm (round the max
  up to a clean 1/2/5/10 × 10ⁿ step — see `_niceNumber`/`_niceAxisScale` in
  `energy-cost-card.js`), not a flat percentage pad. A flat 15% pad was
  tried first and produced a top value roughly double the actual data max.
- X-axis label clipping: anchor the first/last tick `start`/`end` instead
  of `middle`, or they clip past the viewBox edges.

**SVG stretch distortion (the big one)**: `preserveAspectRatio="none"`
with a fixed viewBox width, rendered into a `width: 100%` container,
stretches X and Y **independently** — this doesn't just distort lines, it
distorts text glyphs too (they read as squashed/short). Fix: measure the
container's real `clientWidth`/`clientHeight` via `ResizeObserver` and use
those as the viewBox dimensions directly, so the coordinate system is 1:1
with CSS pixels on both axes. This is the structural equivalent of what
ECharts does on canvas (`chart.resize()` re-measures and redraws from
scratch on every resize) — same principle, ported to SVG. Debounce the
observer callback through `requestAnimationFrame` so a continuous
drag-resize doesn't re-render on every tick.

**Sections-view vs. masonry-view height (the other big one)**:
`ha-chart-base`'s own default-height convention
(`Math.max(clientWidth / 2, 200)`) assumes masonry view, where a card's
actual rendered height *is* the layout — the column just flows around it.
Sections view works the opposite way: `grid_rows` reserves a fixed-height
box up front, and content taller than that box **clips**, it doesn't grow
the box. A card meant for Sections-view dashboards should fill whatever
height its container is actually given (flex column, `flex: 1;
min-height: 0` on the chart container, read `clientHeight` — see the CSS
and `_renderChart` in `energy-cost-card.js`), falling back to the
width-based formula only when no real height is available yet.

## Number formatting gotchas

- `Intl.NumberFormat`'s `currency` style prints the ISO code ("ZAR") not a
  plain symbol ("R") unless the active locale has that currency's
  localized formatting baked in — not reliable across installs/languages.
  Format the number only and prefix a configurable plain symbol instead.
- Compact notation (`notation: "compact"`) with `maximumFractionDigits: 0`
  collapses distinct values into the same label — 1500 and 2000 both
  print as "2K". Allow 1 fraction digit, but only force it at/above 1000
  (compact notation doesn't apply a K/M suffix below that, so forcing a
  decimal there just adds a pointless ".0").

## Deploy model — deliberately manual, not bind-mounted

Source lives in this repo (`custom-cards/*.js`), tracked and PR-reviewed
like everything else here. Deploying a change is **one manual copy**, not
a bind mount into the container:

```bash
cp services/home-assistant/custom-cards/<file>.js \
   /DATA/AppData/home-assistant/config/www/custom-cards/<file>.js
```

Considered and rejected: bind-mounting the repo checkout straight into
`/config/www/custom-cards`. The convenience (no copy step) wasn't worth
permanently coupling the container to two different storage roots (repo
checkout vs. AppData) for a file that changes rarely — same call already
made for the LuxPower integration elsewhere in this service.

**Caching**: a plain hard refresh is often not enough — HA's frontend
Service Worker can serve a stale cached copy regardless. Bump the
registered Lovelace resource URL's `?v=N` query param on every deploy
(Settings → Dashboards → Resources), not just on the first install.

## Git workflow while a card is unverified

Branch (`feature/<name>`), then **check that branch out on the server**
(`git fetch && git checkout feature/<name>`) and iterate there — don't
merge to `main` until it's actually confirmed working against the live
instance. `main` is meant to always be deployable; an untested card
doesn't belong there yet. Flip the server back to `main` once merged.

## Minimizing duplication across multiple cards (planned, not yet done)

As of this writing there's only one card, so there's nothing to share
yet. The next card is expected to duplicate real, generic logic from this
one: the SVG rendering engine (scaling, gridlines, resize handling,
hover/tooltip), the nice-numbers axis algorithm, time formatting, and the
collection-attachment logic. Card-specific logic (which stat IDs to
discover, how to combine them, and value formatting) should stay
per-card.

**The trigger for splitting this out is the start of the second card, not
before.** Multi-file source without a bundler was evaluated and rejected
for the *single*-card case (splitting one file's *internal* organization)
specifically because every imported sibling file becomes its own
cache-busting problem — only the top-level registered resource URL gets a
`?v=N`; a bare `import './sibling.js'` has no version of its own, and the
browser caches on the exact specifier text. That same problem applies
just as much to a shared utility file imported by *two* cards. Confirmed
via the actual `rollup.config.js` of mini-graph-card, apexcharts-card, and
button-card: all three split source into many files during development,
but all three ship a single bundled output file — none serve multi-file
source straight to the browser.

So: when the second card starts, add a minimal bundler (esbuild,
zero-config, one install + one build script) up front, extract
`lib/svg-chart.js`, `lib/nice-axis.js`, and `lib/energy-collection.js` as
real shared source, and have each card compile to its own single
deployable bundle. That keeps the per-card deploy/caching model exactly
as simple as it is today (one file, one `?v=N`) while actually sharing
the generic code.

## Reference implementation

`energy-cost-card.js` is the canonical example of every pattern above —
when in doubt, read it before re-deriving something from scratch.
