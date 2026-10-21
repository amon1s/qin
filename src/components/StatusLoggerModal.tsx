import React, { useState } from 'react';
import { AppLogEntry, ProviderId } from '../types';

interface StatusLoggerModalProps {
  isOpen: boolean;
  onClose: () => void;
  logs: AppLogEntry[];
  onClearLogs: () => void;
  onNavigateToVault: (providerId?: ProviderId) => void;
}

export const StatusLoggerModal: React.FC<StatusLoggerModalProps> = ({
  isOpen,
  onClose,
  logs,
  onClearLogs,
  onNavigateToVault,
}) => {
  const [activeFilter, setActiveFilter] = useState<'all' | 'error' | 'auth' | 'rate_limit'>('all');

  if (!isOpen) return null;

  const filteredLogs = logs.filter(log => {
    if (activeFilter === 'all') return true;
    if (activeFilter === 'auth') return log.level === 'auth';
    if (activeFilter === 'rate_limit') return log.level === 'rate_limit';
    if (activeFilter === 'error') return log.level === 'error';
    return true;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
      <div className="w-full max-w-3xl max-h-[85vh] flex flex-col rounded-xl border border-zinc-800 bg-zinc-950 text-white shadow-2xl overflow-hidden font-mono text-xs">
        {/* Modal Header */}
        <div className="flex items-center justify-between p-4 border-b border-zinc-800 bg-zinc-900/60">
          <div className="flex items-center gap-2.5">
            <h2 className="text-sm font-normal tracking-wide text-white uppercase">
              [Centralized Error & Diagnostics Logger]
            </h2>
            <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 text-[11px]">
              {logs.length} logged events
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClearLogs}
              title="Clear all log entries"
              className="px-2 py-1 rounded border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white transition-colors cursor-pointer"
            >
              [Clear]
            </button>
            <button
              onClick={onClose}
              className="px-2 py-1 rounded border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white transition-colors cursor-pointer"
            >
              [Close]
            </button>
          </div>
        </div>

        {/* Filters Strip (Text-First, Zero Icons) */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-zinc-800 bg-zinc-900/30">
          {(['all', 'auth', 'rate_limit', 'error'] as const).map(filter => (
            <button
              key={filter}
              onClick={() => setActiveFilter(filter)}
              className={`px-3 py-1 rounded text-[11px] transition-colors cursor-pointer ${
                activeFilter === filter
                  ? 'bg-zinc-800 text-white font-medium border border-zinc-600'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              {filter === 'all'
                ? '[All Events]'
                : filter === 'auth'
                ? '[401/403 Auth]'
                : filter === 'rate_limit'
                ? '[429 Rate Limits]'
                : '[Errors & Outages]'}
            </button>
          ))}
        </div>

        {/* Logs List Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2.5 divide-y divide-zinc-800/40">
          {filteredLogs.length === 0 ? (
            <div className="py-12 text-center text-zinc-500">
              <p>[No log events recorded for current filter.]</p>
            </div>
          ) : (
            filteredLogs.map(log => {
              const timeStr = new Date(log.timestamp).toLocaleTimeString();

              return (
                <div key={log.id} className="pt-2.5 first:pt-0 flex items-start justify-between gap-3">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-zinc-500 text-[11px]">{timeStr}</span>
                      <span
                        className={`px-1.5 py-0.2 rounded text-[10px] border ${
                          log.level === 'auth'
                            ? 'bg-rose-950/60 border-rose-800 text-rose-300'
                            : log.level === 'rate_limit'
                            ? 'bg-amber-950/60 border-amber-800 text-amber-300'
                            : log.level === 'error'
                            ? 'bg-rose-950/40 border-rose-800 text-rose-300'
                            : 'bg-zinc-900 border-zinc-800 text-zinc-300'
                        }`}
                      >
                        {log.level.toUpperCase()}
                      </span>
                      {log.providerId && (
                        <span className="text-zinc-400">[{log.providerId}]</span>
                      )}
                      <span className="text-white font-medium">{log.title}</span>
                    </div>
                    <p className="text-zinc-400 leading-relaxed text-[11px]">{log.message}</p>
                    {log.actionRequired && (
                      <p className="text-zinc-300 text-[10px] mt-0.5 font-bold">Action: {log.actionRequired}</p>
                    )}
                  </div>

                  {log.providerId && (
                    <button
                      onClick={() => {
                        onClose();
                        onNavigateToVault(log.providerId);
                      }}
                      className="shrink-0 px-2.5 py-1 rounded border border-zinc-700 bg-zinc-900 text-zinc-300 hover:text-white transition-colors cursor-pointer"
                    >
                      [Fix in Vault]
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-3 border-t border-zinc-800 bg-zinc-900/60 flex items-center justify-between text-zinc-500 text-[11px]">
          <span>Centralized Non-Crashing Diagnostics</span>
          <button
            onClick={onClose}
            className="px-3 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors cursor-pointer"
          >
            [Close]
          </button>
        </div>
      </div>
    </div>
  );
};

export default StatusLoggerModal;
