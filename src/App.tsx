/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback } from 'react';
import GhostFibers from './components/GhostFibers';
import SplashView from './components/SplashView';
import TopBar, { ActiveTab } from './components/TopBar';
import KeyVaultPanel from './components/KeyVaultPanel';
import ModelDiscoveryPanel from './components/ModelDiscoveryPanel';
import TokenLedgerPanel from './components/TokenLedgerPanel';
import DispatcherPlayground from './components/DispatcherPlayground';
import SettingsPanel from './components/SettingsPanel';
import StatusLoggerModal from './components/StatusLoggerModal';
import {
  ProviderConfig,
  ProviderId,
  ProviderStatus,
  KeyringState,
  LedgerEntry,
  AppLogEntry,
  AppSettings,
  AuthType,
} from './types';
import { CANONICAL_PROVIDERS, validateAndDiscover } from './services/providers';
import { getLedgerEntries, addLedgerRecord, clearLedger } from './services/ledger';
import {
  encryptData,
  decryptData,
  saveVaultToDisk,
  loadVaultFromDisk,
  clearVaultFromDisk,
  hashString,
} from './services/crypto';

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  blurIntensity: 'md',
  fontScale: 'medium',
  fiberOpacity: 0.75,
  fiberSpeed: 1.2,
  fiberTwist: 1.2,
  fiberGlowColor: '#d4d4d8',
  fiberSecondaryColor: '#71717a',
  fiberStyle: 'dots',
  fiberThreads: 72,
  fiberLayers: 3,
  autoValidateOnStartup: true,
  archRiceTelemetry: true,
};

export default function App() {
  // Splash and Lockscreen state
  const [showSplash, setShowSplash] = useState(true);

  // Active workspace tab
  const [activeTab, setActiveTab] = useState<ActiveTab>('vault');

  // Selected model for quick test dispatching
  const [testDispatcherTarget, setTestDispatcherTarget] = useState<{ providerId: ProviderId; modelId: string } | null>(null);

  // App Settings
  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      const stored = localStorage.getItem('qin_app_settings');
      return stored ? { ...DEFAULT_SETTINGS, ...JSON.parse(stored) } : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });

  // Providers state (100% dynamic models initialized empty)
  const [providers, setProviders] = useState<ProviderConfig[]>(() => {
    return CANONICAL_PROVIDERS.map(p => ({
      ...p,
      apiKey: '',
      status: p.authType === 'none' ? 'active' : 'unconfigured',
      models: [],
      balanceInfo: null,
    }));
  });

  // Keyring security state
  const [keyring, setKeyring] = useState<KeyringState>({
    isLocked: true,
    hasInitializedVault: false,
  });

  // Active session passphrase in volatile memory (erased when locked)
  const [sessionPassphrase, setSessionPassphrase] = useState<string | null>(null);

  // Ledger state
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);

  // Logs state
  const [logs, setLogs] = useState<AppLogEntry[]>([]);
  const [isLogsModalOpen, setIsLogsModalOpen] = useState(false);

  // Validation / probe states
  const [isTestingProvider, setIsTestingProvider] = useState<ProviderId | null>(null);
  const [isValidatingAll, setIsValidatingAll] = useState(false);
  const [isRefreshingDiscovery, setIsRefreshingDiscovery] = useState(false);

  // Append structured log
  const logEvent = useCallback(
    (level: AppLogEntry['level'], title: string, message: string, providerId?: ProviderId, actionRequired?: string) => {
      const entry: AppLogEntry = {
        id: 'log_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        timestamp: new Date().toISOString(),
        level,
        title,
        message,
        providerId,
        actionRequired,
      };
      setLogs(prev => [entry, ...prev.slice(0, 100)]);
    },
    []
  );

  // Theme, Glassmorphism Blur, and Font Scale Engine Sync
  useEffect(() => {
    const root = document.documentElement;

    // Glassmorphism Blur Attribute: immediately updates CSS variable --glass-blur
    root.setAttribute('data-blur', settings.blurIntensity);

    // Font Scale
    const scaleMap = {
      small: '0.9',
      medium: '1.0',
      large: '1.15',
    };
    root.style.setProperty('--app-scale', scaleMap[settings.fontScale] || '1.0');

    localStorage.setItem('qin_app_settings', JSON.stringify(settings));
  }, [settings]);

  // Load Vault Metadata on Initial Mount
  useEffect(() => {
    const { payload, meta } = loadVaultFromDisk();
    const ledger = getLedgerEntries();
    setLedgerEntries(ledger);

    if (payload && meta && meta.hasInitialized) {
      setKeyring({
        isLocked: true,
        hasInitializedVault: true,
        masterPasswordHash: meta.masterPasswordHash,
        recoveryKeyHash: meta.recoveryKeyHash,
        salt: meta.salt,
      });
      logEvent('info', 'Keystore Located', 'Encrypted AES-GCM vault payload mounted from disk.');
    } else {
      setKeyring({
        isLocked: false,
        hasInitializedVault: false,
      });
    }
  }, [logEvent]);

  // Persist Vault Encrypted Helper (saving full instance configurations + keys)
  const saveVaultSnapshot = async (currentProviders: ProviderConfig[], passphrase: string) => {
    try {
      const vaultData = {
        providers: currentProviders.map(p => ({
          id: p.id,
          name: p.name,
          companyName: p.companyName,
          instanceName: p.instanceName,
          baseUrl: p.baseUrl,
          modelsEndpoint: p.modelsEndpoint,
          authType: p.authType,
          customHeaderName: p.customHeaderName,
          apiKey: p.apiKey,
          isCustom: p.isCustom,
          presetKey: p.presetKey,
        })),
      };

      const encrypted = await encryptData(JSON.stringify(vaultData), passphrase);
      const masterPasswordHash = await hashString(passphrase);
      const { meta } = loadVaultFromDisk();

      saveVaultToDisk(encrypted, {
        hasInitialized: true,
        salt: encrypted.salt,
        masterPasswordHash,
        recoveryKeyHash: meta?.recoveryKeyHash || '',
        createdAt: meta?.createdAt || new Date().toISOString(),
      });
    } catch (e) {
      console.error('Failed to encrypt vault:', e);
    }
  };

  // First-Time Vault Initialization
  const handleInitializeVault = async (masterPassword: string, recoveryKey: string): Promise<boolean> => {
    try {
      const masterPasswordHash = await hashString(masterPassword);
      const recoveryKeyHash = await hashString(recoveryKey);
      const encrypted = await encryptData(JSON.stringify({ providers: [] }), masterPassword);

      saveVaultToDisk(encrypted, {
        hasInitialized: true,
        salt: encrypted.salt,
        masterPasswordHash,
        recoveryKeyHash,
        createdAt: new Date().toISOString(),
      });

      setSessionPassphrase(masterPassword);
      setKeyring({
        isLocked: false,
        hasInitializedVault: true,
        masterPasswordHash,
        recoveryKeyHash,
        salt: encrypted.salt,
        lastUnlocked: new Date().toISOString(),
      });

      logEvent('info', 'Vault Initialized', 'Master password and 12-char recovery key established.');
      return true;
    } catch {
      return false;
    }
  };

  // Unlock Vault with Master Password
  const handleUnlockVault = async (masterPassword: string): Promise<boolean> => {
    const { payload, meta } = loadVaultFromDisk();
    if (!payload || !meta) {
      setKeyring(prev => ({ ...prev, isLocked: false }));
      return true;
    }

    try {
      const inputHash = await hashString(masterPassword);
      if (meta.masterPasswordHash && meta.masterPasswordHash !== inputHash) {
        return false;
      }

      const decryptedJson = await decryptData(payload, masterPassword);
      const parsedVault = JSON.parse(decryptedJson);

      if (parsedVault && Array.isArray(parsedVault.providers) && parsedVault.providers.length > 0) {
        // Restore multi-instance and custom endpoints
        setProviders(parsedVault.providers.map((p: any) => ({
          ...p,
          status: (p.apiKey || p.authType === 'none' ? 'active' : 'unconfigured') as ProviderStatus,
          models: [],
          balanceInfo: null,
        })));
      } else if (parsedVault && typeof parsedVault === 'object') {
        // Backward-compatible key dictionary format
        setProviders(prev =>
          prev.map(p => ({
            ...p,
            apiKey: parsedVault[p.id] || p.apiKey,
            status: (parsedVault[p.id] || p.authType === 'none' ? 'active' : 'unconfigured') as ProviderStatus,
          }))
        );
      }

      setSessionPassphrase(masterPassword);
      setKeyring(prev => ({
        ...prev,
        isLocked: false,
        lastUnlocked: new Date().toISOString(),
      }));

      logEvent('info', 'Keystore Unlocked', 'Decrypted AES-GCM keyring successfully.');

      // Auto-validate providers on unlock
      if (settings.autoValidateOnStartup) {
        setTimeout(() => handleValidateAll(), 400);
      }

      return true;
    } catch {
      return false;
    }
  };

  // Recover Vault with Emergency Recovery Key
  const handleRecoverVault = async (recoveryKey: string, newPassword: string): Promise<boolean> => {
    const { payload, meta } = loadVaultFromDisk();
    if (!payload || !meta) return false;

    try {
      const inputRecoveryHash = await hashString(recoveryKey);
      if (meta.recoveryKeyHash !== inputRecoveryHash) {
        return false;
      }

      let vaultContent = { providers };
      try {
        if (sessionPassphrase) {
          const decrypted = await decryptData(payload, sessionPassphrase);
          vaultContent = JSON.parse(decrypted);
        }
      } catch {
        // Fallback
      }

      const newPasswordHash = await hashString(newPassword);
      const encrypted = await encryptData(JSON.stringify(vaultContent), newPassword);

      saveVaultToDisk(encrypted, {
        hasInitialized: true,
        salt: encrypted.salt,
        masterPasswordHash: newPasswordHash,
        recoveryKeyHash: meta.recoveryKeyHash,
        createdAt: meta.createdAt,
      });

      setSessionPassphrase(newPassword);
      setKeyring(prev => ({
        ...prev,
        isLocked: false,
        masterPasswordHash: newPasswordHash,
        lastUnlocked: new Date().toISOString(),
      }));

      logEvent('warn', 'Vault Recovered', 'Reset master password using 12-char emergency recovery key.');
      return true;
    } catch {
      return false;
    }
  };

  // Lock Vault: Seals session and redirects to startup screen
  const handleLockVault = () => {
    setSessionPassphrase(null);
    setKeyring(prev => ({ ...prev, isLocked: true }));
    setProviders(prev =>
      prev.map(p => ({
        ...p,
        apiKey: '', // Erase from volatile memory
      }))
    );
    setShowSplash(true); // Redirect to startup screen
    logEvent('info', 'Keystore Sealed', 'Volatile memory purged. Session locked.');
  };

  // Password verification guard (for copy/reveal actions)
  const handleVerifyMasterPassword = async (password: string): Promise<boolean> => {
    const { meta } = loadVaultFromDisk();
    if (!meta || !meta.masterPasswordHash) {
      return password === sessionPassphrase;
    }
    const inputHash = await hashString(password);
    return inputHash === meta.masterPasswordHash;
  };

  // Update a provider key (auto-triggers discovery re-fetch + resets OpenRouter balance if empty)
  const handleUpdateProviderKey = async (id: ProviderId, newKey: string) => {
    let updatedConfig: ProviderConfig | null = null;

    setProviders(prev => {
      const updated: ProviderConfig[] = prev.map(p => {
        if (p.id === id) {
          const cfg: ProviderConfig = {
            ...p,
            apiKey: newKey,
            status: (newKey ? 'active' : 'unconfigured') as ProviderStatus,
            balanceInfo: newKey ? p.balanceInfo : null,
            models: newKey ? p.models : [],
            latencyMs: newKey ? p.latencyMs : undefined,
            statusMessage: newKey ? undefined : 'Unconfigured',
          };
          updatedConfig = cfg;
          return cfg;
        }
        return p;
      });

      if (sessionPassphrase) {
        saveVaultSnapshot(updated, sessionPassphrase);
      }

      return updated;
    });

    logEvent('info', 'API Key Stored', `Updated credential payload for ${id}.`, id);

    if (newKey && updatedConfig) {
      handleValidateProvider(id);
    }
  };

  // Add Endpoint Instance (Section II.2: Presets, Custom OpenAI-Compatible, Custom Unpreseted, Multi-instance)
  const handleAddEndpointInstance = (cfg: {
    companyName: string;
    instanceName: string;
    baseUrl: string;
    modelsEndpoint: string;
    authType: AuthType;
    customHeaderName?: string;
    apiKey: string;
    presetKey?: string;
    isCustom?: boolean;
  }) => {
    const newId = `${cfg.presetKey || 'inst'}_${Date.now().toString(36)}`;
    const formattedName = `${cfg.companyName} ${cfg.instanceName}`.trim();

    const newInstance: ProviderConfig = {
      id: newId,
      name: formattedName,
      companyName: cfg.companyName,
      instanceName: cfg.instanceName,
      baseUrl: cfg.baseUrl,
      modelsEndpoint: cfg.modelsEndpoint || '/models',
      authType: cfg.authType,
      customHeaderName: cfg.customHeaderName,
      apiKey: cfg.apiKey,
      presetKey: cfg.presetKey,
      isCustom: cfg.isCustom,
      status: cfg.apiKey || cfg.authType === 'none' ? 'active' : 'unconfigured',
      models: [],
      balanceInfo: null,
    };

    setProviders(prev => {
      const updated = [...prev, newInstance];
      if (sessionPassphrase) {
        saveVaultSnapshot(updated, sessionPassphrase);
      }
      return updated;
    });

    logEvent('info', 'Endpoint Added', `Registered instance ${formattedName}`, newId);

    if (cfg.apiKey || cfg.authType === 'none') {
      setTimeout(() => handleValidateProvider(newId), 300);
    }
  };

  // Remove Endpoint Instance
  const handleRemoveEndpointInstance = (id: ProviderId) => {
    setProviders(prev => {
      const updated = prev.filter(p => p.id !== id);
      if (sessionPassphrase) {
        saveVaultSnapshot(updated, sessionPassphrase);
      }
      return updated;
    });
    logEvent('info', 'Endpoint Removed', `Deleted endpoint instance ${id}`);
  };

  // Validate single provider and discover models dynamically
  const handleValidateProvider = async (id: ProviderId) => {
    const provider = providers.find(p => p.id === id);
    if (!provider) return;

    setIsTestingProvider(id);
    try {
      const res = await validateAndDiscover(provider);

      setProviders(prev =>
        prev.map(p =>
          p.id === id
            ? {
                ...p,
                status: res.status,
                statusMessage: res.statusMessage,
                latencyMs: res.latencyMs,
                models: res.models,
                balanceInfo: res.balanceInfo !== undefined ? res.balanceInfo : (p.apiKey ? p.balanceInfo : null),
                lastChecked: new Date().toISOString(),
              }
            : p
        )
      );

      if (res.status === 'invalid_key') {
        logEvent('auth', 'Auth Failure (401/403)', `${provider.name} rejected credentials.`, id, 'Re-enter valid API key in vault.');
      } else if (res.status === 'rate_limited') {
        logEvent('rate_limit', 'Rate Limited (429)', `${provider.name} rate limit reached.`, id, 'Back off requests or top up credits.');
      } else if (res.status === 'offline') {
        logEvent('error', 'Connection Offline', `Cannot reach ${provider.baseUrl}.`, id, 'Verify network or daemon status.');
      } else if (res.status === 'active') {
        logEvent('info', 'Validation Succeeded', `${provider.name} verified in ${res.latencyMs}ms. Discovered ${res.models.length} models.`, id);
      }
    } catch (err: any) {
      logEvent('error', 'Validation Fault', `Error validating ${provider.name}: ${err?.message}`, id);
    } finally {
      setIsTestingProvider(null);
    }
  };

  // Validate all providers and fetch models
  const handleValidateAll = async () => {
    setIsValidatingAll(true);
    for (const p of providers) {
      if (p.apiKey || p.authType === 'none') {
        await handleValidateProvider(p.id);
      }
    }
    setIsValidatingAll(false);
  };

  // Re-discover models manual trigger
  const handleRefreshDiscovery = async () => {
    setIsRefreshingDiscovery(true);
    await handleValidateAll();
    setIsRefreshingDiscovery(false);
  };

  // Export vault
  const handleExportVault = () => {
    const { payload } = loadVaultFromDisk();
    const dataToExport = payload || {
      v: 2,
      providers: providers.map(p => ({
        id: p.id,
        name: p.name,
        companyName: p.companyName,
        instanceName: p.instanceName,
        baseUrl: p.baseUrl,
        modelsEndpoint: p.modelsEndpoint,
        authType: p.authType,
        customHeaderName: p.customHeaderName,
        apiKey: p.apiKey,
        isCustom: p.isCustom,
        presetKey: p.presetKey,
      })),
    };

    const blob = new Blob([JSON.stringify(dataToExport, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `qin-keyring-${Date.now()}.enc.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    logEvent('info', 'Vault Exported', 'Downloaded encrypted keyring backup file.');
  };

  // Import vault
  const handleImportVault = async (jsonString: string): Promise<boolean> => {
    try {
      const parsed = JSON.parse(jsonString);
      if (parsed.ciphertext && parsed.iv && parsed.salt) {
        saveVaultToDisk(parsed, {
          hasInitialized: true,
          salt: parsed.salt,
          masterPasswordHash: '',
          recoveryKeyHash: '',
          createdAt: new Date().toISOString(),
        });
        setKeyring(prev => ({ ...prev, isLocked: true, hasInitializedVault: true }));
        logEvent('info', 'Vault Imported', 'Loaded encrypted vault payload into local storage.');
        return true;
      } else if (Array.isArray(parsed.providers)) {
        setProviders(parsed.providers.map((p: any) => ({
          ...p,
          status: (p.apiKey || p.authType === 'none' ? 'active' : 'unconfigured') as ProviderStatus,
          models: [],
          balanceInfo: null,
        })));
        logEvent('info', 'Vault Imported', `Restored ${parsed.providers.length} endpoint instances from backup file.`);
        return true;
      }
      return false;
    } catch (e: any) {
      logEvent('error', 'Import Failed', `Malformed JSON: ${e?.message}`);
      return false;
    }
  };

  // Reset vault safely
  const handleResetVault = () => {
    clearVaultFromDisk();
    setProviders(prev => prev.map(p => ({ ...p, apiKey: '', status: (p.authType === 'none' ? 'active' : 'unconfigured') as ProviderStatus, models: [], balanceInfo: null })));
    setKeyring({ isLocked: false, hasInitializedVault: false });
    setSessionPassphrase(null);
    logEvent('warn', 'Keystore Reinitialized', 'Keystore reset to factory state.');
    setShowSplash(true);
  };

  // Record a transaction in token ledger (100% dynamic)
  const handleRecordTransaction = (entry: Omit<LedgerEntry, 'id' | 'timestamp'>) => {
    const newRecord = addLedgerRecord(entry);
    setLedgerEntries(prev => [newRecord, ...prev]);

    if (entry.status !== 'success') {
      logEvent(
        entry.status === 'auth_error' ? 'auth' : entry.status === 'rate_limited' ? 'rate_limit' : 'error',
        `Completion ${entry.status.toUpperCase()}`,
        `Model ${entry.modelId} on ${entry.providerId} failed: ${entry.errorMessage || 'No detail'}`,
        entry.providerId,
        entry.status === 'auth_error' ? 'Verify API Key in Vault' : undefined
      );
    }
  };

  // Select model for test dispatcher
  const handleSelectModelForTest = (providerId: ProviderId, modelId: string) => {
    setTestDispatcherTarget({ providerId, modelId });
    setActiveTab('dispatcher');
  };

  // Keyboard hotkeys for power users
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }

      if (e.key === 'Escape') {
        setShowSplash(prev => !prev);
      } else if (e.key === '1') {
        setActiveTab('vault');
      } else if (e.key === '2') {
        setActiveTab('discovery');
      } else if (e.key === '3') {
        setActiveTab('ledger');
      } else if (e.key === '4') {
        setActiveTab('dispatcher');
      } else if (e.key === '5') {
        setActiveTab('settings');
      } else if (e.key === 'l' || e.key === 'L') {
        if (!keyring.isLocked) handleLockVault();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [keyring.isLocked]);

  const activeProviderCount = providers.filter(p => p.status === 'active').length;
  const errorCount = logs.filter(l => l.level === 'error' || l.level === 'auth').length;

  return (
    <div className="relative min-h-screen w-full select-none overflow-x-hidden">
      {/* Universal Background Canvas: GhostFibers */}
      <div
        className="fixed inset-0 z-0 pointer-events-auto transition-opacity duration-1000"
        style={{ opacity: settings.fiberOpacity }}
      >
        <GhostFibers
          glowColor={settings.fiberGlowColor}
          secondaryColor={settings.fiberSecondaryColor}
          layers={settings.fiberLayers ?? 3}
          twist={settings.fiberTwist}
          threads={settings.fiberThreads ?? 72}
          fiberStyle={settings.fiberStyle ?? "dots"}
          depthOfField={1}
          hoverEffect="focus"
          mouseInteraction={true}
          speed={settings.fiberSpeed}
          perspective={0.8}
        />
      </div>

      {/* Startup / Splash Screen & Master Password Authentication */}
      {showSplash ? (
        <SplashView
          hasInitializedVault={keyring.hasInitializedVault}
          isVaultLocked={keyring.isLocked}
          onInitializeVault={handleInitializeVault}
          onUnlockVault={handleUnlockVault}
          onRecoverVault={handleRecoverVault}
          onEnterApp={() => setShowSplash(false)}
        />
      ) : (
        /* Main Dashboard Layout */
        <div className="relative z-10 flex flex-col min-h-screen animate-slidefadein">
          {/* Top Bar with Megrim Emblem on top-right (no SVG icons, monochrome) */}
          <TopBar
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            onLockVault={handleLockVault}
            onOpenLogs={() => setIsLogsModalOpen(true)}
            errorCount={errorCount}
            activeProviderCount={activeProviderCount}
            totalProviderCount={providers.length}
            onReturnToSplash={() => setShowSplash(true)}
          />

          {/* Main Content Workspace Container */}
          <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            {activeTab === 'vault' && (
              <KeyVaultPanel
                providers={providers}
                keyring={keyring}
                onUpdateProviderKey={handleUpdateProviderKey}
                onAddEndpointInstance={handleAddEndpointInstance}
                onRemoveEndpointInstance={handleRemoveEndpointInstance}
                onValidateProvider={handleValidateProvider}
                onValidateAll={handleValidateAll}
                onExportVault={handleExportVault}
                onImportVault={handleImportVault}
                onResetVault={handleResetVault}
                onVerifyMasterPassword={handleVerifyMasterPassword}
                isTestingProvider={isTestingProvider}
                isValidatingAll={isValidatingAll}
              />
            )}

            {activeTab === 'discovery' && (
              <ModelDiscoveryPanel
                providers={providers}
                onSelectModelForTest={handleSelectModelForTest}
                onRefreshDiscovery={handleRefreshDiscovery}
                isRefreshing={isRefreshingDiscovery}
              />
            )}

            {activeTab === 'ledger' && (
              <TokenLedgerPanel
                entries={ledgerEntries}
                providers={providers}
                onClearLedger={() => {
                  clearLedger();
                  setLedgerEntries([]);
                  logEvent('info', 'Ledger Cleared', 'All local transaction records purged.');
                }}
              />
            )}

            {activeTab === 'dispatcher' && (
              <DispatcherPlayground
                providers={providers}
                initialProviderId={testDispatcherTarget?.providerId}
                initialModelId={testDispatcherTarget?.modelId}
                onRecordTransaction={handleRecordTransaction}
              />
            )}

            {activeTab === 'settings' && (
              <SettingsPanel
                settings={settings}
                onUpdateSettings={newS => setSettings(prev => ({ ...prev, ...newS }))}
                onResetSettings={() => setSettings(DEFAULT_SETTINGS)}
                onTriggerSplash={() => setShowSplash(true)}
              />
            )}
          </main>

          {/* Global Footer (Section I.3 and II.2: strictly minimal status on left, hotkeys in middle, amon0id/qin with https://github.com/amon0id/qin on right) */}
          <footer className="w-full border-t border-zinc-800/80 bg-zinc-950/80 backdrop-blur-md px-6 py-2.5 text-xs font-mono text-zinc-500 flex flex-col sm:flex-row items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-zinc-300">Qin v1.0.0</span>
              <span className="text-zinc-700">·</span>
              <span>{keyring.isLocked ? 'Local Vault Sealed' : 'Local Vault Active'}</span>
            </div>
            <div className="text-zinc-400">
              Hotkeys: [1-5] Workspaces · [L] Lock Session · [Esc] Splash Screen
            </div>
            <div>
              <a
                href="https://github.com/amon0id/qin"
                target="_blank"
                rel="noreferrer"
                className="text-zinc-300 hover:text-white transition-colors"
              >
                amon0id/qin
              </a>
            </div>
          </footer>

          {/* Centralized Error Handler & Diagnostics Modal */}
          <StatusLoggerModal
            isOpen={isLogsModalOpen}
            onClose={() => setIsLogsModalOpen(false)}
            logs={logs}
            onClearLogs={() => setLogs([])}
            onNavigateToVault={pid => {
              setActiveTab('vault');
              if (pid) handleValidateProvider(pid);
            }}
          />
        </div>
      )}
    </div>
  );
}
