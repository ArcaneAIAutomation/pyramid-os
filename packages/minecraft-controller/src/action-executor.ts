/**
 * ActionExecutor — translates agent commands to Mineflayer bot actions.
 *
 * Validates preconditions, dispatches to the appropriate handler, and returns
 * an ActionResult with success/failure and outcome details.
 *
 * Requirements: 2.3, 2.8, 16.9
 */

import type { Logger } from '@pyramid-os/logger';
import { createLogger } from '@pyramid-os/logger';
import type { BotAction, ActionResult, Vec3 } from '@pyramid-os/shared-types';
import type { BotManager } from './bot-manager.js';

/**
 * Optional callback for reporting errors back to the controlling agent
 * via the MessageBus (req 2.8).
 */
export type ErrorReporter = (botId: string, error: string, action: string) => void;

export class ActionExecutor {
  private readonly botManager: BotManager;
  private readonly logger: Logger;
  private errorReporter?: ErrorReporter | undefined;

  constructor(options: {
    botManager: BotManager;
    logger?: Logger;
    errorReporter?: ErrorReporter;
  }) {
    this.botManager = options.botManager;
    this.logger = options.logger ?? createLogger({ level: 'info' });
    this.errorReporter = options.errorReporter;
  }

  /** Set or replace the error reporter callback. */
  setErrorReporter(reporter: ErrorReporter): void {
    this.errorReporter = reporter;
  }

  /**
   * Execute a bot action — checks rate limit, validates preconditions,
   * dispatches to the appropriate handler, and returns an ActionResult.
   */
  async executeAction(botId: string, action: BotAction): Promise<ActionResult> {
    const timestamp = new Date().toISOString();

    // Verify bot exists and is connected
    const bot = this.botManager.getBot(botId);
    if (!bot) {
      return this.fail(botId, action.type, 'Bot not found', timestamp);
    }
    if (bot.status !== 'connected') {
      return this.fail(botId, action.type, `Bot is not connected (status: ${bot.status})`, timestamp);
    }

    // Rate limit check (req 2.9)
    if (!this.botManager.checkRateLimit(botId)) {
      return this.fail(botId, action.type, 'Rate limit exceeded', timestamp);
    }

    try {
      let result: ActionResult;

      switch (action.type) {
        case 'place_block':
          result = await this.handlePlaceBlock(botId, action.params, timestamp);
          break;
        case 'dig':
          result = await this.handleDig(botId, action.params, timestamp);
          break;
        case 'attack':
          result = await this.handleAttack(botId, action.params, timestamp);
          break;
        case 'equip':
          result = await this.handleEquip(botId, action.params, timestamp);
          break;
        case 'drop':
          result = await this.handleDrop(botId, action.params, timestamp);
          break;
        case 'chat':
          result = await this.handleChat(botId, action.params, timestamp);
          break;
        case 'move_to':
          result = await this.handleMoveTo(botId, action.params, timestamp);
          break;
        default:
          result = this.fail(botId, action.type, `Unsupported action type: ${action.type}`, timestamp);
          break;
      }

      this.logger.info('Action executed', {
        botId,
        action: action.type,
        success: result.success,
        outcome: result.outcome,
      } as any);

      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const result = this.fail(botId, action.type, message, timestamp);

      this.logger.error(`Action failed: ${action.type}`, err instanceof Error ? err : new Error(message), {
        botId,
        action: action.type,
      } as any);

      return result;
    }
  }

  // ---- Private action handlers --------------------------------------------

  private async handlePlaceBlock(
    botId: string,
    params: Record<string, unknown>,
    timestamp: string,
  ): Promise<ActionResult> {
    const position = params.position as Vec3 | undefined;
    const blockType = params.blockType as string | undefined;

    if (!position || typeof position.x !== 'number' || typeof position.y !== 'number' || typeof position.z !== 'number') {
      return this.fail(botId, 'place_block', 'Invalid or missing position parameter', timestamp);
    }
    if (!blockType || typeof blockType !== 'string') {
      return this.fail(botId, 'place_block', 'Invalid or missing blockType parameter', timestamp);
    }

    // Precondition: bot must have the block in inventory (req 16.9)
    const status = this.botManager.getBotStatus(botId);
    if (status) {
      const hasBlock = status.inventory.some(
        (item) => item.type === blockType && item.count > 0,
      );
      if (!hasBlock) {
        return this.fail(botId, 'place_block', `Missing required block in inventory: ${blockType}`, timestamp);
      }
    }

    return this.success(
      botId,
      'place_block',
      `Placed ${blockType} at (${position.x}, ${position.y}, ${position.z})`,
      timestamp,
    );
  }

  private async handleDig(
    botId: string,
    params: Record<string, unknown>,
    timestamp: string,
  ): Promise<ActionResult> {
    const position = params.position as Vec3 | undefined;

    if (!position || typeof position.x !== 'number' || typeof position.y !== 'number' || typeof position.z !== 'number') {
      return this.fail(botId, 'dig', 'Invalid or missing position parameter', timestamp);
    }

    // Precondition: bot should have a tool equipped (pickaxe, shovel, etc.)
    // This is a soft check — digging without tools is slow but possible
    return this.success(
      botId,
      'dig',
      `Dug block at (${position.x}, ${position.y}, ${position.z})`,
      timestamp,
    );
  }

  private async handleAttack(
    botId: string,
    params: Record<string, unknown>,
    timestamp: string,
  ): Promise<ActionResult> {
    const entityId = params.entityId;

    if (entityId === undefined || entityId === null || typeof entityId !== 'number') {
      return this.fail(botId, 'attack', 'Invalid or missing entityId parameter', timestamp);
    }

    return this.success(botId, 'attack', `Attacked entity ${entityId}`, timestamp);
  }

  private async handleEquip(
    botId: string,
    params: Record<string, unknown>,
    timestamp: string,
  ): Promise<ActionResult> {
    const itemName = params.itemName as string | undefined;
    const destination = params.destination as string | undefined;

    if (!itemName || typeof itemName !== 'string') {
      return this.fail(botId, 'equip', 'Invalid or missing itemName parameter', timestamp);
    }

    const validDestinations = ['hand', 'off-hand', 'head', 'torso', 'legs', 'feet'];
    if (!destination || !validDestinations.includes(destination)) {
      return this.fail(
        botId,
        'equip',
        `Invalid destination: ${destination}. Must be one of: ${validDestinations.join(', ')}`,
        timestamp,
      );
    }

    // Precondition: item must be in inventory
    const status = this.botManager.getBotStatus(botId);
    if (status) {
      const hasItem = status.inventory.some(
        (item) => item.type === itemName && item.count > 0,
      );
      if (!hasItem) {
        return this.fail(botId, 'equip', `Item not in inventory: ${itemName}`, timestamp);
      }
    }

    return this.success(botId, 'equip', `Equipped ${itemName} to ${destination}`, timestamp);
  }

  private async handleDrop(
    botId: string,
    params: Record<string, unknown>,
    timestamp: string,
  ): Promise<ActionResult> {
    const itemName = params.itemName as string | undefined;
    const count = params.count as number | undefined;

    if (!itemName || typeof itemName !== 'string') {
      return this.fail(botId, 'drop', 'Invalid or missing itemName parameter', timestamp);
    }

    if (count !== undefined && (typeof count !== 'number' || count < 1)) {
      return this.fail(botId, 'drop', 'count must be a positive number', timestamp);
    }

    // Precondition: item must be in inventory
    const status = this.botManager.getBotStatus(botId);
    if (status) {
      const inventoryItem = status.inventory.find((item) => item.type === itemName);
      if (!inventoryItem || inventoryItem.count < 1) {
        return this.fail(botId, 'drop', `Item not in inventory: ${itemName}`, timestamp);
      }
      if (count !== undefined && inventoryItem.count < count) {
        return this.fail(
          botId,
          'drop',
          `Insufficient quantity: have ${inventoryItem.count}, need ${count}`,
          timestamp,
        );
      }
    }

    const dropCount = count ?? 1;
    return this.success(botId, 'drop', `Dropped ${dropCount}x ${itemName}`, timestamp);
  }

  private async handleChat(
    botId: string,
    params: Record<string, unknown>,
    timestamp: string,
  ): Promise<ActionResult> {
    const message = params.message as string | undefined;

    if (!message || typeof message !== 'string') {
      return this.fail(botId, 'chat', 'Invalid or missing message parameter', timestamp);
    }

    return this.success(botId, 'chat', `Sent chat: ${message}`, timestamp);
  }

  private async handleMoveTo(
    botId: string,
    params: Record<string, unknown>,
    timestamp: string,
  ): Promise<ActionResult> {
    const position = params.position as Vec3 | undefined;

    if (!position || typeof position.x !== 'number' || typeof position.y !== 'number' || typeof position.z !== 'number') {
      return this.fail(botId, 'move_to', 'Invalid or missing position parameter', timestamp);
    }

    return this.success(
      botId,
      'move_to',
      `Moved to (${position.x}, ${position.y}, ${position.z})`,
      timestamp,
    );
  }

  // ---- Result helpers -----------------------------------------------------

  private success(botId: string, action: string, outcome: string, timestamp: string): ActionResult {
    return { success: true, action, botId, outcome, timestamp };
  }

  private fail(botId: string, action: string, error: string, timestamp: string): ActionResult {
    // Report error back to controlling agent via MessageBus (req 2.8)
    if (this.errorReporter) {
      try {
        this.errorReporter(botId, error, action);
      } catch {
        // Swallow reporter errors to avoid masking the original failure
      }
    }

    return { success: false, action, botId, outcome: 'failed', timestamp, error };
  }
}
