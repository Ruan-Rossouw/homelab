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

Source lives in this repo (`custom-cards/src/`), tracked and PR-reviewed
like everything else here, and compiles to the top-level `custom-cards/
<file>.js` (see "Minimizing duplication" for the build step — run it and
commit the regenerated file before deploying). Deploying a change is
**one manual copy** of that generated file, not a bind mount into the
container:

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
(Settings → Dashboards → Resources), not just on the first install —
**to a number that resource URL has never been requested with before**,
not just one different from whatever's currently registered. A typo that
reuses an already-fetched number is indistinguishable from a fresh bump
to the browser and silently serves the old cached file with no error
anywhere — this cost a full round of "is it a browser bug?" debugging
(wrong axis math, missing projection line, distorted sizing — all
symptoms of a stale bundle, none of them real) before the actual cause
(a mistyped version number) turned up. When a deploy looks broken in a
way the code can't explain, check this before anything else: open the
resource's URL directly in a new tab and search the raw source for a
distinctive function name from the change you just made — if it's not
there, you're not looking at the file you think you are, and no
in-dashboard debugging will explain the symptoms. Unregistering the
Service Worker (browser devtools → Application/Storage → Service
Workers) and even fully restarting the browser does **not** clear this —
a Service Worker's Cache Storage persists independently of the browser
process, so only a real cache-clear (Firefox: `about:serviceworkers` to
unregister *and* Settings → Privacy → "Manage Data" → remove the site's
data; Chrome: DevTools → Application → Clear storage) or a genuinely new
`?v=N` fixes it. Different browsers/devices can disagree (one showing
current, another stale) purely because only some of them ever cached the
bad URL — that split is itself a signal it's caching, not a real
cross-browser rendering bug.

## Git workflow while a card is unverified

Branch (`feature/<name>`), then **check that branch out on the server**
(`git fetch && git checkout feature/<name>`) and iterate there — don't
merge to `main` until it's actually confirmed working against the live
instance. `main` is meant to always be deployable; an untested card
doesn't belong there yet. Flip the server back to `main` once merged.

## Minimizing duplication across multiple cards (done)

Done when `energy-cost-breakdown-card.js` was added as the second card —
per the plan below, written when it was still just a plan. The prediction
about *which* logic was generic held up almost exactly; one real surprise
turned up once the actual diff was in front of us: both cards' per-bucket
delta-summing loop (`deltaByBucketStart`/`costByBucketStart` — walk every
cost stat's points, skip `change == null`, accumulate by `point.start`)
was byte-identical too, not just the `energy/get_prefs`/`energy/info`
discovery call before it. That moved into `lib/energy-cost-sources.js`
alongside discovery; only the cumulative-running-total-vs-standalone-bars
step after it stayed per-card.

**Layout**: source lives in `src/`, and each card is a real ES module
entry point importing from `src/lib/`:

```text
custom-cards/
  src/
    energy-cost-card.js            (entry)
    energy-cost-breakdown-card.js  (entry)
    lib/
      card-shell.js         — shared shadow-DOM CSS (Sections-view
                               flex-fill layout, axis-label/tooltip/
                               message rules); each card splices in its
                               own extra rules (e.g. `.projected`) after it
      energy-collection.js  — _collectionKey + attach/subscribe
      energy-cost-sources.js — energy/get_prefs+energy/info discovery,
                               per-bucket delta summing
      nice-axis.js           — _niceNumber/_niceAxisScale, verbatim
      format.js               — _formatCurrency, and a tiered
                               _formatTime (cards pass their own tier
                               list — 2 tiers for the cost card, 3 for
                               the breakdown card's month-sized buckets)
      svg-chart.js            — chart padding constants, clientWidth/
                               clientHeight sizing, the ResizeObserver+
                               rAF debounce, and Y-axis gridline markup
  energy-cost-card.js             (generated — do not hand-edit)
  energy-cost-breakdown-card.js   (generated — do not hand-edit)
  package.json / package-lock.json / node_modules/ (gitignored)
```

**What stayed card-specific, deliberately**: how to actually draw the
data. `energy-cost-card.js` renders a line+area+dashed-projection chart
with nearest-point hover; `energy-cost-breakdown-card.js` renders
discrete bars with slot-index hover. These were *not* forced into one
shared chart renderer — the hover math, tick-label placement strategy
(first/middle/last vs. evenly-spaced), and SVG markup for the data itself
differ enough that unifying them would have meant a config-driven
renderer bending to fit two shapes, which is worse than two short,
readable `_renderChart`/`_onPointerMove` methods calling into the same
shared axis/scale/resize/gridline infrastructure.

**Build**: `npm install` once, then `npm run build` (plain `esbuild
--bundle --format=iife`, no config file) regenerates both top-level
`.js` files from `src/`. IIFE format was chosen specifically so the
generated files stay drop-in compatible with whatever Lovelace resource
type (`module` or plain `js`) is already registered — no dashboard config
change needed. **The generated top-level files are committed to git**,
not gitignored — there's no CI/build step in this repo to run `npm run
build` before deploy, so the checked-in output *is* what gets copied to
the HA instance. Run the build and include the regenerated files in the
same commit as any `src/` change; a stale committed bundle is a silent
bug (old behavior deployed, new source reviewed) with nothing to catch
it. The one-manual-copy deploy step itself (see above) is unchanged —
it still copies these same top-level filenames.

### Original plan (kept for context on why esbuild/this layout)

Written before the second card existed. As of that writing there was only one card, so there was nothing
to share yet. The next card was expected to duplicate real, generic logic
from this one: the SVG rendering engine (scaling, gridlines, resize
handling, hover/tooltip), the nice-numbers axis algorithm, time
formatting, and the collection-attachment logic. Card-specific logic
(which stat IDs to discover, how to combine them, and value formatting)
was expected to stay per-card — mostly right; see the correction above.

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

`src/energy-cost-card.js` (plus `src/lib/`) is the canonical example of
every pattern above — when in doubt, read it before re-deriving something
from scratch. Edit source under `src/`, never the generated top-level
`.js` files directly — see "Minimizing duplication" for the build step.
