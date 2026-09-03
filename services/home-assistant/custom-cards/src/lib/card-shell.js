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
  .message {
    color: var(--secondary-text-color);
    font-size: 0.9rem;
    padding: 8px 0;
  }
`;
