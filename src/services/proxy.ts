/**
 * Proxy client.
 *
 * Every outbound LLM call goes through the local proxy in the Electron main
 * process. The renderer never talks to a provider directly — that keeps API
 * keys out of CORS failures, works with `webSecurity: true`, and means a
 * single place enforces timeouts.
 */

import { bridge } from './storage';

export const DEFAULT_TIMEOUT_MS = 60_000;
export const COMPLETION_TIMEOUT_MS = 120_000;

export function proxyBaseUrl(): string {
  const port = bridge()?.config?.proxyPort;
  // In browser dev mode the Vite middleware serves /api/proxy on the same
  // origin, so an empty base is correct.
  return port ? `http://127.0.0.1:${port}` : '';
}

export function proxyToken(): string {
  return bridge()?.config?.proxyToken ?? '';
}

export function proxyReady(): boolean {
  return proxyBaseUrl() !== '';
}

export class ProxyError extends Error {
  readonly status?: number;
  readonly kind: 'timeout' | 'network' | 'proxy' | 'unauthorized';

  constructor(kind: ProxyError['kind'], message: string, status?: number) {
    super(message);
    this.name = 'ProxyError';
    this.kind = kind;
    this.status = status;
  }
}

export interface ProxyRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Perform a request through the local proxy. Throws `ProxyError` on timeout,
 * transport failure, or a proxy-level rejection (401/400/502/504).
 *
 * Upstream HTTP errors (401 from the provider, 429, 5xx) are *not* thrown —
 * they come back as a normal `Response` so callers can classify them.
 */
export async function proxyRequest(targetUrl: string, init: ProxyRequestInit = {}): Promise<Response> {
  const {
    method = 'GET',
    headers = {},
    body,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    signal,
  } = init;

  if (!proxyReady()) {
    throw new ProxyError('proxy', 'Local proxy is not running. Restart Qin.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);

  // Honour an externally supplied cancellation alongside our deadline.
  const onExternalAbort = () => controller.abort(new Error('cancelled'));
  if (signal) {
    if (signal.aborted) controller.abort(new Error('cancelled'));
    else signal.addEventListener('abort', onExternalAbort, { once: true });
  }

  const requestHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...headers,
    'x-target-url': targetUrl,
  };
  const token = proxyToken();
  if (token) requestHeaders['x-qin-token'] = token;

  let response: Response;
  try {
    response = await fetch(`${proxyBaseUrl()}/api/proxy`, {
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    const aborted = controller.signal.aborted;
    const reason = String((err as Error)?.message ?? err);
    if (aborted) {
      throw new ProxyError('timeout', `Request timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    throw new ProxyError('network', `Could not reach the local proxy: ${reason}`);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onExternalAbort);
  }

  if (response.status === 401) {
    throw new ProxyError('unauthorized', 'Proxy rejected the request (bad session token). Restart Qin.', 401);
  }
  if (response.status === 400 || response.status === 502 || response.status === 504) {
    let detail = `Proxy returned ${response.status}`;
    try {
      const parsed = await response.clone().json();
      if (parsed?.error) detail = parsed.error + (parsed.details ? `: ${parsed.details}` : '');
    } catch {
      // body was not JSON; keep the generic message
    }
    throw new ProxyError(response.status === 504 ? 'timeout' : 'proxy', detail, response.status);
  }

  return response;
}

/** Quick liveness probe against the main process. */
export async function probeProxy(): Promise<boolean> {
  if (!proxyReady()) return false;
  try {
    const res = await fetch(`${proxyBaseUrl()}/api/health`, { method: 'GET' });
    return res.ok;
  } catch {
    return false;
  }
}
