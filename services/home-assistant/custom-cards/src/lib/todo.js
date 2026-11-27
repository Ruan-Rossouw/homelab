// Pure helpers for the wall panel's lists (Home Assistant `todo` entities:
// to-dos and shopping). No DOM, no hass.

// "YYYY-MM-DD" is a whole day in local time; anything longer is a moment.
function parseDue(due) {
  if (!due) return null;
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(due);
  const date = day ? new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])) : new Date(due);
  return Number.isNaN(date.getTime()) ? null : { date, allDay: !!day };
}

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const pad = (n) => String(n).padStart(2, "0");

export function dueInfo(due, now) {
  const p = parseDue(due);
  if (!p) return { when: "none", label: "", at: Infinity };
  const days = Math.round((startOfDay(p.date) - startOfDay(now)) / 86400000);
  const time = p.allDay ? "" : `${pad(p.date.getHours())}:${pad(p.date.getMinutes())}`;
  // A timed item is overdue once its time passes; a dated one from the next day.
  const overdue = p.allDay ? days < 0 : p.date.getTime() < now.getTime();
  let day;
  if (days === 0) day = "Today";
  else if (days === 1) day = "Tomorrow";
  else if (days === -1) day = "Yesterday";
  else if (days > 1 && days < 7) day = p.date.toLocaleDateString("en-GB", { weekday: "long" });
  else day = p.date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const when = overdue ? "overdue" : days === 0 ? "today" : "later";
  return { when, label: time ? `${day} ${time}` : day, at: p.date.getTime() };
}

const RANK = { overdue: 0, today: 1, later: 2, none: 3 };

// Open items, most pressing first. Items without a date keep the list's own
// order (the one set in Reminders / Home Assistant).
export function openTodos(items, now) {
  return (items || [])
    .filter((i) => i && i.status === "needs_action" && (i.summary || "").trim())
    .map((i, order) => ({ uid: i.uid, summary: i.summary.trim(), order, ...dueInfo(i.due, now) }))
    .sort((a, b) => RANK[a.when] - RANK[b.when] || (a.at === b.at ? a.order - b.order : a.at - b.at));
}

// Split the panel's rows between lists of the given lengths: dealt out one at a
// time, in order, so each list gets a fair share and a short one's spare rows
// go to the others.
export function shareRows(counts, total) {
  const rows = counts.map(() => 0);
  let left = total;
  let dealt = true;
  while (left > 0 && dealt) {
    dealt = false;
    counts.forEach((n, i) => {
      if (left > 0 && rows[i] < n) { rows[i] += 1; left -= 1; dealt = true; }
    });
  }
  return rows;
}
