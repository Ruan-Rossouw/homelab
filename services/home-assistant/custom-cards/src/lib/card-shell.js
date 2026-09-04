// CSS shared by every chart card's shadow DOM (Sections-view flex-fill
// layout, axis-label/tooltip/message styling — all matched against real
// ha-chart-base source, see ../../CLAUDE.md "Rendering"). Cards splice in
// their own extra rules (e.g. energy-cost-card.js's `.projected`) after
// this block.
export const CHART_CARD_STYLES = `
  :host { display: flex; height: 100%; }
  ha-card {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 16px;
    min-height: 0;
  }
  .header {
    font-size: 1rem;
    font-weight: 500;
    color: var(--primary-text-color);
    margin-bottom: 8px;
    flex: none;
  }
  .total {
    font-size: 1.6rem;
    font-weight: 500;
    color: var(--primary-text-color);
    margin-bottom: 8px;
    flex: none;
  }
  .chart { position: relative; flex: 1; min-height: 0; touch-action: pan-y; }
  .chart svg { width: 100%; display: block; }
  .axis-label {
    font-family: Roboto, Noto, sans-serif;
    font-size: var(--ha-font-size-s, 12px);
    fill: var(--primary-text-color);
  }
  .tooltip {
    position: absolute;
    transform: translate(-50%, -100%) translateY(-6px);
    background: var(--card-background-color, #1c1c1c);
    border: 1px solid var(--divider-color);
    border-radius: 4px;
    padding: 4px 8px;
    font-family: Roboto, Noto, sans-serif;
    font-size: var(--ha-font-size-s, 12px);
    color: var(--primary-text-color);
    white-space: nowrap;
    pointer-events: none;
  }
  .tooltip-header {
    font-weight: bold;
    text-align: center;
    margin-bottom: 2px;
  }
  .tooltip-row {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .tooltip-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex: none;
  }
  .message {
    color: var(--secondary-text-color);
    font-size: 0.9rem;
    padding: 8px 0;
  }
  .zoom-reset {
    position: absolute;
    top: 4px;
    right: 4px;
    padding: 2px 8px;
    font-family: Roboto, Noto, sans-serif;
    font-size: var(--ha-font-size-s, 12px);
    color: var(--primary-text-color);
    background: var(--card-background-color, #1c1c1c);
    border: 1px solid var(--divider-color);
    border-radius: 4px;
    cursor: pointer;
  }
  /* Togglable series legend — matches ha-chart-base.ts's real chart-legend
     markup (a plain <ul><li><button> HTML legend, not an ECharts canvas
     one): mdiCheckCircle/mdiCircleOutline toggle icon, secondary-text-color
     on a hidden item, opacity-0.5 hover, larger touch targets on coarse
     pointers. Simplified from HA's version (no overflow/expand chip, no
     more-info-clickable label) since this card only ever has 1-2 series. */
  .legend {
    list-style: none;
    margin: 8px 0 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;
    gap: var(--ha-space-2, 8px);
    font-family: Roboto, Noto, sans-serif;
    font-size: var(--ha-font-size-s, 12px);
    color: var(--primary-text-color);
    flex: none;
  }
  .legend-item {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 24px;
  }
  .legend-item.hidden {
    color: var(--secondary-text-color);
  }
  .legend-toggle {
    background: none;
    border: none;
    color: inherit;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    padding: 4px;
    margin: -4px;
  }
  .legend-toggle:hover {
    opacity: 0.5;
  }
  .legend-label {
    cursor: default;
  }
  @media (pointer: coarse) {
    .legend-item {
      height: 40px;
    }
    .legend-toggle {
      padding: 11px;
      margin: 0;
    }
  }
`;
