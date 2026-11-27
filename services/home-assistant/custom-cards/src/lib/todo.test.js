import { test } from "node:test";
import assert from "node:assert/strict";
import { dueInfo, openTodos, shareRows } from "./todo.js";

const now = new Date(2026, 10, 27, 14, 30); // Fri 27 Nov 2026, 14:30 local
const item = (uid, extra = {}) => ({ uid, summary: uid, status: "needs_action", ...extra });

test("a date-only item is due all day and overdue from the next day", () => {
  assert.deepEqual([dueInfo("2026-11-27", now).when, dueInfo("2026-11-27", now).label], ["today", "Today"]);
  assert.deepEqual([dueInfo("2026-11-26", now).when, dueInfo("2026-11-26", now).label], ["overdue", "Yesterday"]);
});

test("a timed item is overdue once its time has passed", () => {
  const at = (h) => new Date(2026, 10, 27, h, 0).toISOString();
  assert.equal(dueInfo(at(9), now).when, "overdue");
  assert.equal(dueInfo(at(18), now).when, "today");
  assert.equal(dueInfo(at(18), now).label, "Today 18:00");
});

test("labels for coming days", () => {
  assert.equal(dueInfo("2026-11-28", now).label, "Tomorrow");
  assert.equal(dueInfo("2026-12-01", now).label, "Tuesday");
  assert.equal(dueInfo("2026-12-20", now).label, "20 Dec");
});

test("no or unreadable due date", () => {
  assert.equal(dueInfo(undefined, now).when, "none");
  assert.equal(dueInfo("soon", now).when, "none");
});

test("openTodos drops done and blank items and sorts by urgency", () => {
  const out = openTodos([
    item("undated-1"),
    item("later", { due: "2026-12-03" }),
    item("done", { status: "completed" }),
    item("blank", { summary: "   " }),
    item("overdue", { due: "2026-11-20" }),
    item("undated-2"),
    item("today", { due: "2026-11-27" }),
  ], now);
  assert.deepEqual(out.map((i) => i.uid), ["overdue", "today", "later", "undated-1", "undated-2"]);
});

test("openTodos copes with nothing", () => {
  assert.deepEqual(openTodos(undefined, now), []);
});

test("shareRows splits evenly and hands spare rows to the longer list", () => {
  assert.deepEqual(shareRows([5, 5], 4), [2, 2]);
  assert.deepEqual(shareRows([1, 6], 4), [1, 3]);
  assert.deepEqual(shareRows([6, 1], 4), [3, 1]);
  assert.deepEqual(shareRows([6, 0], 4), [4, 0]);
  assert.deepEqual(shareRows([1, 1], 4), [1, 1]);
  assert.deepEqual(shareRows([0, 0], 4), [0, 0]);
});
