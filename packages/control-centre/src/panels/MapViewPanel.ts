/**
 * MapViewPanel — top-down view of bot positions and zone boundaries.
 *
 * Requirements: 5.7
 */

import type { DashboardState } from '../websocket-client.js';
import { EGYPTIAN_THEME } from '../theme.js';

export class MapViewPanel {
  render(state: DashboardState): string {
    const { colors } = EGYPTIAN_THEME;
    const bots = Array.from(state.bots.entries());

    if (bots.length === 0) {
      return `<div class="panel" style="border-color:${colors.copper}">
  <h2 style="color:${colors.gold}">Map View</h2>
  <p style="color:${colors.papyrus}">No bots online</p>
</div>`;
    }

    const botMarkers = bots
      .map(([botId, info]) => {
        const dotColor = info.connected ? colors.turquoise : colors.hieroglyphRed;
        const label = info.connected ? `${escapeHtml(botId)} (online)` : `${escapeHtml(botId)} (offline)`;
        return `<div class="bot-marker" style="display:inline-block;margin:4px;padding:4px 8px;border:1px solid ${colors.copper}">
  <span style="color:${dotColor}">●</span> <span style="color:${colors.papyrus}">${label}</span>
</div>`;
      })
      .join('\n');

    return `<div class="panel" style="border-color:${colors.copper}">
  <h2 style="color:${colors.gold}">Map View</h2>
  <div class="map-canvas" style="background:${colors.obsidian};border:1px solid ${colors.copper};padding:8px;min-height:120px">
${botMarkers}
  </div>
</div>`;
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
