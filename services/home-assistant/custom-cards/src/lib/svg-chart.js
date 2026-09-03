// Shared SVG chart infrastructure: sizing, resize handling, and axis
// gridlines. Deliberately stops there — how to draw the data (line+area
// with point hover vs. discrete bars with slot hover) stays per-card. See
// ../../CLAUDE.md "Minimizing duplication" for why the split lands here.

export const CHART_PADDING = { left: 56, right: 12, top: 10, bottom: 24 };

// Screen-space pixel threshold a mouse drag must clear before it commits to
// a zoom range rather than being treated as a plain click — shared so both
// cards agree on what counts as "an intentional drag."
export const DRAG_ZOOM_THRESHOLD_PX = 8;

// Sections view reserves a fixed-height box via grid_rows and clips
// anything taller than it, rather than growing to fit content the way
// masonry view does — so prefer the container's actual measured height,
// falling back to a width-based formula only when no real height is
// available yet (e.g. masonry view, or before first layout). See
// ../../CLAUDE.md "Sections-view vs. masonry-view height".
export function measureChartBox(chartEl) {
  const width = chartEl.clientWidth || 600;
  const height = chartEl.clientHeight || Math.max(width / 2, 200);
  return { width, height };
}

// Match the viewBox to the container's real pixel box so the coordinate
// system is 1:1 with CSS pixels on both axes, and debounce through rAF so
// a continuous drag-resize doesn't re-render on every tick. See
// ../../CLAUDE.md "SVG stretch distortion" for why an untracked resize
// (preserveAspectRatio="none" against a fixed viewBox) is a real bug, not
// just a nice-to-have.
export function observeChartResize(chartEl, onResize) {
  let frame;
  const observer = new ResizeObserver(() => {
    if (frame) {
      cancelAnimationFrame(frame);
    }
    frame = requestAnimationFrame(() => {
      frame = undefined;
      onResize();
    });
  });
  observer.observe(chartEl);
  return observer;
}

// Solid gridlines at each clean tick-spacing multiple up to the nice axis
// max — matches ha-chart-base's ~5-gridline splitNumber and its solid
// (non-dashed) splitLine style, without hardcoding "divide by 4" (which
// doesn't line up with a tickSpacing that isn't axisMax/4).
export function renderYGridlines({ domainMaxY, tickSpacing, scaleY, padLeft, width, padRight, formatValue }) {
  const tickCount = Math.round(domainMaxY / tickSpacing);
  return Array.from({ length: tickCount + 1 }, (_, i) => i * tickSpacing)
    .map((v) => {
      const y = scaleY(v).toFixed(1);
      return `
        <line x1="${padLeft}" y1="${y}" x2="${width - padRight}" y2="${y}" stroke="var(--divider-color)" stroke-width="1"></line>
        <text x="${padLeft - 6}" y="${y}" text-anchor="end" dominant-baseline="middle" class="axis-label">${formatValue(v)}</text>
      `;
    })
    .join("");
}
