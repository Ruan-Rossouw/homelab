// Picks `targetCount` (or fewer, capped at itemCount) evenly spaced
// indices out of a 0..itemCount-1 range, for x-axis label placement.
// Always includes index 0 and itemCount - 1 exactly, and does so *by
// construction* — an earlier version computed a fixed step and pushed the
// true last index on afterward if the step didn't already land on it,
// which could place two labels only one item apart at the right edge and
// render as visibly overlapping text. Rounding each label's position
// independently along the full range (rather than accumulating a step)
// avoids that class of bug: the spacing near the last label stays close
// to every other gap instead of shrinking to whatever remainder was left.
export function selectLabelIndexes(itemCount, targetCount) {
  if (itemCount <= 0) return [];
  const count = Math.max(1, Math.min(targetCount, itemCount));
  if (count === 1) return [0];
  const indexes = [];
  for (let i = 0; i < count; i++) {
    indexes.push(Math.round((i * (itemCount - 1)) / (count - 1)));
  }
  return [...new Set(indexes)];
}
