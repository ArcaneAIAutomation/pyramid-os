/**
 * System control route handlers for PYRAMID OS API.
 * POST /system/start — start the system
 * POST /system/stop — stop the system
 * POST /system/pause — pause operations
 * POST /system/mode — change operating mode
 * POST /system/recover — recover from latest valid snapshot
 */

import type { FastifyInstance } from 'fastify';
import type { ServiceContext } from './context.js';
import type {
  ApiError,
  SetModeRequest,
  OperatingMode,
} from '@pyramid-os/shared-types';

const VALID_MODES: OperatingMode[] = ['structured', 'guided_autonomy', 'free_thinking'];

export async function systemRoutes(
  server: FastifyInstance,
  ctx: ServiceContext,
): Promise<void> {
  server.post('/system/start', async () => {
    if (ctx.openclaw) {
      // Delegate to OpenClaw when wired
    }

    return { started: true, message: 'System started' };
  });

  server.post('/system/stop', async () => {
    if (ctx.openclaw) {
      await ctx.openclaw.shutdown();
    }

    return { stopped: true, message: 'System stopped' };
  });

  server.post('/system/pause', async () => {
    return { paused: true, message: 'System paused' };
  });

  server.post('/system/mode', async (request, reply) => {
    const body = request.body as SetModeRequest | undefined;

    if (!body?.mode) {
      const error: ApiError = {
        statusCode: 400,
        error: 'Bad Request',
        message: 'Request body must include a "mode" field',
        code: 'MISSING_MODE',
      };
      return reply.status(400).send(error);
    }

    if (!VALID_MODES.includes(body.mode)) {
      const error: ApiError = {
        statusCode: 400,
        error: 'Bad Request',
        message: `Invalid mode '${body.mode}'. Must be one of: ${VALID_MODES.join(', ')}`,
        code: 'INVALID_MODE',
        details: { validModes: VALID_MODES },
      };
      return reply.status(400).send(error);
    }

    if (ctx.openclaw) {
      await ctx.openclaw.setOperatingMode(body.mode);
    }

    return { mode: body.mode, message: `Operating mode changed to '${body.mode}'` };
  });

  server.post('/system/recover', async (_request, reply) => {
    if (!ctx.snapshotManager) {
      const error: ApiError = {
        statusCode: 503,
        error: 'Service Unavailable',
        message: 'Snapshot manager is not available',
        code: 'SNAPSHOT_MANAGER_UNAVAILABLE',
      };
      return reply.status(503).send(error);
    }

    const snapshots = await ctx.snapshotManager.list();
    if (snapshots.length === 0) {
      const error: ApiError = {
        statusCode: 404,
        error: 'Not Found',
        message: 'No snapshots available for recovery',
        code: 'NO_SNAPSHOTS',
      };
      return reply.status(404).send(error);
    }

    // Sort by exportedAt descending to find the most recent
    const sorted = [...snapshots].sort(
      (a, b) => new Date(b.exportedAt).getTime() - new Date(a.exportedAt).getTime(),
    );

    // Find the most recent valid snapshot by reading, validating, and importing
    for (const info of sorted) {
      try {
        const snapshot = await ctx.snapshotManager.readSnapshot(info.filename);
        const validation = ctx.snapshotManager.validate(snapshot);
        if (!validation.valid) continue;

        await ctx.snapshotManager.import(snapshot);
        return {
          recovered: true,
          snapshot: info.filename,
          exportedAt: info.exportedAt,
          message: `System recovered from snapshot '${info.filename}'`,
        };
      } catch {
        // Skip invalid snapshots and try the next one
        continue;
      }
    }

    const error: ApiError = {
      statusCode: 404,
      error: 'Not Found',
      message: 'No valid snapshots found for recovery',
      code: 'NO_VALID_SNAPSHOTS',
    };
    return reply.status(404).send(error);
  });
}
