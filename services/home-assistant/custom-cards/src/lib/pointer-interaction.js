// Shared touch-vs-mouse pin-state bookkeeping for chart pointer interaction.
//
// Mouse keeps the existing continuous-hover-follows-cursor model untouched.
// Touch switches to tap-to-pin: a tap shows the hover overlay/tooltip and it
// stays visible after the finger lifts — matching HA's own mobile tooltip
// mode (ha-chart-base.ts sets `triggerOn: "click"` on narrow viewports,
// which pins until the next tap rather than requiring continuous contact).
// Without this, a touch tooltip only shows while a finger is actively
// dragging and vanishes the instant it lifts — the "flash and it's gone"
// behavior this exists to fix.
//
// Deliberately tiny: only the pointerType branching and pinned/cleared
// state live here. The actual nearest-point/bucket lookup and SVG overlay
// markup stay per-card (see ../../CLAUDE.md "Minimizing duplication" — the
// two cards' hover math already differs and isn't being unified here).
export function createPointerPin() {
  let pinned = false;

  return {
    // Call from a card's pointerdown handler once it's decided this is a
    // touch tap that should pin.
    pin() {
      pinned = true;
    },
    clear() {
      pinned = false;
    },
    isPinned() {
      return pinned;
    },
    // Call at the top of _onPointerMove. Mouse/pen: always update (today's
    // behavior). Touch: only update while the pointer is actually down —
    // i.e. the initial tap or a drag-to-scrub — not on a stray move event.
    shouldUpdateOnMove(e) {
      return e.pointerType !== "touch" || e.buttons > 0;
    },
    // Call from _onPointerLeave. A pinned touch tap must survive
    // pointerleave/finger-lift; mouse/pen (or an unpinned touch) clears as
    // before.
    shouldClearOnLeave(e) {
      return !(e && e.pointerType === "touch" && pinned);
    },
  };
}
