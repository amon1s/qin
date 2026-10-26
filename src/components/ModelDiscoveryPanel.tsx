import React, { useState, useMemo } from 'react';
import { LLMModel, ProviderConfig, ProviderId } from '../types';

interface ModelDiscoveryPanelProps {
  providers: ProviderConfig[];
  onSelectModelForTest: (providerId: ProviderId, modelId: string) => void;
  onRefreshDiscovery: () => Promise<void>;
  isRefreshing: boolean;
}

export const ModelDiscoveryPanel: React.FC<ModelDiscoveryPanelProps> = ({
  providers,
  onSelectModelForTest,
  onRefreshDiscovery,
  isRefreshing,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProviderFilter, setSelectedProviderFilter] = useState<string>('all');
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string>('all');

  // Collect dynamically discovered models across all providers
  const allDiscoveredModels = useMemo(() => {
    const list: LLMModel[] = [];
    providers.forEach(p => {
      p.models.forEach(m => {
        list.push({ ...m, providerId: p.id });
      });
    });
    return list;
  }, [providers]);

  // Filtered models
  const filteredModels = useMemo(() => {
    return allDiscoveredModels.filter(m => {
      const matchesSearch =
        m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (m.description && m.description.toLowerCase().includes(searchQuery.toLowerCase()));

      const matchesProvider =
        selectedProviderFilter === 'all' || m.providerId === selectedProviderFilter;

      const matchesCategory =
        selectedCategoryFilter === 'all' || m.category === selectedCategoryFilter;

      return matchesSearch && matchesProvider && matchesCategory;
    });
  }, [allDiscoveredModels, searchQuery, selectedProviderFilter, selectedCategoryFilter]);

  const categories = [
    { id: 'all', label: 'All' },
    { id: 'reasoning', label: 'Reasoning' },
    { id: 'coding', label: 'Coding' },
    { id: 'fast', label: 'Fast' },
    { id: 'general', label: 'General' },
  ];

  const formatContext = (tokens?: number) => {
    if (!tokens) return 'Unknown ctx';
    if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M ctx`;
    if (tokens >= 1000) return `${Math.round(tokens / 1000)}k ctx`;
    return `${tokens} ctx`;
  };

  const formatParams = (count?: number) => {
    if (!count) return null;
    if (count >= 1e9) return `${(count / 1e9).toFixed(count % 1e9 === 0 ? 0 : 1)}B params`;
    if (count >= 1e6) return `${(count / 1e6).toFixed(0)}M params`;
    if (count >= 1e3) return `${(count / 1e3).toFixed(0)}k params`;
    return `${count} params`;
  };

  return (
    <div className="space-y-6">
      {/* Header and Controls */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 p-5 rounded-xl border border-zinc-800 bg-zinc-950/70 backdrop-blur-md">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-light text-zinc-100 tracking-wide">
              Dynamic Model Discovery
            </h1>
            <span className="text-xs font-mono px-2 py-0.5 rounded bg-zinc-900 border border-zinc-700 text-zinc-300">
              {allDiscoveredModels.length} Models Discovered
            </span>
          </div>
          <p className="text-sm text-zinc-400 mt-1">
            Real-time discovered models queried directly from configured provider endpoints via GET /v1/models or native APIs.
          </p>
        </div>

        {/* Text-based Fetch/Refresh Button */}
        <button
          onClick={() => onRefreshDiscovery()}
          disabled={isRefreshing}
          className="px-4 py-2 rounded-lg border border-zinc-700 hover:border-zinc-500 bg-zinc-900 text-xs font-mono text-zinc-200 hover:text-white transition-colors disabled:opacity-50 cursor-pointer"
        >
          {isRefreshing ? '[Querying Endpoints...]' : '[Fetch / Refresh Models]'}
        </button>
      </div>

      {/* Filter and Search Bar (Text-First, Zero Icons) */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3 rounded-lg border border-zinc-800 bg-zinc-950/50 font-mono text-xs">
        {/* Search input */}
        <div className="flex-1">
          <input
            type="text"
            placeholder="Search discovered models by ID, name, or description..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full px-3 py-2 text-xs font-mono rounded-md border border-zinc-800 bg-zinc-900/80 text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
          />
        </div>

        {/* Provider selector */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-zinc-500">Provider:</span>
          <select
            value={selectedProviderFilter}
            onChange={e => setSelectedProviderFilter(e.target.value)}
            className="px-3 py-2 text-xs font-mono rounded-md border border-zinc-800 bg-zinc-900 text-zinc-300 focus:outline-none focus:border-zinc-500 cursor-pointer"
          >
            <option value="all">All Providers ({allDiscoveredModels.length})</option>
            {providers.map(p => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.models.length})
              </option>
            ))}
          </select>

          {/* Category filter tabs */}
          <div className="hidden lg:flex items-center gap-1 p-0.5 rounded-md bg-zinc-900 border border-zinc-800">
            {categories.map(cat => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategoryFilter(cat.id)}
                className={`px-2 py-1 rounded text-xs transition-colors cursor-pointer ${
                  selectedCategoryFilter === cat.id
                    ? 'bg-zinc-800 text-white font-medium border border-zinc-600'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Discovered Models List / Grid */}
      {filteredModels.length === 0 ? (
        <div className="p-12 text-center rounded-xl border border-dashed border-zinc-800 text-zinc-500 font-mono text-xs space-y-2">
          <p className="text-zinc-400 text-sm">
            {allDiscoveredModels.length === 0
              ? 'No models discovered yet.'
              : 'No discovered models match the search query.'}
          </p>
          <p className="text-zinc-500 max-w-md mx-auto leading-relaxed">
            {allDiscoveredModels.length === 0
              ? 'Configure API keys in the Key Vault and trigger [Fetch / Refresh Models] to auto-discover all available models provided by your endpoints.'
              : 'Try clearing your search query or switching provider filters.'}
          </p>
          {allDiscoveredModels.length === 0 && (
            <div className="pt-2">
              <button
                onClick={() => onRefreshDiscovery()}
                disabled={isRefreshing}
                className="px-4 py-2 rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-200 hover:text-white transition-colors cursor-pointer"
              >
                {isRefreshing ? '[Querying Endpoints...]' : '[Fetch / Refresh Models]'}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredModels.map(model => {
            const provider = providers.find(p => p.id === model.providerId);
            const isConfigured = provider && (provider.apiKey || provider.authType === 'none');

            return (
              <div
                key={`${model.providerId}-${model.id}`}
                className="p-4 rounded-xl border border-zinc-800 bg-zinc-950/60 hover:border-zinc-600 hover:bg-zinc-900/40 transition-all flex flex-col justify-between"
              >
                <div>
                  {/* Top line: Provider name + category */}
                  <div className="flex items-center justify-between gap-2 mb-2 font-mono text-xs">
                    <span className="px-2 py-0.5 rounded bg-zinc-900 text-zinc-300 border border-zinc-800">
                      {provider?.name || model.providerId}
                    </span>

                    {model.category && (
                      <span className="text-[10px] text-zinc-400 uppercase tracking-wider">
                        {model.category}
                      </span>
                    )}
                  </div>

                  {/* Model Name & ID */}
                  <h2 className="text-base font-medium text-white">
                    {model.name}
                  </h2>
                  <code className="text-xs font-mono text-zinc-400 block mt-0.5 break-all">
                    {model.id}
                  </code>

                  {/* Description */}
                  {model.description && (
                    <p className="text-xs text-zinc-400 mt-2 line-clamp-2 leading-relaxed">
                      {model.description}
                    </p>
                  )}
                </div>

                {/* Specs and action */}
                <div className="mt-4 pt-3 border-t border-zinc-800/60 font-mono text-xs">
                  <div className="flex items-center justify-between text-zinc-400 mb-3">
                    <span className="flex items-center gap-2">
                      <span>{formatContext(model.contextWindow)}</span>
                      {formatParams(model.parameterCount) && (
                        <span className="text-zinc-500">· {formatParams(model.parameterCount)}</span>
                      )}
                    </span>
                    {model.inputCostPer1m !== undefined && model.outputCostPer1m !== undefined ? (
                      <span className="text-zinc-400">
                        ${model.inputCostPer1m.toFixed(2)} in / ${model.outputCostPer1m.toFixed(2)} out
                      </span>
                    ) : (
                      <span className="text-zinc-600" title="This provider publishes no pricing for the model">
                        price not published
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-zinc-500">
                      {model.lastDiscoveredAt ? 'Dynamic API Verified' : 'Live Endpoint'}
                    </span>

                    <button
                      onClick={() => onSelectModelForTest(model.providerId, model.id)}
                      className={`px-3 py-1 rounded text-xs transition-colors cursor-pointer ${
                        isConfigured
                          ? 'bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 text-white font-medium'
                          : 'bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-400'
                      }`}
                    >
                      [Test Prompt]
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ModelDiscoveryPanel;
