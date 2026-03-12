/**
 * MessageBus — Inter-agent communication with hierarchy enforcement.
 *
 * Validates: Requirements 1.7, 24.1, 24.2, 24.3, 24.4, 24.5, 24.6, 24.7, 24.8, 24.9, 24.10
 *
 * Hierarchy rules:
 *   Planner (tier 0)     → can send to Operational and Worker
 *   Operational (tier 1) → can send to Worker, can respond to Planner
 *   Worker (tier 2)      → can only respond to Operational (cannot initiate to Planner)
 *
 * Broadcast is restricted to Planner-tier agents only.
 */

import type { AgentTier, AgentMessage } from '@pyramid-os/shared-types';
import type { Logger } from '@pyramid-os/logger';

/** Resolves an agent ID to its tier, or undefined if unknown. */
export type TierResolver = (agentId: string) => AgentTier | undefined;

/** Callback for logging messages to the agent_messages table. */
export type MessageLogger = (entry: {
  id: string;
  senderId: string;
  receiverId: string | null;
  content: string;
  messageType: string;
  correlationId?: string;
}) => void;

/** Numeric ordering used for hierarchy comparison. */
const TIER_RANK: Record<AgentTier, number> = {
  planner: 0,
  operational: 1,
  worker: 2,
};

/**
 * Determine whether `fromTier` is allowed to send a message to `toTier`.
 *
 * - Planner → Operational ✓, Planner → Worker ✓
 * - Operational → Worker ✓, Operational → Planner ✓ (response)
 * - Worker → Operational ✓ (response), Worker → Planner ✗
 */
function isHierarchyAllowed(fromTier: AgentTier, toTier: AgentTier): boolean {
  const fromRank = TIER_RANK[fromTier];
  const toRank = TIER_RANK[toTier];

  // Planner can send to anyone
  if (fromRank === 0) return true;

  // Operational can send to Worker (down) or respond to Planner (up one level)
  if (fromRank === 1) return true;

  // Worker can only respond to Operational (up one level), NOT to Planner
  if (fromRank === 2) return toRank === 1;

  return false;
}

export class MessageBusImpl {
  private readonly resolveTier: TierResolver;
  private readonly logger: Logger;
  private readonly messageLogger: MessageLogger | undefined;

  /** Registered message handlers keyed by agentId. */
  private readonly handlers = new Map<string, (msg: AgentMessage) => void>();

  /** Queued messages for agents that are not currently subscribed. */
  private readonly queues = new Map<string, AgentMessage[]>();

  /** Pending request-response waiters keyed by correlationId. */
  private readonly pendingRequests = new Map<
    string,
    { resolve: (msg: AgentMessage) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout>; requesterId: string }
  >();

  constructor(resolveTier: TierResolver, logger: Logger, messageLogger?: MessageLogger) {
    this.resolveTier = resolveTier;
    this.logger = logger;
    this.messageLogger = messageLogger ?? undefined;
  }

  /**
   * Send a message from one agent to another.
   * Validates hierarchy, queues if recipient is unavailable.
   */
  async send(message: AgentMessage): Promise<void> {
    const fromTier = this.resolveTier(message.from);
    const toTier = this.resolveTier(message.to);

    if (!fromTier) {
      throw new Error(`Unknown sender agent: ${message.from}`);
    }
    if (!toTier) {
      throw new Error(`Unknown recipient agent: ${message.to}`);
    }

    if (!isHierarchyAllowed(fromTier, toTier)) {
      this.logger.warn(`Hierarchy violation: ${fromTier} (${message.from}) → ${toTier} (${message.to})`);
      throw new Error(
        `Hierarchy violation: ${fromTier} agent "${message.from}" cannot send to ${toTier} agent "${message.to}"`,
      );
    }

    // Log to agent_messages table
    this.logMessage(message, 'directive');

    this.logger.info(`Message sent: ${message.from} → ${message.to}`, {
      ...(message.correlationId !== undefined ? { correlationId: message.correlationId } : {}),
    });

    // Check if this message is a response to a pending request-response.
    // A pending request is only resolved when the response is addressed *to*
    // the original requester (message.to matches the waiter's agent).
    if (message.correlationId) {
      const pending = this.pendingRequests.get(message.correlationId);
      if (pending && pending.requesterId === message.to) {
        clearTimeout(pending.timer);
        this.pendingRequests.delete(message.correlationId);
        pending.resolve(message);
        return;
      }
    }

    // Deliver or queue
    this.deliverOrQueue(message);
  }

  /**
   * Broadcast a message from a Planner-tier agent to all registered agents.
   * Only Planner agents are allowed to broadcast.
   */
  async broadcast(fromAgentId: string, message: Omit<AgentMessage, 'to'>): Promise<void> {
    const fromTier = this.resolveTier(fromAgentId);

    if (!fromTier) {
      throw new Error(`Unknown sender agent: ${fromAgentId}`);
    }

    if (fromTier !== 'planner') {
      this.logger.warn(`Broadcast denied: only planner agents can broadcast (got ${fromTier})`);
      throw new Error(`Broadcast denied: only planner-tier agents can broadcast. Agent "${fromAgentId}" is ${fromTier}.`);
    }

    // Log broadcast
    this.logMessage({ ...message, to: '__broadcast__' } as AgentMessage, 'broadcast');

    this.logger.info(`Broadcast from ${fromAgentId} to all agents`, {
      ...(message.correlationId !== undefined ? { correlationId: message.correlationId } : {}),
    });

    // Deliver to all registered handlers (except the sender)
    for (const [agentId, handler] of this.handlers) {
      if (agentId === fromAgentId) continue;
      const fullMessage: AgentMessage = { ...message, to: agentId } as AgentMessage;
      try {
        handler(fullMessage);
      } catch (err) {
        this.logger.error(
          `Error delivering broadcast to ${agentId}`,
          err instanceof Error ? err : new Error(String(err)),
        );
      }
    }
  }

  /**
   * Register a message handler for an agent.
   * Also delivers any queued messages immediately.
   */
  subscribe(agentId: string, handler: (message: AgentMessage) => void): void {
    this.handlers.set(agentId, handler);
    this.logger.info(`Agent subscribed: ${agentId}`);

    // Flush queued messages
    const queued = this.queues.get(agentId);
    if (queued && queued.length > 0) {
      this.queues.delete(agentId);
      for (const msg of queued) {
        try {
          handler(msg);
        } catch (err) {
          this.logger.error(
            `Error delivering queued message to ${agentId}`,
            err instanceof Error ? err : new Error(String(err)),
          );
        }
      }
    }
  }

  /** Remove a message handler for an agent. */
  unsubscribe(agentId: string): void {
    this.handlers.delete(agentId);
    this.logger.info(`Agent unsubscribed: ${agentId}`);
  }

  /** Get queued messages for an agent (without removing them). */
  getQueuedMessages(agentId: string): AgentMessage[] {
    return this.queues.get(agentId) ?? [];
  }

  /**
   * Send a message and wait for a correlated response.
   * Uses the message's correlationId to match the response.
   * @param timeoutMs — defaults to 30000ms
   */
  async sendAndWait(message: AgentMessage, timeoutMs = 30000): Promise<AgentMessage> {
    if (!message.correlationId) {
      throw new Error('sendAndWait requires a correlationId on the message');
    }

    const correlationId = message.correlationId;

    return new Promise<AgentMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(correlationId);
        reject(new Error(`Request timed out after ${timeoutMs}ms (correlationId: ${correlationId})`));
      }, timeoutMs);

      this.pendingRequests.set(correlationId, { resolve, reject, timer, requesterId: message.from });

      // Send the message (which validates hierarchy, etc.)
      this.send(message).catch((err) => {
        clearTimeout(timer);
        this.pendingRequests.delete(correlationId);
        reject(err);
      });
    });
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private deliverOrQueue(message: AgentMessage): void {
    const handler = this.handlers.get(message.to);
    if (handler) {
      try {
        handler(message);
      } catch (err) {
        this.logger.error(
          `Error delivering message to ${message.to}`,
          err instanceof Error ? err : new Error(String(err)),
        );
      }
    } else {
      // Queue for later delivery
      let queue = this.queues.get(message.to);
      if (!queue) {
        queue = [];
        this.queues.set(message.to, queue);
      }
      queue.push(message);
      this.logger.info(`Message queued for unavailable agent: ${message.to}`);
    }
  }

  private logMessage(message: AgentMessage, messageType: string): void {
    if (this.messageLogger) {
      this.messageLogger({
        id: message.id,
        senderId: message.from,
        receiverId: message.to === '__broadcast__' ? null : message.to,
        content: message.content,
        messageType,
        ...(message.correlationId !== undefined ? { correlationId: message.correlationId } : {}),
      });
    }
  }
}
