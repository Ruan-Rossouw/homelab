// Decision logic for the wall panel card updating itself. No DOM, no fetch:
// the card feeds in fingerprints and the clock, this says whether to reload.
//
// Why it exists: the kiosk loads the dashboard once and never reloads it, and
// HA lets browsers cache each card URL for 31 days, so a new card file on the
// server never reaches the panel by itself. The card therefore compares the
// copy it is running with the server's current copy every few minutes and
// reloads the page when they differ.

// Never reload twice within this long, whatever happens.
export const MIN_GAP_MS = 10 * 60 * 1000;

// Only reload while nothing needs watching. A reload shows HA's bright loading
// screen for ~10-20 s on this CPU, so never during cinema, music or browsing,
// and not while the panel is asleep.
export const RELOAD_SCENES = new Set(["day", "morning", "away"]);

// Small, stable fingerprint of a file's text: "<length>:<hash>".
export function signature(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return `${text.length}:${(h >>> 0).toString(16)}`;
}

// `record` is what was stored before the last reload: { t, sig, failedSig }.
export function shouldReload({ scene, loadedSig, serverSig, now, record }) {
  if (!serverSig || !loadedSig || serverSig === loadedSig) return false;
  if (!RELOAD_SCENES.has(scene)) return false;
  if (record?.failedSig === serverSig) return false; // a reload already failed to deliver this one
  if (record?.t && now - record.t < MIN_GAP_MS) return false;
  return true;
}

// Run once on page load. If the last reload was meant to deliver version
// `record.sig` but the page is running something else, that reload did not
// work (e.g. a stale cache layer): remember it so the card does not loop.
export function afterLoad(record, loadedSig) {
  if (record?.sig && record.sig !== loadedSig) return { ...record, failedSig: record.sig };
  return record || null;
}
