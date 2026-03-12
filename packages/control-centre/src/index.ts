export { EGYPTIAN_THEME } from './theme.js';
export type { EgyptianTheme, ThemeColors, ThemeFonts, ThemePanels } from './theme.js';

export { createDashboardApp } from './app.js';
export type { DashboardApp, DashboardAppOptions } from './app.js';

export { WebSocketClient } from './websocket-client.js';
export type {
  ConnectionStatus,
  EventHandler,
  WebSocketClientConfig,
  DashboardState,
} from './websocket-client.js';

export { HotReloadWatcher } from './hot-reload.js';
export type { HotReloadOptions } from './hot-reload.js';

export {
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
} from './panels/index.js';
export type { ResourceThresholdConfig, LogEntry } from './panels/index.js';
