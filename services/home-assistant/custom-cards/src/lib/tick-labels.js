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

// Maps each of `idealTimestamps` to the index of the closest entry in
// `itemTimestamps` (sorted ascending) — for a discrete/categorical axis
// (each item occupies a fixed-width slot, not a continuous position), so a
// label lands on the real item nearest each ideal point instead of an
// arbitrary interpolated one. Duplicate indexes (more targets than
// distinct nearby items) are dropped.
function snapTimestampsToIndexes(itemTimestamps, idealTimestamps) {
  const indexes = idealTimestamps.map((target) => {
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

// `count` evenly-spaced timestamps across [startMs, endMs], snapped to the
// nearest real item index — the sub-day case (an hour-granularity domain),
// where `count` evenly-spaced-then-snapped-to-the-real-bucket-grid ticks
// already reads fine and isn't what HA's real charts do differently (see
// selectNiceDayTicks below for the day+ case, which HA's does visibly
// differ on).
export function selectLabelIndexesForTimestamps(itemTimestamps, startMs, endMs, count) {
  return snapTimestampsToIndexes(itemTimestamps, selectEvenTimestamps(startMs, endMs, count));
}

const DAY_MS = 24 * 60 * 60 * 1000;

// "Nice" whole-day tick intervals, ascending. Chosen so a ~30-day domain
// lands on interval=4 (verified against HA's real observed output for a
// September/30-day period: ticks at Sep 1, 5, 9, 13, 17, 21, 25, 29 — 8
// ticks, 4-day spacing) at MAX_DAY_TICK_COUNT below, and so a ~7-day
// domain lands on interval=1 (every day gets a tick, matching the
// already-correct per-weekday labels a prior commit verified).
const DAY_INTERVAL_CANDIDATES_DAYS = [1, 2, 3, 4, 5, 7, 10, 14, 21, 30, 60, 90, 120, 182, 365];

// The day-scale sibling of DEFAULT_TICK_COUNT above — a separate, larger
// budget because this path doesn't force an exact count the way
// selectEvenTimestamps does; it picks a "nice" interval and lets the tick
// count fall out of it. 8 is the smallest budget that reproduces the real
// September/30-day case's observed 4-day interval (a budget of 6, matching
// DEFAULT_TICK_COUNT, would instead have to jump to a 5-day interval to
// stay under it, which is not what HA's chart actually shows).
export const MAX_DAY_TICK_COUNT = 8;

// Picks the smallest "nice" whole-day interval (from
// DAY_INTERVAL_CANDIDATES_DAYS) whose resulting tick count — anchored
// exactly at startMs, stepping forward until the next step would exceed
// endMs — doesn't exceed maxTicks, then returns those tick timestamps.
//
// This is the general *class* of algorithm every serious time-axis
// implementation uses (e.g. D3's timeDay.every(n)/ticks()), not a guess —
// but it's a reimplementation of that general technique, not a port of
// HA's own code: the actual interval-choosing logic HA's charts rely on
// lives inside the ECharts library itself (xAxis: {type: "time"}'s
// automatic "nice interval" behavior — confirmed via
// energy-chart-options.ts's getCommonOptions, which sets no HA-side
// override beyond a splitNumber cap), not in home-assistant/frontend's own
// source, so there's nothing there to port directly. This converges to
// the same practical result for the spans this project's date-picker
// actually produces (day/week/month/year), verified against the real
// observed September case above plus a week and a year span (see this
// commit's message).
//
// Deliberately NOT used for sub-day (hour-granularity) domains — see
// selectLabelIndexesForTimestamps above for why that case is left as-is.
export function selectNiceDayTicks(startMs, endMs, maxTicks = MAX_DAY_TICK_COUNT) {
  const spanDays = (endMs - startMs) / DAY_MS;
  let intervalDays = DAY_INTERVAL_CANDIDATES_DAYS[DAY_INTERVAL_CANDIDATES_DAYS.length - 1];
  for (const candidate of DAY_INTERVAL_CANDIDATES_DAYS) {
    const count = Math.floor(spanDays / candidate) + 1;
    if (count <= maxTicks) {
      intervalDays = candidate;
      break;
    }
  }
  const intervalMs = intervalDays * DAY_MS;
  const ticks = [];
  for (let t = startMs; t <= endMs; t += intervalMs) {
    ticks.push(t);
  }
  return ticks;
}

// selectNiceDayTicks' ideal timestamps, snapped onto real bucket indexes —
// the discrete/categorical-axis sibling of selectNiceDayTicks, for
// energy-cost-breakdown-card.js's bar chart.
export function selectNiceDayLabelIndexes(itemTimestamps, startMs, endMs, maxTicks = MAX_DAY_TICK_COUNT) {
  return snapTimestampsToIndexes(itemTimestamps, selectNiceDayTicks(startMs, endMs, maxTicks));
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
