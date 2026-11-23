// Guards against a method being deleted while the call to it remains: every
// `this._name(` call in the card source must have a matching method.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("every this._method() called in wall-panel-card.js is defined", () => {
  const src = readFileSync(new URL("./wall-panel-card.js", import.meta.url), "utf8");
  const called = new Set([...src.matchAll(/this\.(_[A-Za-z]+)\(/g)].map((m) => m[1]));
  const defined = new Set([...src.matchAll(/^  (_?[A-Za-z]+)\(.*\) \{/gm)].map((m) => m[1]));
  const missing = [...called].filter((n) => !defined.has(n));
  assert.deepEqual(missing, []);
});
