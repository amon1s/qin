export type ProviderId = string;

export type ProviderStatus =
  | 'active'
  | 'invalid_key'
  | 'rate_limited'
  | 'offline'
  | 'degraded'
  | 'unconfigured';

export type AuthType = 'bearer' | 'x-api-key' | 'none' | 'custom';

export interface LLMModel {
  id: string;
  name: string;
  providerId: ProviderId;
  contextWindow?: number;
  /** Absolute parameter count parsed from e.g. Ollama's "7B". */
  parameterCount?: number;
  /** USD per 1M tokens. Undefined when the provider publishes no price. */
  inputCostPer1m?: number;
  /** USD per 1M tokens. Undefined when the provider publishes no price. */
  outputCostPer1m?: number;
  category?: 'general' | 'reasoning' | 'fast' | 'coding' | 'vision';
  supportsStreaming?: boolean;
  description?: string;
  lastDiscoveredAt?: string;
}

export interface ProviderConfig {
  id: ProviderId;
  name: string; // Formatted strictly as: "*Company Name* *Your Name for this API*"
  companyName: string; // e.g. "OpenAI", "Groq", "DeepSeek", "Nous", etc.
  instanceName: string; // e.g. "ABC", "Production", "Personal", "Default"
  baseUrl: string;
  modelsEndpoint: string;
  /** Optional explicit chat path for endpoints that break /v1 conventions. */
  chatEndpoint?: string;
  authType: AuthType;
  customHeaderName?: string;
  apiKey: string; // Plaintext in volatile memory when unlocked
  isCustom?: boolean;
  presetKey?: string; // 'openai' | 'anthropic' | 'groq' | 'deepseek' | 'mistral' | 'openrouter' | 'ollama' | 'openai_compatible' | 'custom'
  status: ProviderStatus;
  statusMessage?: string;
  lastChecked?: string;
  latencyMs?: number;
  balanceInfo?: {
    creditsRemainingUsd?: number;
    usageTotalUsd?: number;
    isFreeTier?: boolean;
    rateLimitRemaining?: number;
    rateLimitReset?: string;
  } | null;
  models: LLMModel[];
}

/** Where a ledger row's cost figure came from. */
export type PriceSource = 'provider' | 'estimate' | 'local';

export type LedgerStatus =
  | 'success'
  | 'rate_limited'
  | 'auth_error'
  | 'network_error'
  | 'server_error'
  | 'timeout'
  | 'cancelled';

export interface LedgerEntry {
  id: string;
  timestamp: string;
  providerId: ProviderId;
  modelId: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  priceSource: PriceSource;
  latencyMs: number;
  status: LedgerStatus;
  promptSnippet: string;
  responseSnippet?: string;
  errorMessage?: string;
  /** True when token counts were estimated locally, not reported upstream. */
  tokensEstimated?: boolean;
}

export interface KeyringState {
  isLocked: boolean;
  hasInitializedVault: boolean;
  masterPasswordHash?: string;
  recoveryKeyHash?: string;
  salt?: string;
  lastUnlocked?: string;
}

export interface AppLogEntry {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'auth' | 'rate_limit';
  providerId?: ProviderId;
  title: string;
  message: string;
  details?: any;
  actionRequired?: string;
}

export interface AppSettings {
  theme: 'dark' | 'light' | 'system';
  blurIntensity: 'none' | 'sm' | 'md' | 'xl';
  fontScale: 'small' | 'medium' | 'large';
  fiberOpacity: number;
  fiberSpeed: number;
  fiberTwist: number;
  fiberGlowColor: string;
  fiberSecondaryColor: string;
  fiberStyle?: 'dots' | 'dashes' | 'lines';
  fiberThreads?: number;
  fiberLayers?: number;
  autoValidateOnStartup: boolean;
}
