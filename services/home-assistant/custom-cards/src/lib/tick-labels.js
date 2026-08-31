// Both cost cards want the same number of evenly-spaced x-axis reference
// points across the same date range, computed the same way — otherwise,
// stacked one above the other for the same period, their axes read as
// subtly uncoordinated even when each individually looks fine on its own.
// The line chart (continuous time domain) and the bar chart (discrete,
// per-bucket categorical slots) need different *positioning* math, but
// should agree on *which timestamps* get labeled.

// How many x-axis labels both charts target — a shared constant, not
// just a shared default, so the two can't quietly drift out of sync by
// one being retuned without the other.
export const DEFAULT_TICK_COUNT = 6;

// `count` timestamps evenly spaced across [startMs, endMs], inclusive of
// both ends.
export function selectEvenTimestamps(startMs, endMs, count) {
  if (count <= 1) return [startMs];
  return Array.from({ length: count }, (_, i) => startMs + ((endMs - startMs) * i) / (count - 1));
}

// Maps each of `count` evenly-spaced timestamps across [startMs, endMs] to
// the index of the closest entry in `itemTimestamps` (sorted ascending) —
// for a discrete/categorical axis (each item occupies a fixed-width slot,
// not a continuous position), so a label lands on the real item nearest
// each ideal evenly-spaced point instead of an arbitrary interpolated
// one. Duplicate indexes (more targets than distinct nearby items) are
// dropped.
export function selectLabelIndexesForTimestamps(itemTimestamps, startMs, endMs, count) {
  const indexes = selectEvenTimestamps(startMs, endMs, count).map((target) => {
    let nearest = 0;
    let nearestDist = Infinity;
    for (let i = 0; i < itemTimestamps.length; i++) {
      const dist = Math.abs(itemTimestamps[i] - target);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = i;
      }
    }
    return nearest;
  });
  return [...new Set(indexes)];
}

// Infers a safe, fixed bucket-to-bucket step in ms from real, sorted
// ascending timestamps — HA doesn't expose bucket granularity directly,
// so this is the same "look at two real points" trick
// energy-cost-breakdown-card.js already used for its tail-padding step.
// Only trusted up to day-length: a month-bucketed year view has
// variable-length buckets (28-31 days) that fixed-step arithmetic would
// drift on, so those return undefined rather than risk a wrong grid.
export function inferFixedStepMs(sortedTimestamps) {
  if (sortedTimestamps.length < 2) return undefined;
  const step = sortedTimestamps[1] - sortedTimestamps[0];
  return step > 0 && step <= 24 * 60 * 60 * 1000 ? step : undefined;
}

// Rounds `t` to the nearest multiple of stepMs measured from originMs —
// snaps an ideal evenly-spaced tick position onto the real bucket grid so
// axis labels land on round times (e.g. "5:00 AM") instead of an
// arbitrary fraction of the domain (e.g. "4:48 AM", the actual result of
// splitting a 24-hour domain into 5 equal intervals).
export function snapToStep(t, originMs, stepMs) {
  return originMs + Math.round((t - originMs) / stepMs) * stepMs;
}
