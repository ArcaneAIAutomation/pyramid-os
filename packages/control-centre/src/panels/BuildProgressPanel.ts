/**
 * BuildProgressPanel — pyramid visualization with percentage complete,
 * current phase, and ETA.
 *
 * Requirements: 5.4
 */

import type { DashboardState } from '../websocket-client.js';
import { EGYPTIAN_THEME } from '../theme.js';

export class BuildProgressPanel {
  render(state: DashboardState): string {
    const { colors } = EGYPTIAN_THEME;
    const builds = Array.from(state.builds.entries());

    if (builds.length === 0) {
      return `<div class="panel" style="border-color:${colors.copper}">
  <h2 style="color:${colors.gold}">Build Progress</h2>
  <p style="color:${colors.papyrus}">No active builds</p>
</div>`;
    }

    const buildRows = builds
      .map(([buildId, percent]) => {
        const clamped = Math.max(0, Math.min(100, percent));
        const barColor = clamped >= 100 ? colors.turquoise : colors.gold;
        return `<div class="build-item" style="margin-bottom:8px">
  <div style="color:${colors.lapis};margin-bottom:4px">${escapeHtml(buildId)}</div>
  <div class="progress-bar" style="background:${colors.obsidian};border:1px solid ${colors.copper};height:20px;position:relative">
    <div class="progress-fill" style="background:${barColor};width:${clamped}%;height:100%"></div>
    <span class="progress-text" style="position:absolute;top:0;left:4px;color:${colors.papyrus}">${clamped.toFixed(1)}%</span>
  </div>
</div>`;
      })
      .join('\n');

    return `<div class="panel" style="border-color:${colors.copper}">
  <h2 style="color:${colors.gold}">Build Progress</h2>
  <div class="pyramid-icon" style="text-align:center;font-size:2rem;color:${colors.gold}">&#9650;</div>
${buildRows}
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
