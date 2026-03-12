/**
 * WebSocket server for PYRAMID OS real-time event broadcasting.
 *
 * Supports:
 * - Broadcasting events to all connected clients
 * - Sending events to specific clients
 * - Event batching in 100ms windows to prevent client overload
 * - API key authentication on WebSocket upgrade
 * - Multiple concurrent Control Centre connections
 *
 * Requirements: 34.1, 34.2, 34.3, 34.4, 34.5, 34.8, 34.9, 34.10
 */

import type { FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import type { WebSocket } from 'ws';
import type { WebSocketEvent } from '@pyramid-os/shared-types';

/** Interval in ms for flushing batched events to clients */
const BATCH_INTERVAL_MS = 100;

interface ClientEntry {
  socket: WebSocket;
  /** Buffered events waiting to be flushed */
  buffer: WebSocketEvent[];
}

export class WebSocketServer {
  private readonly apiKey: string;
  private readonly clients = new Map<string, ClientEntry>();
  private batchTimer: ReturnType<typeof setInterval> | null = null;
  private clientCounter = 0;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Register the `/ws` WebSocket route with a Fastify instance.
   * Must be called after the Fastify server is created but before listening.
   */
  async registerWithFastify(server: FastifyInstance): Promise<void> {
    await server.register(websocket);

    server.get('/ws', { websocket: true }, (socket, request) => {
      // Authenticate via query parameter
      const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);
      const key = url.searchParams.get('x-api-key');

      if (key !== this.apiKey) {
        socket.close(4401, 'Unauthorized');
        return;
      }

      const clientId = this.addClient(socket);

      socket.on('close', () => {
        this.removeClient(clientId);
      });

      socket.on('error', () => {
        this.removeClient(clientId);
      });
    });

    this.startBatchTimer();
  }

  /**
   * Broadcast an event to every connected client.
   * Events are buffered and flushed in 100ms batches.
   */
  broadcast(event: WebSocketEvent): void {
    for (const entry of this.clients.values()) {
      entry.buffer.push(event);
    }
  }

  /**
   * Send an event to a specific client by ID.
   * Events are buffered and flushed in 100ms batches.
   */
  send(clientId: string, event: WebSocketEvent): void {
    const entry = this.clients.get(clientId);
    if (entry) {
      entry.buffer.push(event);
    }
  }

  /** Returns the number of currently connected clients. */
  getClientCount(): number {
    return this.clients.size;
  }

  /** Returns a snapshot of all connected client IDs. */
  getClientIds(): string[] {
    return Array.from(this.clients.keys());
  }

  /** Stop the batch timer and close all client connections. */
  close(): void {
    this.stopBatchTimer();
    for (const [id, entry] of this.clients) {
      try {
        entry.socket.close(1000, 'Server shutting down');
      } catch {
        // ignore close errors
      }
      this.clients.delete(id);
    }
  }

  // ── Internal helpers ──────────────────────────────────────────────

  private addClient(socket: WebSocket): string {
    this.clientCounter += 1;
    const clientId = `client-${this.clientCounter}`;
    this.clients.set(clientId, { socket, buffer: [] });
    return clientId;
  }

  private removeClient(clientId: string): void {
    this.clients.delete(clientId);
  }

  private startBatchTimer(): void {
    if (this.batchTimer) return;
    this.batchTimer = setInterval(() => this.flushAll(), BATCH_INTERVAL_MS);
    // Allow the process to exit even if the timer is still running
    if (this.batchTimer && typeof this.batchTimer === 'object' && 'unref' in this.batchTimer) {
      this.batchTimer.unref();
    }
  }

  private stopBatchTimer(): void {
    if (this.batchTimer) {
      clearInterval(this.batchTimer);
      this.batchTimer = null;
    }
  }

  /** Flush buffered events for every client. */
  private flushAll(): void {
    for (const entry of this.clients.values()) {
      if (entry.buffer.length === 0) continue;

      const batch = entry.buffer.splice(0);
      try {
        if (entry.socket.readyState === 1 /* WebSocket.OPEN */) {
          entry.socket.send(JSON.stringify(batch));
        }
      } catch {
        // Swallow send errors — client will be cleaned up on close/error
      }
    }
  }
}
