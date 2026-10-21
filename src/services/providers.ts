import { ProviderConfig, ProviderId, LLMModel, ProviderStatus, AuthType } from '../types';

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

export const CANONICAL_PROVIDERS: Omit<ProviderConfig, 'apiKey' | 'status' | 'models' | 'balanceInfo'>[] = [
  {
    id: 'openai_primary',
    name: 'OpenAI Primary',
    companyName: 'OpenAI',
    instanceName: 'Primary',
    presetKey: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    modelsEndpoint: '/models',
    authType: 'bearer',
  },
  {
    id: 'anthropic_primary',
    name: 'Anthropic Primary',
    companyName: 'Anthropic',
    instanceName: 'Primary',
    presetKey: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    modelsEndpoint: '/models',
    authType: 'x-api-key',
  },
  {
    id: 'groq_primary',
    name: 'Groq Primary',
    companyName: 'Groq',
    instanceName: 'Primary',
    presetKey: 'groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    modelsEndpoint: '/models',
    authType: 'bearer',
  },
  {
    id: 'deepseek_primary',
    name: 'DeepSeek Primary',
    companyName: 'DeepSeek',
    instanceName: 'Primary',
    presetKey: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1',
    modelsEndpoint: '/models',
    authType: 'bearer',
  },
  {
    id: 'mistral_primary',
    name: 'Mistral AI Primary',
    companyName: 'Mistral AI',
    instanceName: 'Primary',
    presetKey: 'mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    modelsEndpoint: '/models',
    authType: 'bearer',
  },
  {
    id: 'openrouter_primary',
    name: 'OpenRouter Primary',
    companyName: 'OpenRouter',
    instanceName: 'Primary',
    presetKey: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    modelsEndpoint: '/models',
    authType: 'bearer',
  },
  {
    id: 'ollama_primary',
    name: 'Ollama (Local) Primary',
    companyName: 'Ollama (Local)',
    instanceName: 'Primary',
    presetKey: 'ollama',
    baseUrl: 'http://localhost:11434',
    modelsEndpoint: '/api/tags',
    authType: 'none',
  },
];

/**
 * Universal dynamic model discovery across standard, custom, and multi-instance endpoints
 */
export async function validateAndDiscover(
  provider: ProviderConfig
): Promise<{
  status: ProviderStatus;
  statusMessage: string;
  latencyMs: number;
  models: LLMModel[];
  balanceInfo?: ProviderConfig['balanceInfo'];
}> {
  const startTime = performance.now();

  // If unconfigured (no key and not local ollama)
  if (!provider.apiKey && provider.authType !== 'none') {
    return {
      status: 'unconfigured',
      statusMessage: 'Unconfigured (No API key)',
      latencyMs: 0,
      models: [],
      balanceInfo: null,
    };
  }

  // Construct target URL
  let targetUrl = provider.baseUrl.replace(/\/+$/, '');
  const endpoint = provider.modelsEndpoint.startsWith('/') ? provider.modelsEndpoint : '/' + provider.modelsEndpoint;

  if (provider.presetKey === 'openrouter') {
    targetUrl = 'https://openrouter.ai/api/v1/models';
  } else if (provider.presetKey === 'ollama') {
    targetUrl = `${targetUrl}/api/tags`;
  } else if (!targetUrl.endsWith('/v1') && !targetUrl.endsWith('/models') && endpoint === '/models') {
    targetUrl = `${targetUrl}${endpoint.startsWith('/v1') ? endpoint : '/v1' + endpoint}`;
  } else {
    targetUrl = `${targetUrl}${endpoint}`;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (provider.authType === 'bearer') {
    headers['Authorization'] = `Bearer ${provider.apiKey}`;
  } else if (provider.authType === 'x-api-key') {
    headers['x-api-key'] = provider.apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else if (provider.authType === 'custom' && provider.customHeaderName) {
    headers[provider.customHeaderName] = provider.apiKey;
  }

  let response: Response | null = null;
  let fetchError: any = null;

  try {
    // 1. Try local proxy to avoid CORS
    response = await fetch('/api/proxy', {
      method: 'GET',
      headers: {
        ...headers,
        'x-target-url': targetUrl,
      },
    });
  } catch (err: any) {
    fetchError = err;
    // 2. Direct fetch fallback
    try {
      response = await fetch(targetUrl, {
        method: 'GET',
        headers,
      });
    } catch (directErr) {
      fetchError = directErr;
    }
  }

  const latencyMs = Math.round(performance.now() - startTime);

  if (!response) {
    if (provider.presetKey === 'ollama') {
      return {
        status: 'offline',
        statusMessage: 'Offline: Local Ollama daemon not reachable at localhost:11434',
        latencyMs,
        models: [],
        balanceInfo: null,
      };
    }

    return {
      status: 'offline',
      statusMessage: `Connection Failed: ${fetchError?.message || 'Host unreachable'}`,
      latencyMs,
      models: [],
      balanceInfo: null,
    };
  }

  if (response.status === 401 || response.status === 403) {
    return {
      status: 'invalid_key',
      statusMessage: `Authentication Failed (${response.status}): Key invalid or expired`,
      latencyMs,
      models: [],
      balanceInfo: null,
    };
  }

  if (response.status === 429) {
    const retryAfter = response.headers.get('retry-after') || '60';
    return {
      status: 'rate_limited',
      statusMessage: `Rate Limited (429): Quota exhausted. Backoff ${retryAfter}s.`,
      latencyMs,
      models: [],
      balanceInfo: null,
    };
  }

  if (response.status >= 500) {
    return {
      status: 'degraded',
      statusMessage: `Service Outage (${response.status}): Upstream returned server error`,
      latencyMs,
      models: [],
      balanceInfo: null,
    };
  }

  // Handle successful response: parse dynamic model catalog
  let discoveredModels: LLMModel[] = [];
  let balanceInfo: ProviderConfig['balanceInfo'] = null;

  try {
    const rawData = await response.json();
    const nowIso = new Date().toISOString();

    if (provider.presetKey === 'ollama' && Array.isArray(rawData?.models)) {
      discoveredModels = rawData.models.map((m: any) => ({
        id: m.name || m.model,
        name: m.name || m.model,
        providerId: provider.id,
        contextWindow: m.details?.parameter_size ? parseInt(m.details.parameter_size, 10) : undefined,
        inputCostPer1m: 0,
        outputCostPer1m: 0,
        category: 'general',
        supportsStreaming: true,
        lastDiscoveredAt: nowIso,
      }));
    } else if (Array.isArray(rawData?.data)) {
      discoveredModels = rawData.data.map((m: any) => {
        const id = m.id || m.name;
        return {
          id,
          name: m.name || id,
          providerId: provider.id,
          contextWindow: m.context_length || (m.max_tokens ? m.max_tokens * 2 : 32768),
          inputCostPer1m: m.pricing?.prompt ? parseFloat(m.pricing.prompt) * 1000000 : 0.50,
          outputCostPer1m: m.pricing?.completion ? parseFloat(m.pricing.completion) * 1000000 : 1.50,
          category: (id.includes('reason') || id.includes('r1') || id.includes('o1') || id.includes('o3'))
            ? 'reasoning'
            : (id.includes('code') || id.includes('coder'))
            ? 'coding'
            : (id.includes('flash') || id.includes('mini') || id.includes('haiku') || id.includes('8b'))
            ? 'fast'
            : 'general',
          supportsStreaming: true,
          description: m.description || `Discovered from ${provider.name} at ${provider.baseUrl}`,
          lastDiscoveredAt: nowIso,
        };
      });
    } else if (Array.isArray(rawData?.models)) {
      discoveredModels = rawData.models.map((m: any) => {
        const id = m.id || m.name || String(m);
        return {
          id,
          name: m.display_name || m.name || id,
          providerId: provider.id,
          contextWindow: m.context_window || 32768,
          inputCostPer1m: 1.0,
          outputCostPer1m: 3.0,
          category: 'general',
          supportsStreaming: true,
          lastDiscoveredAt: nowIso,
        };
      });
    }

    // For OpenRouter instances, fetch live upstream balance
    if (provider.presetKey === 'openrouter' && provider.apiKey) {
      try {
        const balanceRes = await fetch('/api/proxy', {
          headers: {
            'Authorization': `Bearer ${provider.apiKey}`,
            'x-target-url': 'https://openrouter.ai/api/v1/auth/key',
          },
        });
        if (balanceRes.ok) {
          const bData = await balanceRes.json();
          const info = bData?.data;
          if (info) {
            const usage = info.usage || 0;
            const limit = info.limit;
            const remaining = (limit !== null && limit !== undefined) ? Math.max(0, limit - usage) : undefined;
            balanceInfo = {
              creditsRemainingUsd: remaining,
              usageTotalUsd: usage,
              isFreeTier: info.is_free_tier ?? false,
              rateLimitRemaining: info.rate_limit?.requests,
              rateLimitReset: info.rate_limit?.interval,
            };
          }
        }
      } catch (bErr) {
        console.warn('Could not fetch OpenRouter balance:', bErr);
      }
    }

    return {
      status: 'active',
      statusMessage: `Active (Valid) · ${discoveredModels.length} models discovered`,
      latencyMs,
      models: discoveredModels,
      balanceInfo,
    };
  } catch {
    return {
      status: 'active',
      statusMessage: 'Active (Valid) · Verified connection',
      latencyMs,
      models: [],
      balanceInfo: null,
    };
  }
}

/**
 * Dispatch test completion prompt to provider
 */
export async function dispatchTestCompletion(
  provider: ProviderConfig,
  modelId: string,
  prompt: string
): Promise<{
  text: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
  status: 'success' | 'rate_limited' | 'auth_error' | 'network_error' | 'server_error';
  rawPayload: any;
  error?: string;
}> {
  const startTime = performance.now();

  let endpoint = provider.baseUrl.replace(/\/+$/, '');
  let body: any;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (provider.authType === 'bearer') {
    headers['Authorization'] = `Bearer ${provider.apiKey}`;
  } else if (provider.authType === 'x-api-key') {
    headers['x-api-key'] = provider.apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else if (provider.authType === 'custom' && provider.customHeaderName) {
    headers[provider.customHeaderName] = provider.apiKey;
  }

  if (provider.presetKey === 'anthropic' || provider.id.startsWith('anthropic')) {
    endpoint += '/messages';
    body = {
      model: modelId,
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
    };
  } else if (provider.presetKey === 'ollama' || provider.id.startsWith('ollama')) {
    endpoint += '/api/generate';
    body = {
      model: modelId,
      prompt,
      stream: false,
    };
  } else {
    // OpenAI-compatible chat completion endpoint
    if (!endpoint.endsWith('/chat/completions')) {
      if (endpoint.endsWith('/v1')) {
        endpoint += '/chat/completions';
      } else {
        endpoint += '/v1/chat/completions';
      }
    }
    body = {
      model: modelId,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 400,
    };
  }

  try {
    const response = await fetch('/api/proxy', {
      method: 'POST',
      headers: {
        ...headers,
        'x-target-url': endpoint,
      },
      body: JSON.stringify(body),
    });

    const latencyMs = Math.round(performance.now() - startTime);

    if (response.status === 401 || response.status === 403) {
      return {
        text: '',
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        latencyMs,
        status: 'auth_error',
        rawPayload: { status: response.status },
        error: `Authentication failed (${response.status}) - verify API key.`,
      };
    }

    if (response.status === 429) {
      return {
        text: '',
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        latencyMs,
        status: 'rate_limited',
        rawPayload: { status: 429 },
        error: 'Rate limit or quota exceeded (429). Please back off requests.',
      };
    }

    if (!response.ok) {
      const errText = await response.text();
      return {
        text: '',
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        latencyMs,
        status: 'server_error',
        rawPayload: errText,
        error: `Provider HTTP Error ${response.status}: ${errText.slice(0, 200)}`,
      };
    }

    const data = await response.json();
    let text = '';
    let promptTokens = Math.max(1, Math.round(prompt.length / 4));
    let completionTokens = 0;

    if (provider.presetKey === 'anthropic' || provider.id.startsWith('anthropic')) {
      text = data?.content?.[0]?.text || '';
      promptTokens = data?.usage?.input_tokens || promptTokens;
      completionTokens = data?.usage?.output_tokens || Math.round(text.length / 4);
    } else if (provider.presetKey === 'ollama' || provider.id.startsWith('ollama')) {
      text = data?.response || '';
      promptTokens = data?.prompt_eval_count || promptTokens;
      completionTokens = data?.eval_count || Math.round(text.length / 4);
    } else {
      text = data?.choices?.[0]?.message?.content || '';
      promptTokens = data?.usage?.prompt_tokens || promptTokens;
      completionTokens = data?.usage?.completion_tokens || Math.round(text.length / 4);
    }

    return {
      text,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      latencyMs,
      status: 'success',
      rawPayload: data,
    };
  } catch (netErr: any) {
    const latencyMs = Math.round(performance.now() - startTime);
    return {
      text: '',
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      latencyMs,
      status: 'network_error',
      rawPayload: { error: netErr?.message },
      error: `Network request failed: ${netErr?.message || 'Connection refused'}`,
    };
  }
}
