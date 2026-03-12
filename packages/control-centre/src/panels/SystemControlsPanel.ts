/**
 * SystemControlsPanel — start/stop/pause buttons, mode selector,
 * and emergency stop button.
 *
 * Requirements: 5.11
 */

import type { DashboardState } from '../websocket-client.js';
import type { OperatingMode } from '@pyramid-os/shared-types';
import { EGYPTIAN_THEME } from '../theme.js';

const MODES: OperatingMode[] = ['structured', 'guided_autonomy', 'free_thinking'];

export class SystemControlsPanel {
  render(_state: DashboardState): string {
    const { colors } = EGYPTIAN_THEME;

    const modeOptions = MODES.map(
      (mode) =>
        `<option value="${escapeHtml(mode)}">${escapeHtml(mode.replace(/_/g, ' '))}</option>`,
    ).join('\n        ');

    return `<div class="panel" style="border-color:${colors.copper}">
  <h2 style="color:${colors.gold}">System Controls</h2>
  <div class="controls-row" style="display:flex;gap:8px;margin-bottom:12px">
    <button class="ctrl-btn" data-action="start" style="background:${colors.turquoise};color:${colors.obsidian};border:none;padding:8px 16px;cursor:pointer">▶ Start</button>
    <button class="ctrl-btn" data-action="stop" style="background:${colors.gold};color:${colors.obsidian};border:none;padding:8px 16px;cursor:pointer">■ Stop</button>
    <button class="ctrl-btn" data-action="pause" style="background:${colors.sandstone};color:${colors.obsidian};border:none;padding:8px 16px;cursor:pointer">⏸ Pause</button>
  </div>
  <div class="mode-selector" style="margin-bottom:12px">
    <label style="color:${colors.papyrus}">Operating Mode:</label>
    <select data-action="mode" style="background:${colors.obsidian};color:${colors.papyrus};border:1px solid ${colors.copper};padding:4px">
        ${modeOptions}
    </select>
  </div>
  <div class="emergency-row">
    <button class="ctrl-btn emergency-stop" data-action="emergency-stop" style="background:${colors.hieroglyphRed};color:white;border:2px solid ${colors.gold};padding:12px 24px;cursor:pointer;font-weight:bold;font-size:1.1em">⚠ EMERGENCY STOP</button>
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
