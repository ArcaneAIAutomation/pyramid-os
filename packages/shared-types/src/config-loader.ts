/**
 * Configuration loader for PYRAMID OS
 * Supports YAML and JSON config files with Zod validation and env var overrides.
 */

import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import yaml from 'js-yaml';
import { z } from 'zod';
import type { PyramidConfig } from './config.js';
import { createPyramidError } from './errors.js';

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const OllamaConfigSchema = z.object({
  host: z.string().min(1, 'ollama.host must be a non-empty string'),
  port: z.number().int().min(1).max(65535, 'ollama.port must be between 1 and 65535'),
  timeout: z.number().positive('ollama.timeout must be greater than 0'),
  maxConcurrentRequests: z
    .number()
    .int()
    .positive('ollama.maxConcurrentRequests must be greater than 0'),
});

const ConnectionProfileSchema = z.object({
  name: z.string().min(1, 'connections[].name must be a non-empty string'),
  host: z.string().min(1, 'connections[].host must be a non-empty string'),
  port: z.number().int().min(1).max(65535, 'connections[].port must be between 1 and 65535'),
  authMethod: z.enum(['none', 'credentials', 'microsoft'], {
    errorMap: () => ({
      message: "connections[].authMethod must be 'none', 'credentials', or 'microsoft'",
    }),
  }),
  credentials: z
    .object({
      username: z.string().min(1),
      password: z.string().min(1),
    })
    .optional(),
  msToken: z.string().optional(),
  version: z.string().optional(),
});

const SafetyBoundarySchema = z.object({
  prohibitedBlocks: z.array(z.string(), {
    invalid_type_error: 'safety.prohibitedBlocks must be an array of strings',
  }),
  prohibitedCommands: z.array(z.string(), {
    invalid_type_error: 'safety.prohibitedCommands must be an array of strings',
  }),
  maxDecisionTimeMs: z.number().positive('safety.maxDecisionTimeMs must be greater than 0'),
  maxActionsPerSecond: z.number().positive('safety.maxActionsPerSecond must be greater than 0'),
  maxReasoningLoops: z.number().int().positive('safety.maxReasoningLoops must be greater than 0'),
});

const ResourceThresholdSchema = z.object({
  resourceType: z.string().min(1),
  minimum: z.number().nonnegative(),
  critical: z.number().nonnegative(),
});

const PyramidConfigSchema = z.object({
  ollama: OllamaConfigSchema,
  connections: z.array(ConnectionProfileSchema),
  safety: SafetyBoundarySchema,
  controlCentre: z.object({
    port: z.number().int().min(1).max(65535, 'controlCentre.port must be between 1 and 65535'),
    theme: z.string().min(1, 'controlCentre.theme must be a non-empty string'),
    refreshRateMs: z.number().positive('controlCentre.refreshRateMs must be greater than 0'),
  }),
  logging: z.object({
    level: z.enum(['debug', 'info', 'warn', 'error'], {
      errorMap: () => ({
        message: "logging.level must be one of 'debug', 'info', 'warn', 'error'",
      }),
    }),
    outputPath: z.string().min(1, 'logging.outputPath must be a non-empty string'),
    maxFileSizeMb: z.number().positive('logging.maxFileSizeMb must be greater than 0'),
  }),
  api: z.object({
    port: z.number().int().min(1).max(65535, 'api.port must be between 1 and 65535'),
    apiKey: z.string().min(1, 'api.apiKey must be a non-empty string'),
    rateLimitPerMin: z.number().int().positive('api.rateLimitPerMin must be greater than 0'),
  }),
  database: z.object({
    path: z.string().min(1, 'database.path must be a non-empty string'),
    poolSize: z.number().int().positive('database.poolSize must be greater than 0'),
  }),
  workspace: z.object({
    dataDir: z.string().min(1, 'workspace.dataDir must be a non-empty string'),
    snapshotsDir: z.string().min(1, 'workspace.snapshotsDir must be a non-empty string'),
    logsDir: z.string().min(1, 'workspace.logsDir must be a non-empty string'),
  }),
  resourceThresholds: z.array(ResourceThresholdSchema).optional(),
});

// ---------------------------------------------------------------------------
// Environment variable substitution
// ---------------------------------------------------------------------------

/**
 * Recursively walk a parsed object and replace any string value matching
 * `${VAR_NAME}` with the corresponding environment variable.
 * Throws if the variable is not set.
 */
function substituteEnvVars(value: unknown, path = ''): unknown {
  if (typeof value === 'string') {
    return value.replace(/\$\{([^}]+)\}/g, (_match, varName: string) => {
      const envValue = process.env[varName];
      if (envValue === undefined) {
        throw new Error(
          `Environment variable "${varName}" referenced in config at "${path}" is not set`,
        );
      }
      return envValue;
    });
  }

  if (Array.isArray(value)) {
    return value.map((item, i) => substituteEnvVars(item, `${path}[${i}]`));
  }

  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = substituteEnvVars(val, path ? `${path}.${key}` : key);
    }
    return result;
  }

  return value;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load and validate a PYRAMID OS configuration file.
 *
 * @param filePath - Absolute or relative path to a `.yaml`, `.yml`, or `.json` file.
 * @returns A fully validated `PyramidConfig` object.
 * @throws If the file cannot be read, parsed, or fails schema validation.
 */
export function loadConfig(filePath: string): PyramidConfig {
  // 1. Read file
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch (err) {
    throw createPyramidError(
      'PYRAMID_CONFIG_MISSING_FILE',
      { filePath },
      err instanceof Error ? err : undefined,
    );
  }

  // 2. Parse YAML or JSON
  const ext = extname(filePath).toLowerCase();
  let parsed: unknown;
  try {
    if (ext === '.json') {
      parsed = JSON.parse(raw) as unknown;
    } else if (ext === '.yaml' || ext === '.yml') {
      parsed = yaml.load(raw);
    } else {
      throw createPyramidError(
        'PYRAMID_CONFIG_INVALID_FIELD',
        { filePath, field: 'fileExtension', value: ext, reason: `Unsupported config file extension "${ext}". Use .yaml, .yml, or .json` },
      );
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'PyramidError') throw err;
    throw createPyramidError(
      'PYRAMID_CONFIG_INVALID_FIELD',
      { filePath, reason: `Failed to parse: ${err instanceof Error ? err.message : String(err)}` },
      err instanceof Error ? err : undefined,
    );
  }

  // 3. Substitute environment variables
  let substituted: unknown;
  try {
    substituted = substituteEnvVars(parsed);
  } catch (err) {
    throw createPyramidError(
      'PYRAMID_CONFIG_INVALID_FIELD',
      { filePath, reason: `Environment variable substitution failed: ${err instanceof Error ? err.message : String(err)}` },
      err instanceof Error ? err : undefined,
    );
  }

  // 4. Validate with Zod
  const result = PyramidConfigSchema.safeParse(substituted);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => {
        const fieldPath = issue.path.join('.');
        return fieldPath ? `  - ${fieldPath}: ${issue.message}` : `  - ${issue.message}`;
      })
      .join('\n');
    throw createPyramidError(
      'PYRAMID_CONFIG_INVALID_FIELD',
      {
        filePath,
        validationErrors: result.error.issues.map((i) => ({
          field: i.path.join('.'),
          message: i.message,
        })),
      },
    );
  }

  return result.data as PyramidConfig;
}
