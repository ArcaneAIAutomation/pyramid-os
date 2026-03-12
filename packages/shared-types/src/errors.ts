/**
 * Structured error handling for PYRAMID OS.
 *
 * Error codes follow the pattern PYRAMID_{CATEGORY}_{SPECIFIC}.
 * The ERROR_REGISTRY maps each code to a default message, remediation steps,
 * severity, and category so callers only need to supply the code.
 */

// ---------------------------------------------------------------------------
// ErrorCategory
// ---------------------------------------------------------------------------

export enum ErrorCategory {
  CONFIG = 'CONFIG',
  CONNECTION = 'CONNECTION',
  AGENT = 'AGENT',
  TASK = 'TASK',
  RESOURCE = 'RESOURCE',
  BLUEPRINT = 'BLUEPRINT',
  DATABASE = 'DATABASE',
  OLLAMA = 'OLLAMA',
  MINECRAFT = 'MINECRAFT',
  PLUGIN = 'PLUGIN',
  SECURITY = 'SECURITY',
  SYSTEM = 'SYSTEM',
}

// ---------------------------------------------------------------------------
// ErrorSeverity
// ---------------------------------------------------------------------------

export type ErrorSeverity = 'critical' | 'error' | 'warning' | 'info';

// ---------------------------------------------------------------------------
// PyramidError
// ---------------------------------------------------------------------------

export class PyramidError extends Error {
  /** Machine-readable error code (e.g. PYRAMID_CONFIG_INVALID_FIELD) */
  readonly code: string;
  /** Error category */
  readonly category: ErrorCategory;
  /** Severity level */
  readonly severity: ErrorSeverity;
  /** Suggested remediation steps */
  readonly remediation?: string[];
  /** Link to troubleshooting docs */
  readonly docsUrl?: string;
  /** Additional context (config field path, component name, etc.) */
  readonly context: Record<string, unknown>;
  /** Original error if wrapping */
  override readonly cause?: Error;
  /** Timestamp of when the error occurred */
  readonly timestamp: Date;

  constructor(opts: {
    code: string;
    category: ErrorCategory;
    severity: ErrorSeverity;
    message: string;
    remediation?: string[];
    docsUrl?: string;
    context?: Record<string, unknown>;
    cause?: Error;
    timestamp?: Date;
  }) {
    super(opts.message);
    this.name = 'PyramidError';
    this.code = opts.code;
    this.category = opts.category;
    this.severity = opts.severity;
    if (opts.remediation !== undefined) this.remediation = opts.remediation;
    if (opts.docsUrl !== undefined) this.docsUrl = opts.docsUrl;
    this.context = opts.context ?? {};
    if (opts.cause !== undefined) this.cause = opts.cause;
    this.timestamp = opts.timestamp ?? new Date();
  }
}

// ---------------------------------------------------------------------------
// ErrorRegistryEntry
// ---------------------------------------------------------------------------

export interface ErrorRegistryEntry {
  message: string;
  remediation: string[];
  severity: ErrorSeverity;
  category: ErrorCategory;
}

// ---------------------------------------------------------------------------
// ERROR_REGISTRY
// ---------------------------------------------------------------------------

export const ERROR_REGISTRY: Record<string, ErrorRegistryEntry> = {
  // Config errors
  PYRAMID_CONFIG_INVALID_FIELD: {
    message: 'Configuration field is invalid',
    remediation: ['Check the field value in config/default.yaml', 'Run: pyramid-os config validate'],
    severity: 'error',
    category: ErrorCategory.CONFIG,
  },
  PYRAMID_CONFIG_MISSING_FILE: {
    message: 'Configuration file not found',
    remediation: ['Create config/default.yaml from the example', 'Run: pyramid-os config validate'],
    severity: 'critical',
    category: ErrorCategory.CONFIG,
  },

  // Connection errors
  PYRAMID_CONNECTION_NETWORK: {
    message: 'Network connection failed',
    remediation: ['Check that the target host is reachable', 'Verify firewall settings'],
    severity: 'error',
    category: ErrorCategory.CONNECTION,
  },
  PYRAMID_CONNECTION_AUTH: {
    message: 'Authentication failed',
    remediation: ['Verify credentials in configuration', 'Check account permissions'],
    severity: 'error',
    category: ErrorCategory.CONNECTION,
  },
  PYRAMID_CONNECTION_SERVER: {
    message: 'Server rejected the connection',
    remediation: ['Verify server version compatibility', 'Check server whitelist settings'],
    severity: 'error',
    category: ErrorCategory.CONNECTION,
  },

  // Ollama errors
  PYRAMID_OLLAMA_UNAVAILABLE: {
    message: 'Ollama service is not reachable',
    remediation: ['Start Ollama: ollama serve', 'Check Ollama host/port in config'],
    severity: 'critical',
    category: ErrorCategory.OLLAMA,
  },
  PYRAMID_OLLAMA_MODEL_MISSING: {
    message: 'Required Ollama model is not installed',
    remediation: ['Install the model: ollama pull <model_name>'],
    severity: 'error',
    category: ErrorCategory.OLLAMA,
  },
  PYRAMID_OLLAMA_TIMEOUT: {
    message: 'Ollama request timed out',
    remediation: ['Check Ollama resource usage', 'Increase timeout in config'],
    severity: 'warning',
    category: ErrorCategory.OLLAMA,
  },

  // Database errors
  PYRAMID_DATABASE_LOCKED: {
    message: 'Database is locked by another process',
    remediation: ['Check for other PYRAMID OS instances', 'Restart the system'],
    severity: 'error',
    category: ErrorCategory.DATABASE,
  },
  PYRAMID_DATABASE_INTEGRITY: {
    message: 'Database integrity check failed',
    remediation: ['Restore from backup: pyramid-os snapshot restore', 'Run integrity repair'],
    severity: 'critical',
    category: ErrorCategory.DATABASE,
  },

  // Agent errors
  PYRAMID_AGENT_PERMISSION: {
    message: 'Agent attempted an action outside its permissions',
    remediation: ['Review agent role configuration', 'Check workspace tool permissions'],
    severity: 'warning',
    category: ErrorCategory.AGENT,
  },

  // Plugin errors
  PYRAMID_PLUGIN_INCOMPATIBLE: {
    message: 'Plugin is incompatible with current system version',
    remediation: ['Update the plugin to a compatible version', 'Check plugin manifest minSystemVersion'],
    severity: 'error',
    category: ErrorCategory.PLUGIN,
  },
  PYRAMID_PLUGIN_LOAD_FAILED: {
    message: 'Plugin failed to load',
    remediation: ['Check plugin entry module path', 'Review plugin logs for details'],
    severity: 'error',
    category: ErrorCategory.PLUGIN,
  },

  // Security errors
  PYRAMID_SECURITY_BOUNDARY: {
    message: 'Safety boundary violation detected',
    remediation: ['Review agent behavior logs', 'Adjust safety constraints if appropriate'],
    severity: 'critical',
    category: ErrorCategory.SECURITY,
  },
};

// ---------------------------------------------------------------------------
// Factory function
// ---------------------------------------------------------------------------

/**
 * Create a {@link PyramidError} by looking up the error code in the registry.
 * Additional context and a root cause can be supplied to enrich the error.
 */
export function createPyramidError(
  code: string,
  context?: Record<string, unknown>,
  cause?: Error,
): PyramidError {
  const entry = ERROR_REGISTRY[code];

  if (!entry) {
    const opts: ConstructorParameters<typeof PyramidError>[0] = {
      code,
      category: ErrorCategory.SYSTEM,
      severity: 'error',
      message: `Unknown error code: ${code}`,
    };
    if (context !== undefined) opts.context = context;
    if (cause !== undefined) opts.cause = cause;
    return new PyramidError(opts);
  }

  const opts: ConstructorParameters<typeof PyramidError>[0] = {
    code,
    category: entry.category,
    severity: entry.severity,
    message: entry.message,
    remediation: entry.remediation,
  };
  if (context !== undefined) opts.context = context;
  if (cause !== undefined) opts.cause = cause;
  return new PyramidError(opts);
}
