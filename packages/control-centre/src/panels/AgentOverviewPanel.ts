/**
 * AgentOverviewPanel — grid of all agents with status indicators (active/idle/error)
 * and most recent reasoning summary.
 *
 * Requirements: 5.2, 5.3
 */

import type { DashboardState } from '../websocket-client.js';
import { EGYPTIAN_THEME } from '../theme.js';

const STATUS_COLORS: Record<string, string> = {
  active: EGYPTIAN_THEME.colors.turquoise,
  idle: EGYPTIAN_THEME.colors.gold,
  error: EGYPTIAN_THEME.colors.hieroglyphRed,
  stopped: EGYPTIAN_THEME.colors.copper,
};

export class AgentOverviewPanel {
  render(state: DashboardState): string {
    const { colors } = EGYPTIAN_THEME;
    const agents = Array.from(state.agents.entries());

    if (agents.length === 0) {
      return `<div class="panel" style="border-color:${colors.copper}">
  <h2 style="color:${colors.gold}">Agent Overview</h2>
  <p style="color:${colors.papyrus}">No agents connected</p>
</div>`;
    }

    const agentCards = agents
      .map(([id, status]) => {
        const color = STATUS_COLORS[status] ?? colors.papyrus;
        return `<div class="agent-card" style="border:1px solid ${colors.copper};padding:8px;margin:4px">
  <span class="agent-id" style="color:${colors.lapis}">${escapeHtml(id)}</span>
  <span class="agent-status" style="color:${color}">● ${escapeHtml(status)}</span>
</div>`;
      })
      .join('\n');

    return `<div class="panel" style="border-color:${colors.copper}">
  <h2 style="color:${colors.gold}">Agent Overview</h2>
  <div class="agent-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px">
${agentCards}
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
