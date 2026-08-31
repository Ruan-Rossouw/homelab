// Shared collection-attachment logic — every energy-* card (native or
// custom) reads the same in-memory collection HA's energy-date-selection
// card creates on hass.connection. See ../../CLAUDE.md "Sharing the
// native date-picker" for why this exists instead of a real subscription
// API or a re-implemented date picker.

// Same key derivation as home-assistant-frontend's
// convertCollectionKeyToConnection, so this lands on the exact cache slot
// energy-date-selection uses on hass.connection.
export function collectionKey(config, hass) {
  const configuredKey = config.collection_key;
  if (configuredKey) {
    return `_${configuredKey}`;
  }
  if (hass?.panelUrl) {
    return `_energy_${hass.panelUrl}`;
  }
  return "_energy";
}

// Callers own the hass/connected/hasSubscription guard (they own the
// resulting unsub handle) — this just does the lookup-and-subscribe once
// those checks have passed. Returns undefined (calling onWaiting instead)
// when hass.connection[key] isn't populated yet — most likely an
// energy-date-selection card on this view hasn't finished mounting/
// creating it. The card's own `set hass` fires again shortly; try again
// then rather than building a fallback collection.
export function attachToEnergyCollection(hass, config, onData, onWaiting) {
  const key = collectionKey(config, hass);
  const collection = hass.connection[key];

  if (!collection) {
    onWaiting();
    return undefined;
  }

  return collection.subscribe(onData);
}
