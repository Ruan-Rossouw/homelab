// Grid cost-stat discovery + per-bucket summing shared by every cost
// card in this directory. See ../../CLAUDE.md "Discovering entity/stat
// IDs" for why both energy/get_prefs and energy/info have to be checked
// — getting this wrong silently returns zero results with no error.

export async function discoverGridCostStatIds(hass, prefs) {
  // source.stat_cost (energy/get_prefs) is only populated when a source
  // points directly at a pre-existing cost-tracking entity. When cost is
  // derived from a price entity/static price (our case), the generated
  // cost stat only shows up in energy/info's cost_sensors map, keyed by
  // the consumption stat_id — same lookup the native cards use.
  const info = await hass.callWS({ type: "energy/info" });
  const costSensors = info.cost_sensors || {};

  return (prefs.energy_sources || [])
    .filter((source) => source.type === "grid")
    .map((source) => source.stat_cost || costSensors[source.stat_energy_from])
    .filter(Boolean);
}

// Merges every source's per-bucket delta into one summed-by-bucket map.
// Cumulative-vs-discrete is left to the caller (a running total for
// energy-cost-card.js, standalone bars for energy-cost-breakdown-card.js)
// — this part of the shape is identical either way.
export function sumCostByBucket(stats, costStatIds) {
  const byBucketStart = new Map();
  for (const statId of costStatIds) {
    for (const point of stats[statId] || []) {
      if (point.change == null) continue;
      byBucketStart.set(point.start, (byBucketStart.get(point.start) || 0) + point.change);
    }
  }
  return byBucketStart;
}
