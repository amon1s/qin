/**
 * Provider presets, model discovery, and completion dispatch.
 *
 * All network traffic goes through the local proxy (see ./proxy.ts) so there is
 * exactly one place that enforces deadlines and one place that holds the
 * session token. There is deliberately no direct-fetch fallback: the previous
 * build fell back to calling the provider straight from the renderer, which
 * leaked keys into a CORS-blocked request and made failures hard to attribute.
 */

import { LLMModel, ProviderConfig, ProviderStatus, AuthType } from '../types';
import { proxyRequest, ProxyError, DEFAULT_TIMEOUT_MS, COMPLETION_TIMEOUT_MS } from './proxy';

export interface ProviderPreset {
  id: string;
  companyName: string;
  defaultBaseUrl: string;
  defaultModelsEndpoint: string;
  authType: AuthType;
  customHeaderName?: string;
  isOpenAiCompatible: boolean;
  description: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'openai',
    companyName: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModelsEndpoint: '/models',
    authType: 'bearer',
    isOpenAiCompatible: true,
    description: 'Standard OpenAI API (GPT-4o, o1, o3-mini)',
  },
  {
    id: 'anthropic',
    companyName: 'Anthropic',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    defaultModelsEndpoint: '/models',
    authType: 'x-api-key',
    isOpenAiCompatible: false,
    description: 'Anthropic Claude API (Claude 3.7 Sonnet, Haiku)',
  },
  {
    id: 'groq',
    companyName: 'Groq',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    defaultModelsEndpoint: '/models',
    authType: 'bearer',
    isOpenAiCompatible: true,
    description: 'Ultra-fast LPU inference (Llama 3.3, DeepSeek R1 Distill)',
  },
  {
    id: 'deepseek',
    companyName: 'DeepSeek',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    defaultModelsEndpoint: '/models',
    authType: 'bearer',
    isOpenAiCompatible: true,
    description: 'DeepSeek Native API (DeepSeek-V3, DeepSeek-R1)',
  },
  {
    id: 'mistral',
    companyName: 'Mistral AI',
    defaultBaseUrl: 'https://api.mistral.ai/v1',
    defaultModelsEndpoint: '/models',
    authType: 'bearer',
    isOpenAiCompatible: true,
    description: 'Mistral AI API (Mistral Large, Codestral)',
  },
  {
    id: 'openrouter',
    companyName: 'OpenRouter',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    defaultModelsEndpoint: '/models',
    authType: 'bearer',
    isOpenAiCompatible: true,
    description: 'Unified router with upstream credit billing queries',
  },
  {
    id: 'ollama',
    companyName: 'Ollama (Local)',
    defaultBaseUrl: 'http://localhost:11434',
    defaultModelsEndpoint: '/api/tags',
    authType: 'none',
    isOpenAiCompatible: false,
    description: 'Local daemon running on localhost:11434',
  },
];

type ProviderSeed = Omit<ProviderConfig, 'apiKey' | 'status' | 'models' | 'balanceInfo'>;

/**
 * Derived from the presets rather than hand-listed, so a preset and its
 * default instance can never drift apart.
 */
export const CANONICAL_PROVIDERS: ProviderSeed[] = PROVIDER_PRESETS.map(preset => ({
  id: `${preset.id}_primary`,
  name: `${preset.companyName} Primary`,
  companyName: preset.companyName,
  instanceName: 'Primary',
  presetKey: preset.id,
  baseUrl: preset.defaultBaseUrl,
  modelsEndpoint: preset.defaultModelsEndpoint,
  authType: preset.authType,
  customHeaderName: preset.customHeaderName,
}));

/* --------------------------------------------------------------- URL building */

const VERSION_SEGMENT = /\/v\d+(\/|$)/i;

function stripTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, '');
}

function ensureLeadingSlash(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

/**
 * Join a base URL with a path, collapsing the seam.
 *
 * The old implementation appended `/v1` whenever the base did not already end
 * in `/v1`, which turned `https://api.nous.ai/v1` + `/models` into
 * `https://api.nous.ai/v1/v1/models` — a guaranteed 404 on every
 * OpenAI-compatible custom endpoint.
 */
export function joinUrl(baseUrl: string, path: string): string {
  const base = stripTrailingSlashes(baseUrl.trim());
  const suffix = ensureLeadingSlash(path.trim());
  return `${base}${suffix}`;
}

export function buildModelsUrl(
  provider: Pick<ProviderConfig, 'baseUrl' | 'modelsEndpoint' | 'presetKey'>
): string {
  const base = stripTrailingSlashes(provider.baseUrl.trim());

  if (provider.presetKey === 'ollama') return joinUrl(base, '/api/tags');

  const endpoint = ensureLeadingSlash((provider.modelsEndpoint || '/models').trim());

  // An explicit versioned path is authoritative.
  if (VERSION_SEGMENT.test(endpoint)) return joinUrl(base, endpoint);

  // The base already carries a version segment; don't add a second one.
  if (VERSION_SEGMENT.test(base)) return joinUrl(base, endpoint);

  return joinUrl(base, `/v1${endpoint}`);
}

export function buildChatUrl(
  provider: Pick<ProviderConfig, 'baseUrl' | 'presetKey' | 'chatEndpoint'>
): string {
  const base = stripTrailingSlashes(provider.baseUrl.trim());

  if (provider.chatEndpoint) return joinUrl(base, provider.chatEndpoint);
  if (provider.presetKey === 'ollama') return joinUrl(base, '/api/generate');
  if (provider.presetKey === 'anthropic') return joinUrl(base, '/messages');

  if (/\/chat\/completions$/i.test(base)) return base;
  if (VERSION_SEGMENT.test(base)) return joinUrl(base, '/chat/completions');
  return joinUrl(base, '/v1/chat/completions');
}

export function buildBalanceUrl(
  provider: Pick<ProviderConfig, 'baseUrl' | 'presetKey'>
): string | null {
  if (provider.presetKey !== 'openrouter') return null;
  return joinUrl(provider.baseUrl, '/auth/key');
}

export function buildAuthHeaders(
  provider: Pick<ProviderConfig, 'authType' | 'apiKey' | 'customHeaderName'> &
    Partial<Pick<ProviderConfig, 'presetKey'>>
): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (provider.authType === 'bearer' && provider.apiKey) {
    headers['Authorization'] = `Bearer ${provider.apiKey}`;
  } else if (provider.authType === 'x-api-key' && provider.apiKey) {
    headers['x-api-key'] = provider.apiKey;
  } else if (provider.authType === 'custom' && provider.customHeaderName && provider.apiKey) {
    headers[provider.customHeaderName] = provider.apiKey;
  }

  return headers;
}

/** Anthropic requires its version header, whatever the auth style. */
function withAnthropicVersion(
  headers: Record<string, string>,
  provider: Pick<ProviderConfig, 'presetKey' | 'baseUrl'>
): Record<string, string> {
  const isAnthropic =
    provider.presetKey === 'anthropic' || /anthropic\.com/i.test(provider.baseUrl);
  if (isAnthropic && !headers['anthropic-version']) {
    return { ...headers, 'anthropic-version': '2023-06-01' };
  }
  return headers;
}

export function isLocalProvider(
  provider: Pick<ProviderConfig, 'presetKey' | 'authType'>
): boolean {
  return provider.presetKey === 'ollama' || provider.authType === 'none';
}

/* ------------------------------------------------------------- model parsing */

/**
 * Parse a human parameter count such as `"7B"`, `"1.5b"`, `"350M"` into an
 * absolute count. `parseInt("7B")` is `7`, which the old build stored as a
 * context window of seven tokens.
 */
export function parseParameterCount(raw?: string | null): number | undefined {
  if (!raw) return undefined;
  const match = /^\s*([\d.]+)\s*([kmbt])?/i.exec(String(raw));
  if (!match) return undefined;
  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  const unit = (match[2] || '').toLowerCase();
  const multiplier =
    unit === 'k' ? 1e3 : unit === 'm' ? 1e6 : unit === 'b' ? 1e9 : unit === 't' ? 1e12 : 1;
  return Math.round(value * multiplier);
}

/** OpenRouter-style per-token price string → USD per 1M tokens. */
export function perTokenToPerMillion(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const value = Number.parseFloat(String(raw));
  if (!Number.isFinite(value) || value < 0) return undefined;
  return Math.round(value * 1_000_000 * 1e6) / 1e6;
}

function inferCategory(id: string): LLMModel['category'] {
  const lower = id.toLowerCase();
  if (/(reason|r1|o1|o3|o4|think|qwq)/.test(lower)) return 'reasoning';
  if (/(code|coder|codestral|devstral)/.test(lower)) return 'coding';
  if (/(vision|vl|llava|multimodal)/.test(lower)) return 'vision';
  if (/(flash|mini|haiku|nano|tiny|\d+b)/.test(lower)) return 'fast';
  return 'general';
}

function toModel(
  provider: ProviderConfig,
  raw: Record<string, unknown>,
  overrides: Partial<LLMModel> = {}
): LLMModel | null {
  const id = (raw.id ?? raw.name ?? raw.model) as string | undefined;
  if (!id || typeof id !== 'string') return null;

  return {
    id,
    name: ((raw.display_name ?? raw.name ?? id) as string) || id,
    providerId: provider.id,
    category: inferCategory(id),
    supportsStreaming: true,
    description: (raw.description as string | undefined) ?? undefined,
    lastDiscoveredAt: new Date().toISOString(),
    ...overrides,
  };
}

export function parseModelsPayload(provider: ProviderConfig, payload: unknown): LLMModel[] {
  const models: LLMModel[] = [];
  if (!payload) return models;

  const record = payload as Record<string, unknown>;
  const list: unknown[] = Array.isArray(payload)
    ? payload
    : Array.isArray(record.data)
      ? (record.data as unknown[])
      : Array.isArray(record.models)
        ? (record.models as unknown[])
        : [];

  const isOllama = provider.presetKey === 'ollama';

  for (const entry of list) {
    if (typeof entry === 'string') {
      models.push({
        id: entry,
        name: entry,
        providerId: provider.id,
        category: inferCategory(entry),
        supportsStreaming: true,
        lastDiscoveredAt: new Date().toISOString(),
      });
      continue;
    }
    if (!entry || typeof entry !== 'object') continue;

    const raw = entry as Record<string, unknown>;
    const details = (raw.details ?? {}) as Record<string, unknown>;
    const overrides: Partial<LLMModel> = {};

    // Context window only from a real field — never fabricated. The UI shows
    // "Unknown ctx" rather than a wrong number.
    const contextWindow =
      raw.context_length ?? raw.context_window ?? details.context_length ?? raw.max_context_length;
    if (typeof contextWindow === 'number' && contextWindow > 0) {
      overrides.contextWindow = contextWindow;
    }

    if (isOllama) {
      const parameterCount = parseParameterCount(
        (details.parameter_size ?? raw.parameter_size) as string | undefined
      );
      if (parameterCount) overrides.parameterCount = parameterCount;
    }

    // Pricing only when the provider actually publishes it.
    if (raw.pricing && typeof raw.pricing === 'object') {
      const pricing = raw.pricing as Record<string, unknown>;
      const input = perTokenToPerMillion(pricing.prompt ?? pricing.input);
      const output = perTokenToPerMillion(pricing.completion ?? pricing.output);
      if (input !== undefined) overrides.inputCostPer1m = input;
      if (output !== undefined) overrides.outputCostPer1m = output;
    }

    const model = toModel(provider, raw, overrides);
    if (model) models.push(model);
  }

  const seen = new Set<string>();
  return models.filter(model => {
    if (seen.has(model.id)) return false;
    seen.add(model.id);
    return true;
  });
}

/* ---------------------------------------------------------------- discovery */

export interface DiscoveryResult {
  status: ProviderStatus;
  statusMessage: string;
  latencyMs: number;
  models: LLMModel[];
  balanceInfo?: ProviderConfig['balanceInfo'];
}

function failure(status: ProviderStatus, statusMessage: string, latencyMs: number): DiscoveryResult {
  return { status, statusMessage, latencyMs, models: [], balanceInfo: null };
}

async function fetchOpenRouterBalance(
  provider: ProviderConfig
): Promise<ProviderConfig['balanceInfo']> {
  const url = buildBalanceUrl(provider);
  if (!url || !provider.apiKey) return null;

  try {
    const response = await proxyRequest(url, {
      method: 'GET',
      headers: buildAuthHeaders(provider),
      timeoutMs: 15_000,
    });
    if (!response.ok) return null;

    const payload = (await response.json()) as {
      data?: {
        usage?: number;
        limit?: number | null;
        is_free_tier?: boolean;
        rate_limit?: { requests?: number; interval?: string };
      };
    };
    const info = payload?.data;
    if (!info) return null;

    const usage = typeof info.usage === 'number' ? info.usage : 0;
    const limit = info.limit;
    const remaining = typeof limit === 'number' ? Math.max(0, limit - usage) : undefined;

    return {
      creditsRemainingUsd: remaining,
      usageTotalUsd: usage,
      isFreeTier: info.is_free_tier ?? false,
      rateLimitRemaining: info.rate_limit?.requests,
      rateLimitReset: info.rate_limit?.interval,
    };
  } catch {
    // Balance is a nicety; never let it fail discovery.
    return null;
  }
}

/**
 * Validate a provider and pull its model catalog.
 *
 * Never throws: transport and timeout problems are classified into a
 * `ProviderStatus` so the UI always has something to show.
 */
export async function validateAndDiscover(provider: ProviderConfig): Promise<DiscoveryResult> {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);

  if (!provider.apiKey && provider.authType !== 'none') {
    return failure('unconfigured', 'Unconfigured (no API key)', 0);
  }

  const url = buildModelsUrl(provider);
  const headers = withAnthropicVersion(buildAuthHeaders(provider), provider);

  let response: Response;
  try {
    response = await proxyRequest(url, { method: 'GET', headers, timeoutMs: DEFAULT_TIMEOUT_MS });
  } catch (err) {
    const latencyMs = elapsed();
    if (err instanceof ProxyError) {
      if (err.kind === 'timeout') {
        return failure(
          'offline',
          `Timed out after ${Math.round(DEFAULT_TIMEOUT_MS / 1000)}s reaching ${provider.baseUrl}`,
          latencyMs
        );
      }
      if (err.kind === 'unauthorized') return failure('invalid_key', err.message, latencyMs);
      return failure('offline', err.message, latencyMs);
    }
    return failure(
      'offline',
      `Connection failed: ${(err as Error)?.message ?? 'unknown error'}`,
      latencyMs
    );
  }

  const latencyMs = elapsed();

  if (response.status === 401 || response.status === 403) {
    return failure(
      'invalid_key',
      `Authentication failed (${response.status}): key rejected or expired`,
      latencyMs
    );
  }
  if (response.status === 429) {
    const retryAfter = response.headers.get('retry-after') || '60';
    return failure('rate_limited', `Rate limited (429). Retry after ${retryAfter}s.`, latencyMs);
  }
  if (response.status === 404) {
    return failure(
      'degraded',
      `Model list not found (404) at ${url}. Check the discovery path for this endpoint.`,
      latencyMs
    );
  }
  if (response.status >= 500) {
    return failure('degraded', `Upstream error (${response.status})`, latencyMs);
  }
  if (!response.ok) {
    return failure('degraded', `Unexpected response (${response.status})`, latencyMs);
  }

  let models: LLMModel[];
  try {
    models = parseModelsPayload(provider, await response.json());
  } catch {
    // Reachable but not JSON: report degraded rather than claiming success.
    return {
      status: 'degraded',
      statusMessage: 'Reachable, but the model list was not valid JSON',
      latencyMs,
      models: [],
      balanceInfo: null,
    };
  }

  const balanceInfo = await fetchOpenRouterBalance(provider);

  return {
    status: 'active',
    statusMessage:
      models.length > 0
        ? `Active · ${models.length} model${models.length === 1 ? '' : 's'} discovered`
        : 'Active · endpoint reachable, no models listed',
    latencyMs,
    models,
    balanceInfo,
  };
}

/* ----------------------------------------------------------------- dispatch */

export type CompletionStatus =
  | 'success'
  | 'rate_limited'
  | 'auth_error'
  | 'network_error'
  | 'server_error'
  | 'timeout'
  | 'cancelled';

export interface CompletionResult {
  text: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
  status: CompletionStatus;
  rawPayload: unknown;
  error?: string;
  /** True when token counts were estimated locally instead of reported. */
  tokensEstimated: boolean;
}

export interface DispatchOptions {
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** Rough fallback only, used when a provider omits its usage block. */
function estimateTokens(text: string): number {
  return text.length === 0 ? 0 : Math.max(1, Math.round(text.length / 4));
}

function buildCompletionRequest(
  provider: ProviderConfig,
  modelId: string,
  prompt: string,
  options: DispatchOptions
): { url: string; headers: Record<string, string>; body: Record<string, unknown> } {
  const headers = withAnthropicVersion(buildAuthHeaders(provider), provider);
  const url = buildChatUrl(provider);
  const maxTokens = options.maxTokens ?? 400;
  const temperature = options.temperature;

  if (provider.presetKey === 'anthropic') {
    return {
      url,
      headers,
      body: {
        model: modelId,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
        ...(temperature !== undefined ? { temperature } : {}),
      },
    };
  }

  if (provider.presetKey === 'ollama') {
    return {
      url,
      headers,
      body: {
        model: modelId,
        prompt,
        stream: false,
        options: { num_predict: maxTokens, ...(temperature !== undefined ? { temperature } : {}) },
      },
    };
  }

  return {
    url,
    headers,
    body: {
      model: modelId,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
      ...(temperature !== undefined ? { temperature } : {}),
    },
  };
}

function extractCompletion(
  provider: ProviderConfig,
  data: Record<string, unknown>
): { text: string; promptTokens?: number; completionTokens?: number } {
  if (provider.presetKey === 'anthropic') {
    const content = data.content as Array<{ text?: string }> | undefined;
    const usage = data.usage as { input_tokens?: number; output_tokens?: number } | undefined;
    return {
      text: content?.map(part => part.text ?? '').join('') ?? '',
      promptTokens: usage?.input_tokens,
      completionTokens: usage?.output_tokens,
    };
  }

  if (provider.presetKey === 'ollama') {
    return {
      text: (data.response as string) ?? '',
      promptTokens: data.prompt_eval_count as number | undefined,
      completionTokens: data.eval_count as number | undefined,
    };
  }

  const choices = data.choices as
    | Array<{ message?: { content?: string }; text?: string }>
    | undefined;
  const usage = data.usage as
    | { prompt_tokens?: number; completion_tokens?: number }
    | undefined;

  return {
    text: choices?.[0]?.message?.content ?? choices?.[0]?.text ?? '',
    promptTokens: usage?.prompt_tokens,
    completionTokens: usage?.completion_tokens,
  };
}

/**
 * Send one completion. Never throws — every failure mode maps to a
 * `CompletionStatus`, and the caller always gets a `latencyMs`.
 */
export async function dispatchTestCompletion(
  provider: ProviderConfig,
  modelId: string,
  prompt: string,
  options: DispatchOptions = {}
): Promise<CompletionResult> {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  const timeoutMs = options.timeoutMs ?? COMPLETION_TIMEOUT_MS;

  const { url, headers, body } = buildCompletionRequest(provider, modelId, prompt, options);

  let response: Response;
  try {
    response = await proxyRequest(url, {
      method: 'POST',
      headers,
      body,
      timeoutMs,
      signal: options.signal,
    });
  } catch (err) {
    const latencyMs = elapsed();
    const base = {
      text: '',
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      latencyMs,
      rawPayload: { error: (err as Error)?.message },
      tokensEstimated: false,
    };

    if (err instanceof ProxyError) {
      if (err.kind === 'timeout') return { ...base, status: 'timeout', error: err.message };
      if (err.kind === 'unauthorized') return { ...base, status: 'auth_error', error: err.message };
      return { ...base, status: 'network_error', error: err.message };
    }
    return {
      ...base,
      status: 'network_error',
      error: (err as Error)?.message ?? 'Unknown error',
    };
  }

  const latencyMs = elapsed();

  if (response.status === 401 || response.status === 403) {
    return {
      text: '',
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      latencyMs,
      status: 'auth_error',
      rawPayload: { status: response.status },
      error: `Authentication failed (${response.status}). Check the API key for this endpoint.`,
      tokensEstimated: false,
    };
  }

  if (response.status === 429) {
    const retryAfter = response.headers.get('retry-after');
    return {
      text: '',
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      latencyMs,
      status: 'rate_limited',
      rawPayload: { status: 429, retryAfter },
      error: `Rate limit or quota exceeded (429)${retryAfter ? `. Retry after ${retryAfter}s.` : '.'}`,
      tokensEstimated: false,
    };
  }

  if (!response.ok) {
    let detail = '';
    try {
      detail = (await response.text()).slice(0, 300);
    } catch {
      detail = '';
    }
    return {
      text: '',
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      latencyMs,
      status: 'server_error',
      rawPayload: detail,
      error: `Provider error ${response.status}${detail ? `: ${detail}` : ''}`,
      tokensEstimated: false,
    };
  }

  let data: Record<string, unknown>;
  try {
    data = (await response.json()) as Record<string, unknown>;
  } catch {
    return {
      text: '',
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      latencyMs,
      status: 'server_error',
      rawPayload: null,
      error: 'Provider returned a non-JSON body.',
      tokensEstimated: false,
    };
  }

  const extracted = extractCompletion(provider, data);
  const tokensEstimated =
    extracted.promptTokens === undefined || extracted.completionTokens === undefined;

  const promptTokens = extracted.promptTokens ?? estimateTokens(prompt);
  const completionTokens = extracted.completionTokens ?? estimateTokens(extracted.text);

  return {
    text: extracted.text,
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    latencyMs,
    status: 'success',
    rawPayload: data,
    tokensEstimated,
  };
}
