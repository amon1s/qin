import React, { useState, useMemo } from 'react';
import { LedgerEntry, ProviderConfig } from '../types';
import { exportLedgerCsv } from '../services/ledger';

interface TokenLedgerPanelProps {
  entries: LedgerEntry[];
  providers: ProviderConfig[];
  onClearLedger: () => void;
}

export const TokenLedgerPanel: React.FC<TokenLedgerPanelProps> = ({
  entries,
  providers,
  onClearLedger,
}) => {
  const [filterProvider, setFilterProvider] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showConfirmClear, setShowConfirmClear] = useState(false);

  // Filter entries
  const filteredEntries = useMemo(() => {
    return entries.filter(e => {
      const matchesProvider = filterProvider === 'all' || e.providerId === filterProvider;
      const matchesSearch =
        e.modelId.toLowerCase().includes(searchQuery.toLowerCase()) ||
        e.promptSnippet.toLowerCase().includes(searchQuery.toLowerCase()) ||
        e.id.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesProvider && matchesSearch;
    });
  }, [entries, filterProvider, searchQuery]);

  // Summary Metrics (100% dynamic, computed solely from actual entries)
  const metrics = useMemo(() => {
    let totalTokens = 0;
    let totalCost = 0;
    let totalLatency = 0;
    let successCount = 0;

    entries.forEach(e => {
      totalTokens += e.totalTokens;
      totalCost += e.costUsd;
      totalLatency += e.latencyMs;
      if (e.status === 'success') successCount++;
    });

    const avgLatency = entries.length > 0 ? Math.round(totalLatency / entries.length) : 0;
    return {
      totalTokens,
      totalCost,
      avgLatency,
      totalEntries: entries.length,
      successRate: entries.length > 0 ? Math.round((successCount / entries.length) * 100) : 100,
    };
  }, [entries]);

  // Live upstream balances where exposed
  const providersWithBalance = useMemo(() => {
    return providers.filter(p => p.balanceInfo && p.apiKey);
  }, [providers]);

  const handleDownloadCsv = () => {
    const csvData = exportLedgerCsv(filteredEntries);
    const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `qin_token_ledger_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      {/* Title & Actions */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 p-5 rounded-xl border border-zinc-800 bg-zinc-950/70 backdrop-blur-md">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-light text-zinc-100 tracking-wide">
              Live Token Ledger & Usage
            </h1>
            <span className="text-xs font-mono px-2 py-0.5 rounded bg-zinc-900 border border-zinc-700 text-zinc-300">
              Synchronized Live Data
            </span>
          </div>
          <p className="text-sm text-zinc-400 mt-1">
            Tracking actual token volume, per-model costs, and live upstream provider balances with zero simulated rows.
          </p>
        </div>

        <div className="flex items-center gap-2 font-mono text-xs">
          <button
            onClick={handleDownloadCsv}
            disabled={entries.length === 0}
            className="px-3 py-1.5 rounded-lg border border-zinc-700 hover:border-zinc-500 bg-zinc-900 text-zinc-300 hover:text-white transition-colors disabled:opacity-40 cursor-pointer"
          >
            [Export CSV]
          </button>

          <button
            onClick={() => setShowConfirmClear(true)}
            disabled={entries.length === 0}
            className="px-3 py-1.5 rounded-lg border border-zinc-800 hover:border-rose-800 bg-zinc-900/60 text-zinc-400 hover:text-rose-300 transition-colors disabled:opacity-40 cursor-pointer"
          >
            [Clear Ledger]
          </button>
        </div>
      </div>

      {/* Layer 1: Live Upstream Balances (Dynamic only) */}
      {providersWithBalance.length > 0 && (
        <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-950/70 font-mono text-xs">
          <div className="text-zinc-400 uppercase tracking-wider text-[11px] mb-3">
            [Layer 1: Live Upstream Provider Balances]
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {providersWithBalance.map(p => (
              <div key={p.id} className="p-3 rounded-lg border border-zinc-800 bg-zinc-900/60">
                <div className="flex items-center justify-between text-zinc-300 mb-1">
                  <span>{p.name} Balance</span>
                  <span className="text-white font-bold">
                    ${p.balanceInfo?.creditsRemainingUsd !== undefined ? p.balanceInfo.creditsRemainingUsd.toFixed(4) : 'Account'}
                  </span>
                </div>
                <div className="text-[11px] text-zinc-500 flex justify-between">
                  <span>Usage:</span>
                  <span className="text-zinc-300">${p.balanceInfo?.usageTotalUsd?.toFixed(4) ?? '0.00'}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Layer 2: Live Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 font-mono">
        <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-950/60">
          <div className="text-xs text-zinc-500 uppercase tracking-wider">
            TOTAL SESSION SPEND
          </div>
          <div className="mt-2 text-2xl font-light text-white tabular-nums">
            ${metrics.totalCost.toFixed(5)}
          </div>
          <div className="mt-1 text-xs text-zinc-500">
            Across {metrics.totalEntries} live requests
          </div>
        </div>

        <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-950/60">
          <div className="text-xs text-zinc-500 uppercase tracking-wider">
            TOTAL TOKEN VOLUME
          </div>
          <div className="mt-2 text-2xl font-light text-white tabular-nums">
            {metrics.totalTokens.toLocaleString()}
          </div>
          <div className="mt-1 text-xs text-zinc-500">
            Prompt + Completion tokens
          </div>
        </div>

        <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-950/60">
          <div className="text-xs text-zinc-500 uppercase tracking-wider">
            AVERAGE LATENCY
          </div>
          <div className="mt-2 text-2xl font-light text-white tabular-nums">
            {metrics.avgLatency} <span className="text-sm text-zinc-400">ms</span>
          </div>
          <div className="mt-1 text-xs text-zinc-500">
            Round-trip response time
          </div>
        </div>

        <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-950/60">
          <div className="text-xs text-zinc-500 uppercase tracking-wider">
            DISPATCH SUCCESS RATE
          </div>
          <div className="mt-2 text-2xl font-light text-white tabular-nums">
            {metrics.successRate}%
          </div>
          <div className="mt-1 text-xs text-zinc-500">
            Recorded completions
          </div>
        </div>
      </div>

      {/* Search & Filter Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3 rounded-lg border border-zinc-800 bg-zinc-950/50 font-mono text-xs">
        <div className="flex-1 w-full">
          <input
            type="text"
            placeholder="Search transactions by model, snippet, or transaction ID..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full px-3 py-2 text-xs font-mono rounded-md border border-zinc-800 bg-zinc-900 text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
          />
        </div>

        <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto">
          <span className="text-zinc-500">Provider:</span>
          <select
            value={filterProvider}
            onChange={e => setFilterProvider(e.target.value)}
            className="w-full sm:w-auto px-3 py-2 text-xs font-mono rounded-md border border-zinc-800 bg-zinc-900 text-zinc-300 focus:outline-none focus:border-zinc-500 cursor-pointer"
          >
            <option value="all">All Providers</option>
            {providers.map(p => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Transactions Table (100% Dynamic, Zero Mock Rows) */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 overflow-hidden font-mono text-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900/60 text-zinc-400">
                <th className="py-3 px-4 font-normal">Timestamp</th>
                <th className="py-3 px-4 font-normal">Provider / Model</th>
                <th className="py-3 px-4 font-normal">Prompt Snippet</th>
                <th className="py-3 px-4 font-normal text-right">Tokens</th>
                <th className="py-3 px-4 font-normal text-right">Cost (USD)</th>
                <th className="py-3 px-4 font-normal text-right">Latency</th>
                <th className="py-3 px-4 font-normal text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50">
              {filteredEntries.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-14 text-center text-zinc-500 space-y-1">
                    <p className="text-zinc-400 text-sm">No transactions recorded yet.</p>
                    <p className="text-zinc-600 text-xs max-w-md mx-auto">
                      Completed requests dispatched via the Test Dispatcher or integrated workflows will be logged here in real time.
                    </p>
                  </td>
                </tr>
              ) : (
                filteredEntries.map(entry => {
                  const dateStr = new Date(entry.timestamp).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  });

                  return (
                    <tr key={entry.id} className="hover:bg-zinc-900/30 transition-colors">
                      <td className="py-3 px-4 text-zinc-500 whitespace-nowrap">
                        {dateStr}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span className="text-zinc-200 font-medium">{entry.providerId}</span>
                          <span className="text-zinc-600">/</span>
                          <span className="text-zinc-400 truncate max-w-[140px]">{entry.modelId}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-zinc-400 max-w-[280px] truncate" title={entry.promptSnippet}>
                        {entry.promptSnippet}
                      </td>
                      <td className="py-3 px-4 text-right tabular-nums text-white">
                        {entry.totalTokens.toLocaleString()}
                        <span className="text-[10px] text-zinc-500 block">
                          {entry.promptTokens} in · {entry.completionTokens} out
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right tabular-nums text-zinc-200 font-medium">
                        ${entry.costUsd.toFixed(5)}
                      </td>
                      <td className="py-3 px-4 text-right tabular-nums text-zinc-400">
                        {entry.latencyMs} ms
                      </td>
                      <td className="py-3 px-4 text-center whitespace-nowrap">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] border ${
                            entry.status === 'success'
                              ? 'bg-zinc-900 border-zinc-700 text-white font-medium'
                              : 'bg-rose-950/40 border-rose-800 text-rose-300'
                          }`}
                        >
                          {entry.status === 'success' ? '200 OK' : entry.status.toUpperCase()}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Confirm Clear Modal */}
      {showConfirmClear && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
          <div className="w-full max-w-md p-6 rounded-xl border border-zinc-700 bg-zinc-950 text-white shadow-2xl space-y-4 font-mono text-xs">
            <h3 className="text-lg font-light text-white">[Clear Local Token Ledger?]</h3>
            <p className="text-zinc-400 leading-relaxed">
              This will permanently delete all {entries.length} recorded session request logs and metrics from your local storage.
            </p>
            <div className="pt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowConfirmClear(false)}
                className="px-3.5 py-1.5 rounded-lg border border-zinc-800 hover:bg-zinc-900 text-zinc-400 cursor-pointer"
              >
                [Cancel]
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowConfirmClear(false);
                  onClearLedger();
                }}
                className="px-4 py-1.5 rounded-lg bg-rose-700 hover:bg-rose-600 text-white font-bold transition-colors cursor-pointer"
              >
                [Confirm Clear]
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TokenLedgerPanel;
