import { describe, it, expect } from 'vitest';
import type { DashboardState } from '../websocket-client.js';
import {
  AgentOverviewPanel,
  BuildProgressPanel,
  ResourceDashboardPanel,
  getResourceColor,
  MapViewPanel,
  AlertFeedPanel,
  CeremonyCalendarPanel,
  MetricsChartsPanel,
  LogViewerPanel,
  SystemControlsPanel,
} from '../panels/index.js';
import { EGYPTIAN_THEME } from '../theme.js';

function emptyState(): DashboardState {
  return {
    agents: new Map(),
    resources: new Map(),
    builds: new Map(),
    bots: new Map(),
    alerts: [],
    health: new Map(),
    ceremonies: new Set(),
    completedTasks: [],
    activeCivilization: null,
  };
}

// ── AgentOverviewPanel ──────────────────────────────────────────────

describe('AgentOverviewPanel', () => {
  const panel = new AgentOverviewPanel();

  it('renders empty state message when no agents', () => {
    const html = panel.render(emptyState());
    expect(html).toContain('No agents connected');
  });

  it('renders agent cards with status colors', () => {
    const state = emptyState();
    state.agents.set('pharaoh-1', 'active');
    state.agents.set('builder-1', 'idle');
    state.agents.set('guard-1', 'error');
    const html = panel.render(state);
    expect(html).toContain('pharaoh-1');
    expect(html).toContain('builder-1');
    expect(html).toContain('guard-1');
    expect(html).toContain(EGYPTIAN_THEME.colors.turquoise); // active
    expect(html).toContain(EGYPTIAN_THEME.colors.gold); // idle
    expect(html).toContain(EGYPTIAN_THEME.colors.hieroglyphRed); // error
    expect(html).toContain('Agent Overview');
  });
});

// ── BuildProgressPanel ──────────────────────────────────────────────

describe('BuildProgressPanel', () => {
  const panel = new BuildProgressPanel();

  it('renders empty state message when no builds', () => {
    const html = panel.render(emptyState());
    expect(html).toContain('No active builds');
  });

  it('renders build progress bars with percentage', () => {
    const state = emptyState();
    state.builds.set('pyramid-1', 45.5);
    state.builds.set('temple-1', 100);
    const html = panel.render(state);
    expect(html).toContain('pyramid-1');
    expect(html).toContain('45.5%');
    expect(html).toContain('temple-1');
    expect(html).toContain('100.0%');
  });

  it('clamps progress to 0-100 range', () => {
    const state = emptyState();
    state.builds.set('over', 150);
    const html = panel.render(state);
    expect(html).toContain('100.0%');
  });
});

// ── ResourceDashboardPanel ──────────────────────────────────────────

describe('ResourceDashboardPanel', () => {
  it('renders empty state message when no resources', () => {
    const panel = new ResourceDashboardPanel();
    const html = panel.render(emptyState());
    expect(html).toContain('No resource data');
  });

  it('renders resource bars with correct colors', () => {
    const panel = new ResourceDashboardPanel([
      { resourceType: 'sandstone', minimum: 100, critical: 20 },
    ]);
    const state = emptyState();
    state.resources.set('sandstone', 150);
    const html = panel.render(state);
    expect(html).toContain('sandstone');
    expect(html).toContain(EGYPTIAN_THEME.colors.turquoise); // green: >= minimum
  });

  it('uses default thresholds for unknown resources', () => {
    const panel = new ResourceDashboardPanel();
    const state = emptyState();
    state.resources.set('unknown_ore', 5);
    const html = panel.render(state);
    expect(html).toContain('unknown_ore');
  });

  it('allows runtime threshold updates', () => {
    const panel = new ResourceDashboardPanel();
    panel.setThresholds([{ resourceType: 'gold_block', minimum: 50, critical: 10 }]);
    const state = emptyState();
    state.resources.set('gold_block', 30);
    const html = panel.render(state);
    expect(html).toContain(EGYPTIAN_THEME.colors.gold); // yellow: < minimum
  });
});

describe('getResourceColor', () => {
  const threshold = { resourceType: 'sandstone', minimum: 100, critical: 20 };

  it('returns turquoise (green) when level >= minimum', () => {
    expect(getResourceColor(100, threshold)).toBe(EGYPTIAN_THEME.colors.turquoise);
    expect(getResourceColor(200, threshold)).toBe(EGYPTIAN_THEME.colors.turquoise);
  });

  it('returns gold (yellow) when level < minimum but >= critical', () => {
    expect(getResourceColor(99, threshold)).toBe(EGYPTIAN_THEME.colors.gold);
    expect(getResourceColor(50, threshold)).toBe(EGYPTIAN_THEME.colors.gold);
    expect(getResourceColor(20, threshold)).toBe(EGYPTIAN_THEME.colors.gold);
  });

  it('returns hieroglyphRed (red) when level < critical', () => {
    expect(getResourceColor(19, threshold)).toBe(EGYPTIAN_THEME.colors.hieroglyphRed);
    expect(getResourceColor(0, threshold)).toBe(EGYPTIAN_THEME.colors.hieroglyphRed);
  });

  it('handles exact boundary at minimum', () => {
    expect(getResourceColor(100, threshold)).toBe(EGYPTIAN_THEME.colors.turquoise);
  });

  it('handles exact boundary at critical', () => {
    // critical = 20, so level 20 is NOT < critical → should be yellow
    expect(getResourceColor(20, threshold)).toBe(EGYPTIAN_THEME.colors.gold);
  });
});

// ── MapViewPanel ────────────────────────────────────────────────────

describe('MapViewPanel', () => {
  const panel = new MapViewPanel();

  it('renders empty state message when no bots', () => {
    const html = panel.render(emptyState());
    expect(html).toContain('No bots online');
  });

  it('renders bot markers with connection status', () => {
    const state = emptyState();
    state.bots.set('bot-1', { connected: true, server: 'localhost' });
    state.bots.set('bot-2', { connected: false, reason: 'timeout' });
    const html = panel.render(state);
    expect(html).toContain('bot-1');
    expect(html).toContain('online');
    expect(html).toContain('bot-2');
    expect(html).toContain('offline');
    expect(html).toContain(EGYPTIAN_THEME.colors.turquoise);
    expect(html).toContain(EGYPTIAN_THEME.colors.hieroglyphRed);
  });
});

// ── AlertFeedPanel ──────────────────────────────────────────────────

describe('AlertFeedPanel', () => {
  const panel = new AlertFeedPanel();

  it('renders empty state message when no alerts', () => {
    const html = panel.render(emptyState());
    expect(html).toContain('No alerts');
  });

  it('renders alerts sorted by most recent first', () => {
    const state = emptyState();
    state.alerts.push(
      { severity: 'info', message: 'First alert', receivedAt: 1000 },
      { severity: 'error', message: 'Second alert', receivedAt: 3000 },
      { severity: 'warning', message: 'Middle alert', receivedAt: 2000 },
    );
    const html = panel.render(state);
    const firstIdx = html.indexOf('Second alert');
    const middleIdx = html.indexOf('Middle alert');
    const lastIdx = html.indexOf('First alert');
    expect(firstIdx).toBeLessThan(middleIdx);
    expect(middleIdx).toBeLessThan(lastIdx);
  });

  it('renders severity icons', () => {
    const state = emptyState();
    state.alerts.push({ severity: 'critical', message: 'Critical!', receivedAt: 1000 });
    const html = panel.render(state);
    expect(html).toContain('🔴');
    expect(html).toContain('[critical]');
  });
});

// ── CeremonyCalendarPanel ───────────────────────────────────────────

describe('CeremonyCalendarPanel', () => {
  const panel = new CeremonyCalendarPanel();

  it('renders empty state message when no ceremonies', () => {
    const html = panel.render(emptyState());
    expect(html).toContain('No upcoming ceremonies');
  });

  it('renders ceremony list', () => {
    const state = emptyState();
    state.ceremonies.add('harvest_festival_1');
    state.ceremonies.add('coronation_2');
    const html = panel.render(state);
    expect(html).toContain('harvest_festival_1');
    expect(html).toContain('coronation_2');
    expect(html).toContain('Ceremony Calendar');
  });
});

// ── MetricsChartsPanel ──────────────────────────────────────────────

describe('MetricsChartsPanel', () => {
  const panel = new MetricsChartsPanel();

  it('renders zero metrics for empty state', () => {
    const html = panel.render(emptyState());
    expect(html).toContain('0.0%');
    expect(html).toContain('0/0');
    expect(html).toContain('Metrics');
  });

  it('calculates task completion rate', () => {
    const state = emptyState();
    state.completedTasks.push(
      { taskId: 't1', success: true, outcome: 'done', completedAt: '' },
      { taskId: 't2', success: false, outcome: 'fail', completedAt: '' },
      { taskId: 't3', success: true, outcome: 'done', completedAt: '' },
    );
    const html = panel.render(state);
    expect(html).toContain('66.7%');
    expect(html).toContain('2/3 tasks');
  });

  it('calculates bot uptime percentage', () => {
    const state = emptyState();
    state.bots.set('b1', { connected: true });
    state.bots.set('b2', { connected: true });
    state.bots.set('b3', { connected: false });
    const html = panel.render(state);
    expect(html).toContain('66.7%');
    expect(html).toContain('2/3 online');
  });
});

// ── LogViewerPanel ──────────────────────────────────────────────────

describe('LogViewerPanel', () => {
  it('renders empty state message when no logs', () => {
    const panel = new LogViewerPanel();
    const html = panel.render(emptyState());
    expect(html).toContain('No log entries');
  });

  it('renders log entries with severity highlighting', () => {
    const panel = new LogViewerPanel();
    panel.addLog({ timestamp: Date.now(), severity: 'error', message: 'Something broke' });
    panel.addLog({ timestamp: Date.now(), severity: 'info', message: 'All good' });
    const html = panel.render(emptyState());
    expect(html).toContain('Something broke');
    expect(html).toContain('All good');
    expect(html).toContain('ERROR');
    expect(html).toContain('INFO');
  });

  it('filters by severity', () => {
    const panel = new LogViewerPanel();
    panel.addLog({ timestamp: Date.now(), severity: 'error', message: 'Error msg' });
    panel.addLog({ timestamp: Date.now(), severity: 'info', message: 'Info msg' });
    panel.setFilter('error');
    const html = panel.render(emptyState());
    expect(html).toContain('Error msg');
    expect(html).not.toContain('Info msg');
  });

  it('clears logs', () => {
    const panel = new LogViewerPanel();
    panel.addLog({ timestamp: Date.now(), severity: 'info', message: 'test' });
    panel.clear();
    const html = panel.render(emptyState());
    expect(html).toContain('No log entries');
  });
});

// ── SystemControlsPanel ─────────────────────────────────────────────

describe('SystemControlsPanel', () => {
  const panel = new SystemControlsPanel();

  it('renders start/stop/pause buttons', () => {
    const html = panel.render(emptyState());
    expect(html).toContain('data-action="start"');
    expect(html).toContain('data-action="stop"');
    expect(html).toContain('data-action="pause"');
    expect(html).toContain('Start');
    expect(html).toContain('Stop');
    expect(html).toContain('Pause');
  });

  it('renders mode selector with all operating modes', () => {
    const html = panel.render(emptyState());
    expect(html).toContain('structured');
    expect(html).toContain('guided autonomy');
    expect(html).toContain('free thinking');
    expect(html).toContain('data-action="mode"');
  });

  it('renders emergency stop button', () => {
    const html = panel.render(emptyState());
    expect(html).toContain('EMERGENCY STOP');
    expect(html).toContain('data-action="emergency-stop"');
    expect(html).toContain(EGYPTIAN_THEME.colors.hieroglyphRed);
  });
});
