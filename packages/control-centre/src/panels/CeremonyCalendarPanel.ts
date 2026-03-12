/**
 * CeremonyCalendarPanel — upcoming ceremonies with countdown timers.
 *
 * Requirements: 5.11
 */

import type { DashboardState } from '../websocket-client.js';
import { EGYPTIAN_THEME } from '../theme.js';

export class CeremonyCalendarPanel {
  render(state: DashboardState): string {
    const { colors } = EGYPTIAN_THEME;
    const ceremonies = Array.from(state.ceremonies);

    if (ceremonies.length === 0) {
      return `<div class="panel" style="border-color:${colors.copper}">
  <h2 style="color:${colors.gold}">Ceremony Calendar</h2>
  <p style="color:${colors.papyrus}">No upcoming ceremonies</p>
</div>`;
    }

    const items = ceremonies
      .map((ceremonyId) => {
        return `<div class="ceremony-item" style="border-bottom:1px solid ${colors.copper};padding:4px 0">
  <span style="color:${colors.lapis}">🏛️</span>
  <span class="ceremony-id" style="color:${colors.papyrus}">${escapeHtml(ceremonyId)}</span>
  <span class="ceremony-status" style="color:${colors.turquoise}">In Progress</span>
</div>`;
      })
      .join('\n');

    return `<div class="panel" style="border-color:${colors.copper}">
  <h2 style="color:${colors.gold}">Ceremony Calendar</h2>
  <div class="ceremony-list">
${items}
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
