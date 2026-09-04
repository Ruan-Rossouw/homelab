// Running-total + linear projection math, shared by energy-cost-card.js
// (still needs both internally, for its chart's Y-domain and dashed
// projection line) and energy-cost-stat-card.js's "total" mode (which
// only needs the two numbers, not the chart). Extracted verbatim from
// energy-cost-card.js rather than re-derived, so both callers agree.

// Turns a per-bucket delta map into the cumulative "bill so far" shape:
// one point per bucket, y = running sum up to and including that bucket.
export function buildRunningTotalSeries(deltaByBucketStart) {
  const bucketStarts = [...deltaByBucketStart.keys()].sort((a, b) => a - b);
  let runningTotal = 0;
  const series = bucketStarts.map((start) => {
    runningTotal += deltaByBucketStart.get(start);
    return { x: start, y: runningTotal };
  });
  return { series, runningTotal };
}

// The reference line spans the period at a constant rate — while the
// period is still ongoing, that rate is a linear extrapolation from data
// so far (an estimate of where the total will land); once the period is
// over, the real final total is already known, so the same line becomes
// the period's actual average pace instead of a forecast — still useful
// (which hours/days ran above or below that average), just no longer
// something to also announce as a "projected" total. Deliberately simple
// and self-contained either way — no reaching outside the data this card
// already has, at the cost of not anticipating a tariff tier crossover
// late in an ongoing period (see the "linear vs tariff-aware" discussion
// this was chosen over).
export function computeProjection(data, series, runningTotal) {
  if (series.length < 2 || !data.start || !data.end) {
    return null;
  }

  const periodStartMs = data.start.getTime();
  const periodEndMs = data.end.getTime();
  const nowMs = Date.now();

  if (nowMs >= periodEndMs) {
    return { endMs: periodEndMs, total: runningTotal, isEstimate: false };
  }

  const elapsedMs = nowMs - periodStartMs;
  const remainingMs = periodEndMs - nowMs;
  if (elapsedMs <= 0) {
    return null;
  }

  const rate = runningTotal / elapsedMs;
  const total = runningTotal + rate * remainingMs;
  return { endMs: periodEndMs, total, isEstimate: true };
}
