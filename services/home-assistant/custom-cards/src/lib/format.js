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
  return `${symbol} ${number}`;
}

// Picks a date/time format based on how wide a span the chart is
// covering — a time-of-day label is fine for "Today" but meaningless (or,
// for month buckets, misleadingly repetitive) on a longer range. tiers is
// an ordered list of { maxSpanMs?, options }; the first tier whose
// maxSpanMs exceeds spanMs wins, and a tier with no maxSpanMs is the
// catch-all, so it must come last.
export function formatTimeForSpan(timestamp, locale, spanMs, tiers) {
  const date = new Date(timestamp);
  for (const tier of tiers) {
    if (tier.maxSpanMs == null || spanMs < tier.maxSpanMs) {
      return new Intl.DateTimeFormat(locale, tier.options).format(date);
    }
  }
  return new Intl.DateTimeFormat(locale, tiers[tiers.length - 1].options).format(date);
}
