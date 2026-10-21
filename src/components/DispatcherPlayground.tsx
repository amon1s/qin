import React, { useState } from 'react';
import { ProviderConfig, ProviderId, LedgerEntry } from '../types';
import { dispatchTestCompletion } from '../services/providers';
import { calculateCost } from '../services/ledger';

interface DispatcherPlaygroundProps {
  providers: ProviderConfig[];
  initialProviderId?: ProviderId;
  initialModelId?: string;
  onRecordTransaction: (entry: Omit<LedgerEntry, 'id' | 'timestamp'>) => void;
}

export const DispatcherPlayground: React.FC<DispatcherPlaygroundProps> = ({
  providers,
  initialProviderId,
  initialModelId,
  onRecordTransaction,
}) => {
  const [selectedProviderId, setSelectedProviderId] = useState<ProviderId>(
    initialProviderId || providers.find(p => p.apiKey || p.authType === 'none')?.id || providers[0]?.id || 'openai'
  );

  const selectedProvider = providers.find(p => p.id === selectedProviderId) || providers[0];

  const [selectedModelId, setSelectedModelId] = useState<string>(
    initialModelId || selectedProvider?.models[0]?.id || ''
  );

  const [customModelOverride, setCustomModelOverride] = useState('');

  const [prompt, setPrompt] = useState(
    'Synthesize an optimal configuration for high-throughput LLM API routing with token-bucket rate limiting and zero-latency failover.'
  );

  const [isLoading, setIsLoading] = useState(false);
  const [responseResult, setResponseResult] = useState<{
    text: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    latencyMs: number;
    costUsd: number;
    status: 'success' | 'rate_limited' | 'auth_error' | 'network_error' | 'server_error';
    rawPayload: any;
    error?: string;
  } | null>(null);

  const [showRawJson, setShowRawJson] = useState(false);
  const [hasCopied, setHasCopied] = useState(false);

  const handleProviderChange = (newPid: ProviderId) => {
    setSelectedProviderId(newPid);
    const p = providers.find(prov => prov.id === newPid);
    if (p && p.models.length > 0) {
      setSelectedModelId(p.models[0].id);
    } else {
      setSelectedModelId('');
    }
  };

  const effectiveModelId = customModelOverride.trim() || selectedModelId || 'default-model';

  const handleExecute = async () => {
    if (!prompt.trim() || isLoading) return;
    setIsLoading(true);
    setResponseResult(null);

    const result = await dispatchTestCompletion(selectedProvider, effectiveModelId, prompt);
    const costUsd = calculateCost(selectedProviderId, effectiveModelId, result.promptTokens, result.completionTokens);

    const fullResult = {
      ...result,
      costUsd,
    };

    setResponseResult(fullResult);
    setIsLoading(false);

    // Record in local token ledger
    onRecordTransaction({
      providerId: selectedProviderId,
      modelId: effectiveModelId,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      totalTokens: result.totalTokens,
      costUsd,
      latencyMs: result.latencyMs,
      status: result.status,
      promptSnippet: prompt.slice(0, 160),
      responseSnippet: result.text.slice(0, 200),
      errorMessage: result.error,
    });
  };

  const handleCopyResponse = () => {
    if (!responseResult?.text) return;
    navigator.clipboard.writeText(responseResult.text);
    setHasCopied(true);
    setTimeout(() => setHasCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 p-5 rounded-xl border border-zinc-800 bg-zinc-950/70 backdrop-blur-md">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-light text-zinc-100 tracking-wide">
              Interactive Test Dispatcher
            </h1>
            <span className="text-xs font-mono px-2 py-0.5 rounded bg-zinc-900 text-zinc-300 border border-zinc-700">
              Live Console
            </span>
          </div>
          <p className="text-sm text-zinc-400 mt-1">
            Dispatch completions to any discovered model, inspect live tokens, and log round-trip latencies without mock fallbacks.
          </p>
        </div>

        {/* Selected Provider / Key Status */}
        <div className="flex items-center gap-2 font-mono text-xs">
          <span className="text-zinc-500">Provider Status:</span>
          <span
            className={`px-2 py-0.5 rounded border ${
              selectedProvider.status === 'active'
                ? 'bg-zinc-800 text-white border-zinc-600 font-medium'
                : selectedProvider.status === 'invalid_key'
                ? 'bg-rose-950/50 text-rose-300 border-rose-800'
                : 'bg-zinc-900 text-zinc-400 border-zinc-800'
            }`}
          >
            {selectedProvider.status}
          </span>
        </div>
      </div>

      {/* Control Strip: 2-Column Clean Selection (Quick Presets removed per spec!) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 rounded-xl border border-zinc-800 bg-zinc-950/50 font-mono text-xs">
        <div>
          <label className="block text-zinc-400 mb-1.5">[1. Target Provider]</label>
          <select
            value={selectedProviderId}
            onChange={e => handleProviderChange(e.target.value as ProviderId)}
            className="w-full px-3 py-2 rounded-lg border border-zinc-800 bg-zinc-900 text-white focus:outline-none focus:border-zinc-500 cursor-pointer"
          >
            {providers.map(p => (
              <option key={p.id} value={p.id}>
                {p.name} {p.status === 'active' ? '[Valid]' : `[${p.status}]`}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-zinc-400 mb-1.5">[2. Discovered Model Target]</label>
          {selectedProvider.models.length > 0 ? (
            <select
              value={selectedModelId}
              onChange={e => {
                setSelectedModelId(e.target.value);
                setCustomModelOverride('');
              }}
              className="w-full px-3 py-2 rounded-lg border border-zinc-800 bg-zinc-900 text-white focus:outline-none focus:border-zinc-500 cursor-pointer"
            >
              {selectedProvider.models.map(m => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.id})
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              placeholder="No models auto-discovered yet. Type model ID..."
              value={customModelOverride}
              onChange={e => setCustomModelOverride(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-zinc-800 bg-zinc-900 text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
            />
          )}
        </div>
      </div>

      {/* Prompt Editor & Dispatch Action */}
      <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-950/70 space-y-3 font-mono">
        <div className="flex items-center justify-between text-xs text-zinc-400">
          <label>[Prompt Payload Message]</label>
          <span className="text-zinc-500">Approx. {Math.round(prompt.length / 4)} tokens</span>
        </div>

        <textarea
          rows={4}
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          placeholder="Enter prompt for live model execution..."
          className="w-full p-3 text-xs font-mono rounded-lg border border-zinc-800 bg-zinc-900 text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
        />

        <div className="flex items-center justify-between pt-1 text-xs">
          <button
            onClick={() => setPrompt('')}
            className="text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
          >
            [Clear Prompt]
          </button>

          <button
            onClick={handleExecute}
            disabled={isLoading || !prompt.trim()}
            className="px-5 py-2 rounded-lg bg-zinc-200 hover:bg-white text-zinc-950 font-mono font-bold transition-colors disabled:opacity-50 cursor-pointer shadow-[0_0_12px_rgba(255,255,255,0.15)]"
          >
            {isLoading ? '[Dispatching Request...]' : '[Dispatch Completion]'}
          </button>
        </div>
      </div>

      {/* Execution Results View */}
      {responseResult && (
        <div className="p-5 rounded-xl border border-zinc-800 bg-zinc-950/80 space-y-4 font-mono animate-slidefadein text-xs">
          {/* Metrics summary bar */}
          <div className="flex flex-wrap items-center justify-between gap-4 p-3 rounded-lg border border-zinc-800 bg-zinc-900/60">
            <div className="flex items-center gap-4">
              <span className="text-zinc-300">
                {responseResult.latencyMs} ms latency
              </span>

              <span className="text-zinc-300">
                {responseResult.totalTokens} tokens ({responseResult.promptTokens} in / {responseResult.completionTokens} out)
              </span>

              <span className="text-white font-medium">
                ${responseResult.costUsd.toFixed(5)} cost
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowRawJson(!showRawJson)}
                className="px-2.5 py-1 rounded border border-zinc-700 bg-zinc-800 text-zinc-300 hover:text-white transition-colors cursor-pointer"
              >
                {showRawJson ? '[Hide JSON]' : '[Inspect JSON]'}
              </button>

              <button
                onClick={handleCopyResponse}
                className="px-2.5 py-1 rounded border border-zinc-700 bg-zinc-800 text-zinc-300 hover:text-white transition-colors cursor-pointer"
              >
                {hasCopied ? '[Copied]' : '[Copy Response]'}
              </button>
            </div>
          </div>

          {/* Error Notice if any */}
          {responseResult.error && (
            <div className="p-3 rounded-lg border border-rose-900/50 bg-rose-950/20 text-rose-300">
              <p className="font-semibold">[Execution Error / Notice]:</p>
              <p className="mt-0.5 text-zinc-400">{responseResult.error}</p>
            </div>
          )}

          {/* Raw JSON Inspection Drawer */}
          {showRawJson && (
            <div className="p-3 rounded-lg border border-zinc-800 bg-black text-zinc-300 overflow-x-auto max-h-60">
              <pre>{JSON.stringify(responseResult.rawPayload, null, 2)}</pre>
            </div>
          )}

          {/* Response Output Display */}
          <div className="space-y-1.5">
            <span className="text-zinc-500 uppercase tracking-wider text-[11px]">
              [Completion Output]
            </span>
            <div className="p-4 rounded-lg border border-zinc-800 bg-zinc-900/90 text-white text-xs whitespace-pre-wrap leading-relaxed">
              {responseResult.text || '(Empty response or error returned)'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DispatcherPlayground;
