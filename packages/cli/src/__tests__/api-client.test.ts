import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { ApiClient, ApiConnectionError, ApiRequestError } from '../api-client.js';

type FetchSpy = MockInstance<typeof globalThis.fetch>;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function textResponse(text: string, status = 200): Response {
  return new Response(text, { status });
}

/* ------------------------------------------------------------------ */
/*  Config resolution                                                  */
/* ------------------------------------------------------------------ */

describe('ApiClient config resolution', () => {
  const origEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it('uses constructor baseUrl when provided (highest priority)', () => {
    process.env['PYRAMID_API_URL'] = 'http://env:9999';
    const client = new ApiClient({ baseUrl: 'http://flag:1234' });
    expect(client.baseUrl).toBe('http://flag:1234');
  });

  it('falls back to PYRAMID_API_URL env var when no flag', () => {
    process.env['PYRAMID_API_URL'] = 'http://env:9999';
    const client = new ApiClient();
    expect(client.baseUrl).toBe('http://env:9999');
  });

  it('falls back to default when no flag and no env var', () => {
    delete process.env['PYRAMID_API_URL'];
    const client = new ApiClient();
    expect(client.baseUrl).toBe('http://localhost:3000');
  });

  it('strips trailing slashes from baseUrl', () => {
    const client = new ApiClient({ baseUrl: 'http://example.com/' });
    expect(client.baseUrl).toBe('http://example.com');
  });

  it('uses constructor apiKey when provided (highest priority)', () => {
    process.env['PYRAMID_API_KEY'] = 'env-key';
    const client = new ApiClient({ apiKey: 'flag-key' });
    expect(client.apiKey).toBe('flag-key');
  });

  it('falls back to PYRAMID_API_KEY env var when no flag', () => {
    process.env['PYRAMID_API_KEY'] = 'env-key';
    const client = new ApiClient();
    expect(client.apiKey).toBe('env-key');
  });

  it('apiKey is undefined when not set anywhere', () => {
    delete process.env['PYRAMID_API_KEY'];
    const client = new ApiClient();
    expect(client.apiKey).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/*  HTTP methods                                                       */
/* ------------------------------------------------------------------ */

describe('ApiClient HTTP methods', () => {
  let fetchSpy: FetchSpy;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch') as FetchSpy;
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  const client = new ApiClient({ baseUrl: 'http://test:3000', apiKey: 'test-key' });

  describe('get()', () => {
    it('sends GET request and returns parsed JSON', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse({ agents: [] }));

      const result = await client.get<{ agents: unknown[] }>('/agents');

      expect(result).toEqual({ agents: [] });
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://test:3000/agents');
      expect(init.method).toBe('GET');
    });

    it('appends query params to URL', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse([]));

      await client.get('/tasks', { status: 'pending', priority: 'high' });

      const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('status=pending');
      expect(url).toContain('priority=high');
    });

    it('appends params with & when path already has query string', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse([]));

      await client.get('/tasks?foo=bar', { status: 'done' });

      const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://test:3000/tasks?foo=bar&status=done');
    });

    it('sends x-api-key header when apiKey is set', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse({}));

      await client.get('/agents');

      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers['x-api-key']).toBe('test-key');
    });

    it('omits x-api-key header when apiKey is not set', async () => {
      const noKeyClient = new ApiClient({ baseUrl: 'http://test:3000' });
      fetchSpy.mockResolvedValueOnce(jsonResponse({}));

      await noKeyClient.get('/agents');

      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers['x-api-key']).toBeUndefined();
    });
  });

  describe('post()', () => {
    it('sends POST request with JSON body', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse({ id: '123' }));

      const result = await client.post('/system/start', { mode: 'structured' });

      expect(result).toEqual({ id: '123' });
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://test:3000/system/start');
      expect(init.method).toBe('POST');
      expect(init.body).toBe(JSON.stringify({ mode: 'structured' }));
      const headers = init.headers as Record<string, string>;
      expect(headers['content-type']).toBe('application/json');
    });

    it('sends POST without body when body is undefined', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse({ ok: true }));

      await client.post('/system/stop');

      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(init.body).toBeUndefined();
    });
  });

  describe('del()', () => {
    it('sends DELETE request', async () => {
      fetchSpy.mockResolvedValueOnce(jsonResponse({ deleted: true }));

      const result = await client.del('/agents/abc');

      expect(result).toEqual({ deleted: true });
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://test:3000/agents/abc');
      expect(init.method).toBe('DELETE');
    });
  });
});

/* ------------------------------------------------------------------ */
/*  ping()                                                             */
/* ------------------------------------------------------------------ */

describe('ApiClient.ping()', () => {
  let fetchSpy: FetchSpy;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch') as FetchSpy;
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  const client = new ApiClient({ baseUrl: 'http://test:3000' });

  it('returns true when /health responds 200', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ status: 'ok' }));
    expect(await client.ping()).toBe(true);
    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://test:3000/health');
  });

  it('returns false when /health responds 500', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ error: 'down' }, 500));
    expect(await client.ping()).toBe(false);
  });

  it('returns false when fetch throws (server unreachable)', async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError('fetch failed'));
    expect(await client.ping()).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  Error handling                                                     */
/* ------------------------------------------------------------------ */

describe('ApiClient error handling', () => {
  let fetchSpy: FetchSpy;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch') as FetchSpy;
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  const client = new ApiClient({ baseUrl: 'http://test:3000' });

  it('throws ApiRequestError on non-ok response with JSON error body', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ message: 'Not found', code: 'AGENT_NOT_FOUND' }, 404),
    );

    await expect(client.get('/agents/missing')).rejects.toThrow(ApiRequestError);
    await fetchSpy.mockResolvedValueOnce(
      jsonResponse({ message: 'Not found' }, 404),
    );
    try {
      await client.get('/agents/missing');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiRequestError);
      expect((err as ApiRequestError).statusCode).toBe(404);
      expect((err as ApiRequestError).message).toContain('Not found');
    }
  });

  it('throws ApiRequestError on non-ok response with plain text body', async () => {
    fetchSpy.mockResolvedValueOnce(textResponse('Internal Server Error', 500));

    try {
      await client.get('/broken');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiRequestError);
      expect((err as ApiRequestError).statusCode).toBe(500);
      expect((err as ApiRequestError).message).toContain('Internal Server Error');
    }
  });

  it('throws ApiConnectionError with ECONNREFUSED message', async () => {
    const connErr = new TypeError('fetch failed');
    (connErr as unknown as Record<string, unknown>).cause = { code: 'ECONNREFUSED' };
    // Node fetch wraps the cause, but the message check works on the stringified error
    const econnErr = Object.assign(new Error('fetch failed: ECONNREFUSED'), { cause: connErr });
    fetchSpy.mockRejectedValueOnce(econnErr);

    try {
      await client.get('/agents');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiConnectionError);
      expect((err as Error).message).toContain('Connection refused');
      expect((err as Error).message).toContain('pyramid-os system start');
    }
  });

  it('throws ApiConnectionError on timeout', async () => {
    const timeoutErr = new DOMException('The operation was aborted', 'TimeoutError');
    fetchSpy.mockRejectedValueOnce(timeoutErr);

    try {
      await client.get('/slow');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiConnectionError);
      expect((err as Error).message).toContain('timed out');
    }
  });

  it('throws ApiConnectionError on ENOTFOUND', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND badhost'));

    try {
      await client.get('/agents');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiConnectionError);
      expect((err as Error).message).toContain('Could not resolve host');
    }
  });

  it('throws ApiConnectionError on ECONNRESET', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('read ECONNRESET'));

    try {
      await client.get('/agents');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiConnectionError);
      expect((err as Error).message).toContain('was reset');
    }
  });

  it('handles empty response body gracefully', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('', { status: 200 }));
    const result = await client.post('/system/stop');
    expect(result).toBeUndefined();
  });
});
