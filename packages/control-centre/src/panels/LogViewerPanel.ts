/**
 * LogViewerPanel — filterable log stream with severity highlighting.
 *
 * Requirements: 5.11, 36.9
 */

import type { DashboardState } from '../websocket-client.js';
import type { AlertSeverity } from '@pyramid-os/shared-types';
import { EGYPTIAN_THEME } from '../theme.js';

const SEVERITY_HIGHLIGHT: Record<string, string> = {
  info: EGYPTIAN_THEME.colors.lapis,
  warning: EGYPTIAN_THEME.colors.gold,
  error: EGYPTIAN_THEME.colors.hieroglyphRed,
  critical: EGYPTIAN_THEME.colors.hieroglyphRed,
};

export interface LogEntry {
  timestamp: number;
  severity: AlertSeverity;
  message: string;
  source?: string;
}

export class LogViewerPanel {
  private logs: LogEntry[] = [];
  private severityFilter: AlertSeverity | null = null;

  /** Add a log entry */
  addLog(entry: LogEntry): void {
    this.logs.push(entry);
  }

  /** Set severity filter (null = show all) */
  setFilter(severity: AlertSeverity | null): void {
    this.severityFilter = severity;
  }

  /** Clear all logs */
  clear(): void {
    this.logs = [];
  }

  render(_state: DashboardState): string {
    const { colors } = EGYPTIAN_THEME;

    const filtered = this.severityFilter
      ? this.logs.filter((l) => l.severity === this.severityFilter)
      : this.logs;

    if (filtered.length === 0) {
      return `<div class="panel" style="border-color:${colors.copper}">
  <h2 style="color:${colors.gold}">Log Viewer</h2>
  <p style="color:${colors.papyrus}">No log entries</p>
</div>`;
    }

    const logLines = filtered
      .slice(-100) // Show last 100 entries
      .map((entry) => {
        const color = SEVERITY_HIGHLIGHT[entry.severity] ?? colors.papyrus;
        const time = new Date(entry.timestamp).toLocaleTimeString();
        const source = entry.source ? `[${escapeHtml(entry.source)}] ` : '';
        return `<div class="log-entry" style="font-family:monospace;font-size:0.85em;padding:2px 0;border-bottom:1px solid ${colors.obsidian}">
  <span style="color:${colors.sandstone}">${time}</span>
  <span class="log-severity" style="color:${color};font-weight:bold">${escapeHtml(entry.severity.toUpperCase())}</span>
  <span style="color:${colors.copper}">${source}</span>
  <span style="color:${colors.papyrus}">${escapeHtml(entry.message)}</span>
</div>`;
      })
      .join('\n');

    return `<div class="panel" style="border-color:${colors.copper}">
  <h2 style="color:${colors.gold}">Log Viewer</h2>
  <div class="log-stream" style="max-height:300px;overflow-y:auto;background:${colors.obsidian};padding:4px">
${logLines}
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
