/**
 * WebSocket client for PYRAMID OS Control Centre real-time updates.
 *
 * Connects to the API WebSocket server and dispatches incoming events
 * to registered handlers. Implements reconnection with exponential backoff
 * on connection drop and tracks connection status.
 *
 * Requirements: 5.8, 34.6, 34.7
 */

import type {
  WebSocketEvent,
  AgentStatus,
  TaskResult,
  AlertSeverity,
  HealthStatus,
} from '@pyramid-os/shared-types';

/** Connection status of the WebSocket client */
export type ConnectionStatus = 'connected' | 'disconnected' | 'reconnecting';

/** Handler function for a specific WebSocket event type */
export type EventHandler<T extends WebSocketEvent = WebSocketEvent> = (event: T) => void;

/** Configuration for the WebSocket client */
export interface WebSocketClientConfig {
  /** WebSocket server URL, e.g. ws://localhost:3000/ws */
  url: string;
  /** API key for authentication */
  apiKey: string;
  /** Initial reconnection delay in ms (default: 1000) */
  initialReconnectDelayMs?: number;
  /** Maximum reconnection delay in ms (default: 30000) */
  maxReconnectDelayMs?: number;
  /** Maximum number of reconnection attempts before giving up (default: Infinity) */
  maxReconnectAttempts?: number;
}

/** Local state maintained from WebSocket events */
export interface DashboardState {
  agents: Map<string, AgentStatus>;
  resources: Map<string, number>;
  builds: Map<string, number>;
  bots: Map<string, { connected: boolean; server?: string; reason?: string }>;
  alerts: Array<{ severity: AlertSeverity; message: string; receivedAt: number }>;
  health: Map<string, HealthStatus>;
  ceremonies: Set<string>;
  completedTasks: Array<TaskResult>;
  /** Active civilization name displayed prominently (Req 32.10) */
  activeCivilization: string | null;
}

/** Extract the event type for a specific WebSocketEvent `type` discriminant */
type EventOfType<T extends WebSocketEvent['type']> = Extract<WebSocketEvent, { type: T }>;

/**
 * WebSocket client that connects to the PYRAMID OS API server,
 * handles all WebSocketEvent types, maintains local dashboard state,
 * and reconnects with exponential backoff on disconnection.
 */
export class WebSocketClient {
  private ws: WebSocket | null = null;
  private _status: ConnectionStatus = 'disconnected';
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private handlers = new Map<string, Set<EventHandler<any>>>();
  private statusListeners = new Set<(status: ConnectionStatus) => void>();
  private _closed = false;

  readonly config: Readonly<WebSocketClientConfig>;
  readonly state: DashboardState;

  /** Initial reconnect delay in ms */
  private readonly initialDelay: number;
  /** Max reconnect delay in ms */
  private readonly maxDelay: number;
  /** Max reconnect attempts */
  private readonly maxAttempts: number;

  constructor(config: WebSocketClientConfig) {
    this.config = Object.freeze({ ...config });
    this.initialDelay = config.initialReconnectDelayMs ?? 1000;
    this.maxDelay = config.maxReconnectDelayMs ?? 30000;
    this.maxAttempts = config.maxReconnectAttempts ?? Infinity;

    this.state = {
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

  /** Current connection status */
  get status(): ConnectionStatus {
    return this._status;
  }

  /**
   * Connect to the WebSocket server.
   * If already connected, this is a no-op.
   */
  connect(): void {
    if (this._closed) return;
    if (this.ws && this._status === 'connected') return;

    this.createConnection();
  }

  /**
   * Disconnect from the WebSocket server and stop reconnection attempts.
   */
  disconnect(): void {
    this._closed = true;
    this.clearReconnectTimer();
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
    this.setStatus('disconnected');
  }

  /**
   * Register a handler for a specific WebSocket event type.
   * Returns an unsubscribe function.
   */
  on<T extends WebSocketEvent['type']>(
    eventType: T,
    handler: EventHandler<EventOfType<T>>,
  ): () => void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    this.handlers.get(eventType)!.add(handler);

    return () => {
      const set = this.handlers.get(eventType);
      if (set) {
        set.delete(handler);
        if (set.size === 0) this.handlers.delete(eventType);
      }
    };
  }

  /**
   * Register a listener for connection status changes.
   * Returns an unsubscribe function.
   */
  onStatusChange(listener: (status: ConnectionStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  /** Number of current reconnection attempts */
  get currentReconnectAttempts(): number {
    return this.reconnectAttempts;
  }

  // ── Internal ──────────────────────────────────────────────────────

  private createConnection(): void {
    const separator = this.config.url.includes('?') ? '&' : '?';
    const urlWithAuth = `${this.config.url}${separator}x-api-key=${this.config.apiKey}`;

    try {
      this.ws = new WebSocket(urlWithAuth);
    } catch {
      this.handleDisconnect();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.setStatus('connected');
    };

    this.ws.onmessage = (event: MessageEvent) => {
      this.handleMessage(event);
    };

    this.ws.onclose = () => {
      this.ws = null;
      if (!this._closed) {
        this.handleDisconnect();
      }
    };

    this.ws.onerror = () => {
      // The close event will fire after error, triggering reconnect
    };
  }

  private handleMessage(event: MessageEvent): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(event.data));
    } catch {
      return; // Ignore malformed messages
    }

    // The server sends batched events as an array
    const events: WebSocketEvent[] = Array.isArray(parsed) ? parsed : [parsed];

    for (const wsEvent of events) {
      if (!wsEvent || typeof wsEvent !== 'object' || !('type' in wsEvent)) continue;
      this.updateState(wsEvent as WebSocketEvent);
      this.dispatchEvent(wsEvent as WebSocketEvent);
    }
  }

  private updateState(event: WebSocketEvent): void {
    switch (event.type) {
      case 'agent:state':
        this.state.agents.set(event.agentId, event.state);
        break;
      case 'task:complete':
        this.state.completedTasks.push(event.result);
        break;
      case 'resource:update':
        this.state.resources.set(event.resourceType, event.level);
        break;
      case 'bot:connect':
        this.state.bots.set(event.botId, { connected: true, server: event.server });
        break;
      case 'bot:disconnect':
        this.state.bots.set(event.botId, { connected: false, reason: event.reason });
        break;
      case 'build:progress':
        this.state.builds.set(event.buildId, event.percent);
        break;
      case 'alert':
        this.state.alerts.push({
          severity: event.severity,
          message: event.message,
          receivedAt: Date.now(),
        });
        break;
      case 'ceremony:start':
        this.state.ceremonies.add(event.ceremonyId);
        break;
      case 'health:update':
        this.state.health.set(event.component, event.status);
        break;
    }
  }

  private dispatchEvent(event: WebSocketEvent): void {
    const set = this.handlers.get(event.type);
    if (set) {
      for (const handler of set) {
        try {
          handler(event);
        } catch {
          // Don't let handler errors break the event loop
        }
      }
    }
  }

  private handleDisconnect(): void {
    if (this._closed) return;

    if (this.reconnectAttempts >= this.maxAttempts) {
      this.setStatus('disconnected');
      return;
    }

    this.setStatus('reconnecting');
    this.scheduleReconnect();
  }

  /**
   * Calculate the reconnect delay using exponential backoff.
   * delay = min(initialDelay * 2^attempts, maxDelay)
   */
  getReconnectDelay(): number {
    const delay = this.initialDelay * Math.pow(2, this.reconnectAttempts);
    return Math.min(delay, this.maxDelay);
  }

  private scheduleReconnect(): void {
    this.clearReconnectTimer();
    const delay = this.getReconnectDelay();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempts++;
      this.createConnection();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private setStatus(status: ConnectionStatus): void {
    if (this._status === status) return;
    this._status = status;
    for (const listener of this.statusListeners) {
      try {
        listener(status);
      } catch {
        // Don't let listener errors propagate
      }
    }
  }
}
