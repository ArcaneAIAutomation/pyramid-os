/**
 * AlertFeedPanel — scrolling list of alerts with severity icons.
 * Sorted by most recent first.
 *
 * Requirements: 5.6, 22.9, 29.11
 */

import type { DashboardState } from '../websocket-client.js';
import type { AlertSeverity } from '@pyramid-os/shared-types';
import { EGYPTIAN_THEME } from '../theme.js';

const SEVERITY_ICONS: Record<AlertSeverity, string> = {
  info: 'ℹ️',
  warning: '⚠️',
  error: '❌',
  critical: '🔴',
};

const SEVERITY_COLORS: Record<AlertSeverity, string> = {
  info: EGYPTIAN_THEME.colors.lapis,
  warning: EGYPTIAN_THEME.colors.gold,
  error: EGYPTIAN_THEME.colors.hieroglyphRed,
  critical: EGYPTIAN_THEME.colors.hieroglyphRed,
};

export class AlertFeedPanel {
  render(state: DashboardState): string {
    const { colors } = EGYPTIAN_THEME;

    if (state.alerts.length === 0) {
      return `<div class="panel" style="border-color:${colors.copper}">
  <h2 style="color:${colors.gold}">Alert Feed</h2>
  <p style="color:${colors.papyrus}">No alerts</p>
</div>`;
    }

    // Sort by most recent first
    const sorted = [...state.alerts].sort((a, b) => b.receivedAt - a.receivedAt);

    const alertItems = sorted
      .map((alert) => {
        const icon = SEVERITY_ICONS[alert.severity] ?? 'ℹ️';
        const color = SEVERITY_COLORS[alert.severity] ?? colors.papyrus;
        const time = new Date(alert.receivedAt).toLocaleTimeString();
        return `<div class="alert-item" style="border-bottom:1px solid ${colors.copper};padding:4px 0">
  <span class="alert-icon">${icon}</span>
  <span class="alert-severity" style="color:${color}">[${escapeHtml(alert.severity)}]</span>
  <span class="alert-message" style="color:${colors.papyrus}">${escapeHtml(alert.message)}</span>
  <span class="alert-time" style="color:${colors.sandstone};font-size:0.8em">${time}</span>
</div>`;
      })
      .join('\n');

    return `<div class="panel" style="border-color:${colors.copper}">
  <h2 style="color:${colors.gold}">Alert Feed</h2>
  <div class="alert-list" style="max-height:300px;overflow-y:auto">
${alertItems}
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
