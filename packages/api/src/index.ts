export { createServer } from './server.js';
export type { ServerConfig } from './server.js';
export { authPlugin } from './auth.js';
export type { AuthPluginOptions } from './auth.js';
export { registerRoutes } from './routes/index.js';
export type { ServiceContext } from './routes/index.js';
export { WebSocketServer } from './websocket.js';
export { HealthChecker, createCheck } from './health.js';
export type {
  HealthCheckResult,
  SystemHealth,
  CheckFn,
  OnCriticalCallback,
  PersistFn,
  HealthCheckerOptions,
} from './health.js';
