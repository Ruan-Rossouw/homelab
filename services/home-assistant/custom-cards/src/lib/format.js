// Currency + tiered time formatting shared by every chart card. See
// ../../CLAUDE.md "Number formatting gotchas" for why the currency symbol
// is plain config instead of Intl's locale-dependent currency style.

export function formatCurrency(value, { symbol = "R", locale, compact = false } = {}) {
  // Below 1000, compact notation doesn't apply a K/M suffix at all, so
  // forcing a decimal there would just add a pointless ".0" (R500.0). At/
  // above 1000 it does apply a suffix, and without a forced minimum, Intl
  // only shows a decimal when the value needs one — so 1000 and 1500
  // render as "1K" and "1.5K", inconsistent siblings on the same axis.
  // Force it only in that magnitude range for consistency.
  const forceDecimal = compact && Math.abs(value) >= 1000;
  let number;
  try {
    number = new Intl.NumberFormat(locale, {
      notation: compact ? "compact" : "standard",
      maximumFractionDigits: compact ? 1 : 2,
      minimumFractionDigits: forceDecimal ? 1 : compact ? 0 : 2,
    }).format(value);
  } catch {
    number = value.toFixed(compact ? 0 : 2);
  }
  // Empty symbol -> bare number, no leading space. Used for y-axis tick
  // labels, which show the unit once (see svg-chart.js's renderYGridlines
  // axisName) rather than repeating it on every tick — matches HA's own
  // yAxis.name + per-tick axisLabel.formatter split (energy-chart-options.ts
  // getCommonOptions: name: unit on the axis, createYAxisLabelFormatter
  // returns bare numbers).
  return symbol ? `${symbol} ${number}` : number;
}

// Picks a date/time format based on how wide a span the chart is
// covering — a time-of-day label is fine for "Today" but meaningless (or,
// for month buckets, misleadingly repetitive) on a longer range. tiers is
// an ordered list of { maxSpanMs?, options } (or { maxSpanMs?, formatter }
// for a tier needing a per-timestamp conditional, and/or { midnightOptions }
// for a tier that special-cases an exact-midnight tick); the first tier
// whose maxSpanMs exceeds spanMs wins, and a tier with no maxSpanMs is the
// catch-all, so it must come last.
export function formatTimeForSpan(timestamp, locale, spanMs, tiers) {
  const date = new Date(timestamp);
  const tier = tiers.find((t) => t.maxSpanMs == null || spanMs < t.maxSpanMs) || tiers[tiers.length - 1];
  if (
    tier.midnightOptions &&
    date.getHours() === 0 &&
    date.getMinutes() === 0 &&
    date.getSeconds() === 0
  ) {
    return new Intl.DateTimeFormat(locale, tier.midnightOptions).format(date);
  }
  if (tier.formatter) {
    return tier.formatter(date, locale);
  }
  return new Intl.DateTimeFormat(locale, tier.options).format(date);
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Exact port of HA's real axis-label-formatting cascade — home-assistant/
// frontend's src/components/chart/axis-label.ts, formatTimeLabel(), fetched
// and read verbatim (dev branch) rather than guessed. Its `minutesDifference`
// parameter is (axis.max - axis.min) in minutes (ha-chart-base.ts:
// `differenceInMinutes(axis.max, axis.min)`, i.e. the *plotted domain* span,
// scaled by zoom ratio when zoomed) — NOT a per-tick interval, and NOT the
// span of only the real/actual data. A caller must pass the full plotted
// domain's span (this card's `domainMaxX - domainMinX` equivalent), same as
// HA's own axis min/max — passing the real-data-only span instead silently
// mismatches match once a chart's visible domain outgrows its real data
// (e.g. a cumulative total's dashed projection extending to the period end).
//
// Two deliberate omissions from HA's real cascade, both because SVG plain-
// text ticks can't do partial-bold without much more markup, and because
// the affected cases can't actually occur here:
// - Bold-on-1st-of-month / bold-on-January ticks: dropped, format is
//   otherwise identical either way.
// - The <5-minute "time with seconds" tier: dropped — this card's minimum
//   zoom span floor is measured in hours (see each card's _minZoomSpanMs),
//   so a <5-minute *domain* span is unreachable in practice.
// Every threshold/format below IS the real cascade, boundary-for-boundary:
// real code's `dayDifference > N` (N = 2, 7, 35, 88) means "> N days", so a
// tier's own upper edge needs a `+1`ms epsilon to stay inclusive of exactly
// N days (matching this codebase's existing DEFAULT_TICK_COUNT` +1` epsilon
// convention already used elsewhere in tick-labels.js).
export function haStyleTimeTiers() {
  return [
    {
      maxSpanMs: 2 * DAY_MS + 1,
      options: { hour: "numeric", minute: "2-digit" },
      // Real code special-cases an exact-midnight tick within this tier to
      // show the date instead of e.g. "12:00 AM" — a real, useful behavior
      // at day boundaries, not a guess.
      midnightOptions: { day: "numeric", month: "short" },
    },
    { maxSpanMs: 7 * DAY_MS + 1, options: { weekday: "short" } },
    { maxSpanMs: 88 * DAY_MS + 1, options: { day: "numeric", month: "short" } },
    {
      // Real code shows the bare month name once a span exceeds ~3 months,
      // adding the year only on a January tick (context resets each year) —
      // month:"long", not "short" (HA's own formatDateMonth/MonthYear use
      // "long"). Needs a formatter (not static options) since which format
      // applies depends on each individual tick's own month.
      formatter: (date, locale) =>
        date.getMonth() === 0
          ? new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(date)
          : new Intl.DateTimeFormat(locale, { month: "long" }).format(date),
    },
  ];
}
