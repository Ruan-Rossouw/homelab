// Classic "nice numbers" axis algorithm (Heckbert): round a raw range up
// to the nearest clean 1/2/5/10 × 10^n. See ../../CLAUDE.md "Rendering"
// for why this replaced a flat percentage headroom (it produced a top
// value roughly double the actual data max).

// Rounding the max itself first (rather than rounding a step and
// multiplying by a fixed segment count) keeps the axis top snug against
// the actual data — rounding a step size *then* multiplying by the
// segment count could land far above the real max (e.g. a max of 952
// landing on a 2000 top instead of 1000, more empty headroom than data).
export function niceNumber(range, round) {
  if (range <= 0) return 1;
  const exponent = Math.floor(Math.log10(range));
  const fraction = range / Math.pow(10, exponent);
  let niceFraction;
  if (round) {
    if (fraction < 1.5) niceFraction = 1;
    else if (fraction < 3) niceFraction = 2;
    else if (fraction < 7) niceFraction = 5;
    else niceFraction = 10;
  } else if (fraction <= 1) niceFraction = 1;
  else if (fraction <= 2) niceFraction = 2;
  else if (fraction <= 5) niceFraction = 5;
  else niceFraction = 10;
  return niceFraction * Math.pow(10, exponent);
}

// Derives a clean axis max and a clean tick spacing that divides it,
// targeting roughly targetTickCount gridlines.
export function niceAxisScale(dataMax, targetTickCount) {
  const niceRange = niceNumber(dataMax, false);
  const tickSpacing = niceNumber(niceRange / Math.max(targetTickCount - 1, 1), true);
  const axisMax = Math.ceil(dataMax / tickSpacing) * tickSpacing;
  return { axisMax, tickSpacing };
}
