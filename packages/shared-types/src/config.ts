/**
 * Configuration types for PYRAMID OS
 * Defines the shape of the configuration file and all sub-sections
 */

import type { ResourceThreshold } from './resource.js';

/** Ollama LLM server connection settings */
export interface OllamaConfig {
  host: string;
  port: number;
  timeout: number;
  maxConcurrentRequests: number;
}

/** Hard constraints limiting agent autonomy */
export interface SafetyBoundary {
  /** Block types agents are forbidden from placing (e.g. 'tnt', 'lava') */
  prohibitedBlocks: string[];
  /** Server commands agents are forbidden from issuing (e.g. '/op', '/kill') */
  prohibitedCommands: string[];
  /** Maximum time in ms an agent may spend on a single decision */
  maxDecisionTimeMs: number;
  /** Maximum bot actions per second */
  maxActionsPerSecond: number;
  /** Maximum LLM reasoning loops before forced halt */
  maxReasoningLoops: number;
}

/** A saved Minecraft server connection profile */
export interface ConnectionProfile {
  name: string;
  host: string;
  port: number;
  authMethod: 'none' | 'credentials' | 'microsoft';
  credentials?: {
    username: string;
    password: string;
  };
  msToken?: string;
  version?: string;
}

/** Root configuration object for PYRAMID OS */
export interface PyramidConfig {
  ollama: OllamaConfig;
  connections: ConnectionProfile[];
  safety: SafetyBoundary;
  controlCentre: {
    port: number;
    theme: string;
    refreshRateMs: number;
  };
  logging: {
    level: string;
    outputPath: string;
    maxFileSizeMb: number;
  };
  api: {
    port: number;
    apiKey: string;
    rateLimitPerMin: number;
  };
  database: {
    path: string;
    poolSize: number;
  };
  workspace: {
    dataDir: string;
    snapshotsDir: string;
    logsDir: string;
  };
  resourceThresholds?: ResourceThreshold[];
}
