import React from 'react';

export type ActiveTab = 'vault' | 'discovery' | 'ledger' | 'dispatcher' | 'settings';

interface TopBarProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  onLockVault: () => void;
  onOpenLogs: () => void;
  errorCount: number;
  activeProviderCount: number;
  totalProviderCount: number;
  onReturnToSplash: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  activeTab,
  setActiveTab,
  onLockVault,
  onOpenLogs,
  errorCount,
  activeProviderCount,
  totalProviderCount,
  onReturnToSplash,
}) => {
  const tabs: { id: ActiveTab; label: string; shortcut: string }[] = [
    { id: 'vault', label: 'Key Vault', shortcut: '1' },
    { id: 'discovery', label: 'Discovery', shortcut: '2' },
    { id: 'ledger', label: 'Ledger', shortcut: '3' },
    { id: 'dispatcher', label: 'Dispatcher', shortcut: '4' },
    { id: 'settings', label: 'Settings', shortcut: '5' },
  ];

  return (
    <header className="sticky top-0 z-40 w-full border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-md px-4 sm:px-8 py-3 flex items-center justify-between gap-6 select-none font-mono text-xs">
      {/* Zone 1: Active Endpoint Status & Clean Text Status */}
      <div className="flex items-center gap-3 shrink-0">
        <div className="flex items-center gap-2 text-zinc-400">
          <span className="w-1.5 h-1.5 rounded-full bg-zinc-300 shadow-[0_0_8px_rgba(255,255,255,0.7)]" />
          <span className="tracking-wider text-zinc-300 font-medium">QIN</span>
          <span className="text-zinc-600">·</span>
          <span className="text-zinc-400">
            {activeProviderCount}/{totalProviderCount} Active
          </span>
        </div>
      </div>

      {/* Zone 2: Minimal Text-First Navigation Tabs (Zero SVG Icons, High-contrast Grey/White) */}
      <nav className="flex items-center gap-1.5 sm:gap-2">
        {tabs.map(tab => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-mono transition-all duration-150 whitespace-nowrap shrink-0 cursor-pointer ${
                isActive
                  ? 'bg-zinc-800 text-white font-semibold border border-zinc-600 shadow-[0_0_10px_rgba(255,255,255,0.06)]'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 border border-transparent'
              }`}
            >
              <span className="text-zinc-500 font-normal">[{tab.shortcut}]</span>
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Zone 3: Actions [Lock], [Logs: X] & Prominent Megrim Logo on Top-Right */}
      <div className="flex items-center gap-3 shrink-0">
        {/* Error / Diagnostics Logger Trigger */}
        <button
          onClick={onOpenLogs}
          className={`px-2.5 py-1.5 rounded text-xs font-mono border transition-colors cursor-pointer ${
            errorCount > 0
              ? 'bg-zinc-900 border-zinc-500 text-white font-bold'
              : 'bg-zinc-900/60 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'
          }`}
          title="Open Centralized Diagnostics & Error Log"
        >
          <span>[Logs: {errorCount}]</span>
        </button>

        {/* Lock Session Action Button */}
        <button
          onClick={onLockVault}
          className="px-2.5 py-1.5 rounded text-xs font-mono border border-zinc-800 hover:border-zinc-600 bg-zinc-900/60 text-zinc-300 hover:text-white transition-colors cursor-pointer"
          title="Lock and seal vault, redirect to startup lockscreen"
        >
          <span>[Lock]</span>
        </button>

        {/* Primary Logo: Prominent Megrim font in top-right corner */}
        <div className="flex items-center pl-3 border-l border-zinc-800">
          <span
            onClick={onReturnToSplash}
            className="font-megrim text-3xl sm:text-4xl text-white tracking-widest leading-none drop-shadow-[0_0_14px_rgba(255,255,255,0.35)] hover:text-zinc-300 transition-colors cursor-pointer"
            title="Qin Universal LLM API Manager"
          >
            Qin
          </span>
        </div>
      </div>
    </header>
  );
};

export default TopBar;
