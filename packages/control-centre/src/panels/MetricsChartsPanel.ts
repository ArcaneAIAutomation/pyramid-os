/**
 * MetricsChartsPanel — time-series graphs for task completion rate,
 * resource consumption, and bot uptime.
 *
 * Requirements: 39.10
 */

import type { DashboardState } from '../websocket-client.js';
import { EGYPTIAN_THEME } from '../theme.js';

export class MetricsChartsPanel {
  render(state: DashboardState): string {
    const { colors } = EGYPTIAN_THEME;

    const taskCount = state.completedTasks.length;
    const successCount = state.completedTasks.filter((t) => t.success).length;
    const completionRate = taskCount > 0 ? ((successCount / taskCount) * 100).toFixed(1) : '0.0';

    const totalBots = state.bots.size;
    const onlineBots = Array.from(state.bots.values()).filter((b) => b.connected).length;
    const uptimePct = totalBots > 0 ? ((onlineBots / totalBots) * 100).toFixed(1) : '0.0';

    const resourceCount = state.resources.size;

    return `<div class="panel" style="border-color:${colors.copper}">
  <h2 style="color:${colors.gold}">Metrics</h2>
  <div class="metrics-grid" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
    <div class="metric-card" style="text-align:center;padding:8px;border:1px solid ${colors.copper}">
      <div style="color:${colors.sandstone};font-size:0.8em">Task Completion</div>
      <div class="metric-value" style="color:${colors.turquoise};font-size:1.4em">${completionRate}%</div>
      <div style="color:${colors.sandstone};font-size:0.7em">${successCount}/${taskCount} tasks</div>
    </div>
    <div class="metric-card" style="text-align:center;padding:8px;border:1px solid ${colors.copper}">
      <div style="color:${colors.sandstone};font-size:0.8em">Bot Uptime</div>
      <div class="metric-value" style="color:${colors.turquoise};font-size:1.4em">${uptimePct}%</div>
      <div style="color:${colors.sandstone};font-size:0.7em">${onlineBots}/${totalBots} online</div>
    </div>
    <div class="metric-card" style="text-align:center;padding:8px;border:1px solid ${colors.copper}">
      <div style="color:${colors.sandstone};font-size:0.8em">Resources Tracked</div>
      <div class="metric-value" style="color:${colors.turquoise};font-size:1.4em">${resourceCount}</div>
      <div style="color:${colors.sandstone};font-size:0.7em">resource types</div>
    </div>
  </div>
</div>`;
  }
}
