/**
 * CLI API client for communicating with the PYRAMID OS REST API.
 * Uses Node.js built-in fetch (Node 22+).
 *
 * Config resolution priority:
 *   1. Constructor options (CLI flags)
 *   2. Environment variables (PYRAMID_API_URL, PYRAMID_API_KEY)
 *   3. Defaults (http://localhost:3000)
 */

const DEFAULT_BASE_URL = 'http://localhost:3000';
const REQUEST_TIMEOUT_MS = 30_000;

export interface ApiClientOptions {
  baseUrl?: string;
  apiKey?: string;
}

export class ApiClient {
  readonly baseUrl: string;
  readonly apiKey: string | undefined;

  constructor(options?: ApiClientOptions) {
    this.baseUrl = resolveBaseUrl(options?.baseUrl);
    this.apiKey = resolveApiKey(options?.apiKey);
  }

  /**
   * HTTP GET with optional query parameters.
   * Returns parsed JSON body typed as T.
   */
  async get<T = unknown>(path: string, params?: Record<string, string>): Promise<T> {
    let url = `${this.baseUrl}${path}`;
    if (params && Object.keys(params).length > 0) {
      const qs = new URLSearchParams(params).toString();
      url += (path.includes('?') ? '&' : '?') + qs;
    }
    return this.request<T>('GET', url);
  }

  /**
   * HTTP POST with optional JSON body.
   * Returns parsed JSON body typed as T.
   */
  async post<T = unknown>(path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    return this.request<T>('POST', url, body);
  }

  /**
   * HTTP DELETE.
   * Returns parsed JSON body typed as T.
   */
  async del<T = unknown>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    return this.request<T>('DELETE', url);
  }

  /**
   * Check if the API is reachable by hitting GET /health.
   * Returns true when the server responds (any 2xx/3xx), false otherwise.
   */
  async ping(): Promise<boolean> {
    try {
      const url = `${this.baseUrl}/health`;
      const response = await fetchWithTimeout(url, {
        method: 'GET',
        headers: this.buildHeaders(false),
        signal: AbortSignal.timeout(5_000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  // ── internals ──────────────────────────────────────────────

  private buildHeaders(json: boolean): Record<string, string> {
    const headers: Record<string, string> = {
      accept: 'application/json',
    };
    if (json) {
      headers['content-type'] = 'application/json';
    }
    if (this.apiKey) {
      headers['x-api-key'] = this.apiKey;
    }
    return headers;
  }

  private async request<T>(method: string, url: string, body?: unknown): Promise<T> {
    const hasBody = body !== undefined;
    const init: RequestInit = {
      method,
      headers: this.buildHeaders(hasBody),
    };
    if (hasBody) {
      init.body = JSON.stringify(body);
    }

    let response: Response;
    try {
      response = await fetchWithTimeout(url, init);
    } catch (err: unknown) {
      throw toConnectionError(err, url);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      let detail: string;
      try {
        const parsed = JSON.parse(text);
        detail = parsed.message ?? parsed.error ?? text;
      } catch {
        detail = text;
      }
      throw new ApiRequestError(
        `${method} ${url} failed with status ${response.status}: ${detail}`,
        response.status,
      );
    }

    const text = await response.text();
    if (!text) {
      return undefined as T;
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as T;
    }
  }
}

// ── Helpers ────────────────────────────────────────────────

function resolveBaseUrl(flag?: string): string {
  if (flag) return flag.replace(/\/+$/, '');
  const env = process.env['PYRAMID_API_URL'];
  if (env) return env.replace(/\/+$/, '');
  return DEFAULT_BASE_URL;
}

function resolveApiKey(flag?: string): string | undefined {
  if (flag) return flag;
  return process.env['PYRAMID_API_KEY'] || undefined;
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  // If the caller already set a signal (e.g. ping), respect it.
  if (!init.signal) {
    init.signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  }
  return fetch(url, init);
}

function toConnectionError(err: unknown, url: string): ApiConnectionError {
  const msg = err instanceof Error ? err.message : String(err);

  if (isAbortOrTimeout(err)) {
    return new ApiConnectionError(
      `Request to ${url} timed out after ${REQUEST_TIMEOUT_MS}ms. Is the PYRAMID OS API server running?`,
    );
  }

  if (msg.includes('ECONNREFUSED')) {
    return new ApiConnectionError(
      `Connection refused at ${url}. Is the PYRAMID OS API server running? Start it with: pyramid-os system start`,
    );
  }

  if (msg.includes('ENOTFOUND')) {
    return new ApiConnectionError(
      `Could not resolve host for ${url}. Check the --api-url flag or PYRAMID_API_URL environment variable.`,
    );
  }

  if (msg.includes('ECONNRESET') || msg.includes('socket hang up')) {
    return new ApiConnectionError(
      `Connection to ${url} was reset. The server may have crashed or restarted.`,
    );
  }

  return new ApiConnectionError(
    `Failed to connect to ${url}: ${msg}`,
  );
}

function isAbortOrTimeout(err: unknown): boolean {
  if (err instanceof DOMException && err.name === 'TimeoutError') return true;
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  if (err instanceof Error && err.name === 'TimeoutError') return true;
  if (err instanceof Error && err.name === 'AbortError') return true;
  return false;
}

// ── Error classes ──────────────────────────────────────────

export class ApiConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiConnectionError';
  }
}

export class ApiRequestError extends Error {
  readonly statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'ApiRequestError';
    this.statusCode = statusCode;
  }
}
