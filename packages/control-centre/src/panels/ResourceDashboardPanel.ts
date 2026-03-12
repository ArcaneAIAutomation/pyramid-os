/**
 * ResourceDashboardPanel — bar charts with color-coded levels.
 * Color logic: level >= minimum → green (turquoise), level < minimum → yellow (gold),
 * level < critical → red (hieroglyphRed).
 *
 * Requirements: 5.5, 21.10
 */

import type { DashboardState } from '../websocket-client.js';
import type { ResourceThreshold } from '@pyramid-os/shared-types';
import { EGYPTIAN_THEME } from '../theme.js';

export interface ResourceThresholdConfig {
  resourceType: string;
  minimum: number;
  critical: number;
}

/**
 * Determine the color for a resource level based on thresholds.
 * - level >= minimum → green (turquoise #40E0D0)
 * - level < minimum → yellow (gold #FFD700)
 * - level < critical → red (hieroglyphRed #C41E3A)
 */
export function getResourceColor(level: number, threshold: ResourceThresholdConfig): string {
  const { colors } = EGYPTIAN_THEME;
  if (level < threshold.critical) return colors.hieroglyphRed;
  if (level < threshold.minimum) return colors.gold;
  return colors.turquoise;
}

export class ResourceDashboardPanel {
  private thresholds: Map<string, ResourceThresholdConfig>;

  constructor(thresholds: ResourceThresholdConfig[] = []) {
    this.thresholds = new Map(thresholds.map((t) => [t.resourceType, t]));
  }

  /** Set or update thresholds at runtime */
  setThresholds(thresholds: ResourceThresholdConfig[]): void {
    this.thresholds = new Map(thresholds.map((t) => [t.resourceType, t]));
  }

  render(state: DashboardState): string {
    const { colors } = EGYPTIAN_THEME;
    const resources = Array.from(state.resources.entries());

    if (resources.length === 0) {
      return `<div class="panel" style="border-color:${colors.copper}">
  <h2 style="color:${colors.gold}">Resources</h2>
  <p style="color:${colors.papyrus}">No resource data</p>
</div>`;
    }

    const defaultThreshold: ResourceThresholdConfig = { resourceType: '', minimum: 50, critical: 10 };

    const bars = resources
      .map(([resourceType, level]) => {
        const threshold = this.thresholds.get(resourceType) ?? defaultThreshold;
        const barColor = getResourceColor(level, threshold);
        const maxDisplay = Math.max(level, threshold.minimum * 2, 100);
        const widthPct = Math.min(100, (level / maxDisplay) * 100);

        return `<div class="resource-row" style="margin-bottom:6px">
  <div style="color:${colors.papyrus};margin-bottom:2px">${escapeHtml(resourceType)}: ${level}</div>
  <div class="resource-bar" style="background:${colors.obsidian};border:1px solid ${colors.copper};height:16px">
    <div class="resource-fill" style="background:${barColor};width:${widthPct.toFixed(1)}%;height:100%"></div>
  </div>
</div>`;
      })
      .join('\n');

    return `<div class="panel" style="border-color:${colors.copper}">
  <h2 style="color:${colors.gold}">Resources</h2>
${bars}
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
