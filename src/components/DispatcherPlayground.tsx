import React, { useMemo, useRef, useState } from 'react';
import { LedgerEntry, ProviderConfig, ProviderId } from '../types';
import { CompletionResult, CompletionStatus, dispatchTestCompletion } from '../services/providers';
import { calculateCost, resolvePrice } from '../services/ledger';

interface DispatcherPlaygroundProps {
  providers: ProviderConfig[];
  initialProviderId?: ProviderId;
  initialModelId?: string;
  onRecordTransaction: (entry: Omit<LedgerEntry, 'id' | 'timestamp'>) => void;
}

const STATUS_STYLE: Record<CompletionStatus, string> = {
  success: 'border-zinc-600 bg-zinc-800 text-white',
  rate_limited: 'border-amber-800 bg-amber-950/50 text-amber-300',
  auth_error: 'border-rose-800 bg-rose-950/50 text-rose-300',
  network_error: 'border-rose-800 bg-rose-950/40 text-rose-300',
  server_error: 'border-rose-800 bg-rose-950/40 text-rose-300',
  timeout: 'border-amber-800 bg-amber-950/40 text-amber-300',
  cancelled: 'border-zinc-700 bg-zinc-900 text-zinc-400',
};

export const DispatcherPlayground: React.FC<DispatcherPlaygroundProps> = ({
  providers,
  initialProviderId,
  initialModelId,
  onRecordTransaction,
}) => {
  const [selectedProviderId, setSelectedProviderId] = useState<ProviderId>(
    initialProviderId ||
      providers.find(provider => provider.apiKey || provider.authType === 'none')?.id ||
      providers[0]?.id ||
      ''
  );

  const selectedProvider =
    providers.find(provider => provider.id === selectedProviderId) ?? providers[0];

  const [selectedModelId, setSelectedModelId] = useState<string>(
    initialModelId || selectedProvider?.models[0]?.id || ''
  );
  const [customModelOverride, setCustomModelOverride] = useState('');

  const [prompt, setPrompt] = useState(
    'Summarise in two sentences why a local API key vault should never store the master password.'
  );
  const [maxTokens, setMaxTokens] = useState(400);
  const [temperature, setTemperature] = useState(0.7);

  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<(CompletionResult & { costUsd: number }) | null>(null);
  const [showRawJson, setShowRawJson] = useState(false);
  const [hasCopied, setHasCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const effectiveModelId = customModelOverride.trim() || selectedModelId || '';

  // Price is resolved from what the provider published for this exact model,
  // not from a hardcoded default.
  const price = useMemo(
    () => resolvePrice(selectedProvider, effectiveModelId),
    [selectedProvider, effectiveModelId]
  );

  const handleProviderChange = (nextId: ProviderId) => {
    setSelectedProviderId(nextId);
    const provider = providers.find(candidate => candidate.id === nextId);
    setSelectedModelId(provider?.models[0]?.id ?? '');
    setCustomModelOverride('');
  };

  const handleExecute = async () => {
    if (!prompt.trim() || isLoading || !selectedProvider) return;
    if (!effectiveModelId) {
      setResult({
        text: '',
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        latencyMs: 0,
        status: 'server_error',
        rawPayload: null,
        error: 'Choose a model, or type a model id, before dispatching.',
        tokensEstimated: false,
        costUsd: 0,
      });
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setIsLoading(true);
    setResult(null);

    const outcome = await dispatchTestCompletion(selectedProvider, effectiveModelId, prompt, {
      maxTokens,
      temperature,
      signal: controller.signal,
    });

    const costUsd = calculateCost(outcome.promptTokens, outcome.completionTokens, price);
    setResult({ ...outcome, costUsd });
    setIsLoading(false);
    abortRef.current = null;

    onRecordTransaction({
      providerId: selectedProviderId,
      modelId: effectiveModelId,
      promptTokens: outcome.promptTokens,
      completionTokens: outcome.completionTokens,
      totalTokens: outcome.totalTokens,
      costUsd,
      priceSource: price.source,
      latencyMs: outcome.latencyMs,
      status: outcome.status,
      promptSnippet: prompt.slice(0, 160),
      responseSnippet: outcome.text.slice(0, 200),
      errorMessage: outcome.error,
      tokensEstimated: outcome.tokensEstimated,
    });
  };

  const handleCancel = () => {
    abortRef.current?.abort();
    abortRef.current = null;
  };

  const handleCopy = async () => {
    if (!result?.text) return;
    try {
      await navigator.clipboard.writeText(result.text);
      setHasCopied(true);
      window.setTimeout(() => setHasCopied(false), 2000);
    } catch {
      setHasCopied(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 rounded-xl border border-zinc-800 bg-zinc-950/70 p-5 backdrop-blur-md md:flex-row md:items-center">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-light tracking-wide text-zinc-100">Test Dispatcher</h1>
            <span className="rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 font-mono text-xs text-zinc-300">
              Live console
            </span>
          </div>
          <p className="mt-1 text-sm text-zinc-400">
            Send a real completion, inspect tokens and latency, and record the cost in the ledger.
          </p>
        </div>

        <div className="flex items-center gap-2 font-mono text-xs">
          <span className="text-zinc-500">Endpoint:</span>
          <span
            className={`rounded border px-2 py-0.5 ${
              selectedProvider?.status === 'active'
                ? 'border-zinc-600 bg-zinc-800 font-medium text-white'
                : 'border-zinc-800 bg-zinc-900 text-zinc-400'
            }`}
          >
            {selectedProvider?.status ?? 'none'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 rounded-xl border border-zinc-800 bg-zinc-950/50 p-4 font-mono text-xs md:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-zinc-400">[1. Target endpoint]</label>
          <select
            value={selectedProviderId}
            onChange={event => handleProviderChange(event.target.value)}
            className="w-full cursor-pointer rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-white focus:border-zinc-500 focus:outline-none"
          >
            {providers.map(provider => (
              <option key={provider.id} value={provider.id}>
                {provider.name} [{provider.status}]
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1.5 block text-zinc-400">[2. Model]</label>
          {selectedProvider && selectedProvider.models.length > 0 ? (
            <div className="space-y-1.5">
              <select
                value={selectedModelId}
                onChange={event => {
                  setSelectedModelId(event.target.value);
                  setCustomModelOverride('');
                }}
                className="w-full cursor-pointer rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-white focus:border-zinc-500 focus:outline-none"
              >
                {selectedProvider.models.map(model => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                  </option>
                ))}
              </select>
              <input
                type="text"
                placeholder="…or type a model id to override"
                value={customModelOverride}
                onChange={event => setCustomModelOverride(event.target.value)}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-white placeholder-zinc-600 focus:border-zinc-500 focus:outline-none"
              />
            </div>
          ) : (
            <input
              type="text"
              placeholder="No models discovered yet — type a model id"
              value={customModelOverride}
              onChange={event => setCustomModelOverride(event.target.value)}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-white placeholder-zinc-500 focus:border-zinc-500 focus:outline-none"
            />
          )}
        </div>
      </div>

      <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-950/70 p-4 font-mono">
        <div className="flex items-center justify-between text-xs text-zinc-400">
          <label>[Prompt]</label>
          <span className="text-zinc-500">~{Math.round(prompt.length / 4)} tokens</span>
        </div>

        <textarea
          rows={4}
          value={prompt}
          onChange={event => setPrompt(event.target.value)}
          placeholder="Enter a prompt…"
          className="w-full rounded-lg border border-zinc-800 bg-zinc-900 p-3 font-mono text-xs text-white placeholder-zinc-600 focus:border-zinc-500 focus:outline-none"
        />

        <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-zinc-400">Max tokens</label>
            <input
              type="number"
              min={1}
              max={8192}
              value={maxTokens}
              onChange={event => setMaxTokens(Number(event.target.value) || 1)}
              className="w-full rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-white focus:border-zinc-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-zinc-400">Temperature</label>
            <input
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={temperature}
              onChange={event => setTemperature(Number(event.target.value))}
              className="w-full rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-white focus:border-zinc-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-zinc-400">Price used</label>
            <div className="rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-zinc-300">
              {price.source === 'local'
                ? 'local · free'
                : `$${price.inputPer1m.toFixed(2)} in / $${price.outputPer1m.toFixed(2)} out`}
              {price.source === 'estimate' && (
                <span className="ml-1 text-amber-400">(estimate)</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between pt-1 text-xs">
          <button
            onClick={() => setPrompt('')}
            className="cursor-pointer text-zinc-500 transition-colors hover:text-zinc-300"
          >
            [Clear prompt]
          </button>

          <div className="flex items-center gap-2">
            {isLoading && (
              <button
                onClick={handleCancel}
                className="cursor-pointer rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-zinc-300 transition-colors hover:border-rose-700 hover:text-rose-300"
              >
                [Cancel]
              </button>
            )}
            <button
              onClick={() => void handleExecute()}
              disabled={isLoading || !prompt.trim()}
              className="cursor-pointer rounded-lg bg-zinc-200 px-5 py-2 font-mono font-bold text-zinc-950 shadow-[0_0_12px_rgba(255,255,255,0.15)] transition-colors hover:bg-white disabled:opacity-50"
            >
              {isLoading ? '[Dispatching…]' : '[Dispatch completion]'}
            </button>
          </div>
        </div>
      </div>

      {result && (
        <div className="animate-slidefadein space-y-4 rounded-xl border border-zinc-800 bg-zinc-950/80 p-5 font-mono text-xs">
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
            <div className="flex flex-wrap items-center gap-4">
              <span
                className={`rounded border px-2 py-0.5 text-[10px] uppercase ${STATUS_STYLE[result.status]}`}
              >
                {result.status.replace('_', ' ')}
              </span>
              <span className="text-zinc-300">{result.latencyMs} ms</span>
              <span className="text-zinc-300">
                {result.totalTokens} tokens ({result.promptTokens} in / {result.completionTokens}{' '}
                out)
                {result.tokensEstimated && (
                  <span className="ml-1 text-amber-400">· estimated</span>
                )}
              </span>
              <span className="font-medium text-white">${result.costUsd.toFixed(5)}</span>
              <span className="text-[10px] text-zinc-500">({price.source})</span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowRawJson(!showRawJson)}
                className="cursor-pointer rounded border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-zinc-300 transition-colors hover:text-white"
              >
                {showRawJson ? '[Hide JSON]' : '[Inspect JSON]'}
              </button>
              <button
                onClick={() => void handleCopy()}
                disabled={!result.text}
                className="cursor-pointer rounded border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-zinc-300 transition-colors hover:text-white disabled:opacity-40"
              >
                {hasCopied ? '[Copied]' : '[Copy response]'}
              </button>
            </div>
          </div>

          {result.error && (
            <div className="rounded-lg border border-rose-900/50 bg-rose-950/20 p-3 text-rose-300">
              <p className="font-semibold">[Error]</p>
              <p className="mt-0.5 text-zinc-400">{result.error}</p>
            </div>
          )}

          {showRawJson && (
            <div className="max-h-60 overflow-x-auto rounded-lg border border-zinc-800 bg-black p-3 text-zinc-300">
              <pre>{JSON.stringify(result.rawPayload, null, 2)}</pre>
            </div>
          )}

          <div className="space-y-1.5">
            <span className="text-[11px] uppercase tracking-wider text-zinc-500">[Output]</span>
            <div className="whitespace-pre-wrap rounded-lg border border-zinc-800 bg-zinc-900/90 p-4 text-xs leading-relaxed text-white">
              {result.text || '(empty response)'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DispatcherPlayground;
