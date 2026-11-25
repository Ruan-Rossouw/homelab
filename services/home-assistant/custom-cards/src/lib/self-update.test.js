import { test } from "node:test";
import assert from "node:assert/strict";
import { signature, shouldReload, afterLoad, MIN_GAP_MS, RELOAD_SCENES } from "./self-update.js";

const NOW = 1_700_000_000_000;
const base = { scene: "day", loadedSig: "1:a", serverSig: "2:b", now: NOW, record: null };

test("signature is stable and changes with the text", () => {
  assert.equal(signature("hello"), signature("hello"));
  assert.notEqual(signature("hello"), signature("hellp"));
  assert.notEqual(signature("ab"), signature("abc"));
  assert.match(signature("x"), /^1:[0-9a-f]+$/);
});

test("reloads when the server copy differs and the scene is calm", () => {
  assert.equal(shouldReload(base), true);
  for (const scene of ["day", "morning", "away"]) assert.equal(shouldReload({ ...base, scene }), true);
});

test("never reloads during cinema, music, browsing or sleep", () => {
  for (const scene of ["cinema", "music", "browsing", "sleep"]) {
    assert.equal(shouldReload({ ...base, scene }), false, scene);
  }
  assert.deepEqual([...RELOAD_SCENES].sort(), ["away", "day", "morning"]);
});

test("does nothing when the copies match or a fingerprint is missing", () => {
  assert.equal(shouldReload({ ...base, serverSig: "1:a" }), false);
  assert.equal(shouldReload({ ...base, serverSig: null }), false);
  assert.equal(shouldReload({ ...base, loadedSig: null }), false);
});

test("never reloads twice within the minimum gap", () => {
  assert.equal(shouldReload({ ...base, record: { t: NOW - 60_000, sig: "2:b" } }), false);
  assert.equal(shouldReload({ ...base, record: { t: NOW - MIN_GAP_MS - 1 } }), true);
});

test("stops retrying a version that a reload already failed to deliver", () => {
  assert.equal(shouldReload({ ...base, record: { t: NOW - 3 * MIN_GAP_MS, failedSig: "2:b" } }), false);
  // a newer version (different fingerprint) is allowed again
  assert.equal(shouldReload({ ...base, serverSig: "3:c", record: { t: NOW - 3 * MIN_GAP_MS, failedSig: "2:b" } }), true);
});

test("afterLoad marks a reload that did not deliver the expected version", () => {
  assert.deepEqual(afterLoad({ t: 1, sig: "2:b" }, "2:b"), { t: 1, sig: "2:b" }); // it worked
  assert.deepEqual(afterLoad({ t: 1, sig: "2:b" }, "1:a"), { t: 1, sig: "2:b", failedSig: "2:b" });
  assert.equal(afterLoad(null, "1:a"), null);
});
