/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  AppLogEntry,
  AppSettings,
  AuthType,
  KeyringState,
  LedgerEntry,
  LLMModel,
  ProviderConfig,
  ProviderId,
  ProviderStatus,
} from './types';
import { CANONICAL_PROVIDERS, validateAndDiscover } from './services/providers';
import { addLedgerRecord, clearLedger, getLedgerEntries } from './services/ledger';
import {
  EncryptedPayload,
  KDF_VERSION,
  PBKDF2_ITERATIONS,
  VaultMeta,
  clearVaultFromDisk,
  createVault,
  generateEmergencyRecoveryKey,
  loadVaultFromDisk,
  migrateLegacyVault,
  needsUpgrade,
  rekeyWithPassword,
  saveVaultToDisk,
  setRecoveryKey as wrapRecoveryKey,
  unlockVault,
  unlockVaultWithRecovery,
  updateVaultBody,
} from './services/crypto';
import { bridge, initStorage, readKey, storageLocation, writeKey } from './services/storage';

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
};

/** Shape of a provider as persisted inside the encrypted vault. */
interface StoredProvider {
  id: ProviderId;
  name: string;
  companyName: string;
  instanceName: string;
  baseUrl: string;
  modelsEndpoint: string;
  chatEndpoint?: string;
  authType: AuthType;
  customHeaderName?: string;
  apiKey: string;
  isCustom?: boolean;
  presetKey?: string;
  models?: LLMModel[];
}

interface VaultBody {
  version: number;
  providers: StoredProvider[];
}

const APP_VERSION = bridge()?.config?.version ?? '1.1.0';

/** Coalesce vault writes: editing a key fires many updates in quick succession. */
const SAVE_DEBOUNCE_MS = 600;

function emptyProvider(seed: (typeof CANONICAL_PROVIDERS)[number]): ProviderConfig {
  return {
    ...seed,
    apiKey: '',
    status: seed.authType === 'none' ? 'active' : 'unconfigured',
    models: [],
    balanceInfo: null,
  };
}

function statusFor(provider: Pick<ProviderConfig, 'apiKey' | 'authType'>): ProviderStatus {
  if (provider.apiKey) return 'active';
  return provider.authType === 'none' ? 'active' : 'unconfigured';
}

function toStoredProvider(provider: ProviderConfig): StoredProvider {
  return {
    id: provider.id,
    name: provider.name,
    companyName: provider.companyName,
    instanceName: provider.instanceName,
    baseUrl: provider.baseUrl,
    modelsEndpoint: provider.modelsEndpoint,
    chatEndpoint: provider.chatEndpoint,
    authType: provider.authType,
    customHeaderName: provider.customHeaderName,
    apiKey: provider.apiKey,
    isCustom: provider.isCustom,
    presetKey: provider.presetKey,
    // Persisted so discovered pricing and context windows survive a reload
    // instead of being discarded on every unlock.
    models: provider.models,
  };
}

/** Parse a decrypted vault body, tolerating the legacy `{ id: key }` dictionary. */
function parseVaultBody(plaintext: string): {
  providers: StoredProvider[] | null;
  legacyKeys: Record<string, string> | null;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    return { providers: null, legacyKeys: null };
  }
  if (!parsed || typeof parsed !== 'object') return { providers: null, legacyKeys: null };

  const record = parsed as Record<string, unknown>;
  if (Array.isArray(record.providers)) {
    return { providers: record.providers as StoredProvider[], legacyKeys: null };
  }

  const entries = Object.entries(record).filter(
    ([, value]) => typeof value === 'string' && value.length > 0
  );
  if (entries.length > 0) {
    return {
      providers: null,
      legacyKeys: Object.fromEntries(entries) as Record<string, string>,
    };
  }

  return { providers: [], legacyKeys: null };
}

function hydrateProviders(
  stored: StoredProvider[] | null,
  legacyKeys: Record<string, string> | null
): ProviderConfig[] {
  if (stored && stored.length > 0) {
    return stored.map(item => {
      const seed = CANONICAL_PROVIDERS.find(candidate => candidate.id === item.id);
      const merged = {
        ...(seed ? emptyProvider(seed) : ({} as ProviderConfig)),
        ...item,
        modelsEndpoint: item.modelsEndpoint || '/models',
        models: Array.isArray(item.models) ? item.models : [],
        balanceInfo: null,
      } as ProviderConfig;
      merged.status = statusFor(merged);
      merged.statusMessage = merged.apiKey ? undefined : 'Unconfigured';
      return merged;
    });
  }

  const base = CANONICAL_PROVIDERS.map(emptyProvider);

  if (legacyKeys) {
    return base.map(provider => {
      const key = legacyKeys[provider.id] ?? '';
      if (!key) return provider;
      return { ...provider, apiKey: key, status: statusFor({ ...provider, apiKey: key }) };
    });
  }

  return base;
}

export default function App() {
  const [booting, setBooting] = useState(true);
  const [showSplash, setShowSplash] = useState(true);
  const [activeTab, setActiveTab] = useState<ActiveTab>('vault');
  const [testDispatcherTarget, setTestDispatcherTarget] = useState<{
    providerId: ProviderId;
    modelId: string;
  } | null>(null);

  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [providers, setProviders] = useState<ProviderConfig[]>(() =>
    CANONICAL_PROVIDERS.map(emptyProvider)
  );
  const [keyring, setKeyring] = useState<KeyringState>({
    isLocked: true,
    hasInitializedVault: false,
  });
  const [sessionPassphrase, setSessionPassphrase] = useState<string | null>(null);
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);
  const [logs, setLogs] = useState<AppLogEntry[]>([]);
  const [isLogsModalOpen, setIsLogsModalOpen] = useState(false);

  // Validation state is a set: two providers can be in flight at once, and the
  // old single-id flag let whichever finished first clear the other's spinner.
  const [inFlight, setInFlight] = useState<Set<ProviderId>>(() => new Set());
  const [isValidatingAll, setIsValidatingAll] = useState(false);
  const [isRefreshingDiscovery, setIsRefreshingDiscovery] = useState(false);

  // Refs that always hold the freshest values, so async loops and debounced
  // writers never read a stale closure.
  const providersRef = useRef<ProviderConfig[]>(providers);
  const passphraseRef = useRef<string | null>(null);
  const dataKeyRef = useRef<Uint8Array | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const savingRef = useRef(false);
  const bootedRef = useRef(false);

  useEffect(() => {
    providersRef.current = providers;
  }, [providers]);

  useEffect(() => {
    passphraseRef.current = sessionPassphrase;
  }, [sessionPassphrase]);

  const logEvent = useCallback(
    (
      level: AppLogEntry['level'],
      title: string,
      message: string,
      providerId?: ProviderId,
      actionRequired?: string
    ) => {
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

  /* ------------------------------------------------------------- boot / load */

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      await initStorage();
      if (cancelled) return;

      const storedSettings = readKey<Partial<AppSettings>>('settings');
      if (storedSettings) setSettings({ ...DEFAULT_SETTINGS, ...storedSettings });

      setLedgerEntries(getLedgerEntries());

      const { payload, meta } = loadVaultFromDisk();
      if (payload) {
        setKeyring({ isLocked: true, hasInitializedVault: true, salt: meta?.salt });
        logEvent(
          'info',
          'Keystore located',
          `Encrypted vault mounted from ${storageLocation()}.`
        );
      } else {
        setKeyring({ isLocked: false, hasInitializedVault: false });
      }

      bootedRef.current = true;
      setBooting(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [logEvent]);

  // Theme / blur / font scale, persisted alongside everything else.
  useEffect(() => {
    if (!bootedRef.current) return;
    const root = document.documentElement;
    root.setAttribute('data-blur', settings.blurIntensity);
    const scaleMap = { small: '0.9', medium: '1.0', large: '1.15' } as const;
    root.style.setProperty('--app-scale', scaleMap[settings.fontScale] ?? '1.0');
    writeKey('settings', settings);
  }, [settings]);

  /* ------------------------------------------------------------ vault writes */

  const persistSnapshot = useCallback(async () => {
    const passphrase = passphraseRef.current;
    const rawDataKey = dataKeyRef.current;
    if (!passphrase || !rawDataKey || savingRef.current) return;

    savingRef.current = true;
    try {
      const { payload, meta } = loadVaultFromDisk();
      if (!payload) return;

      const body: VaultBody = {
        version: KDF_VERSION,
        providers: providersRef.current.map(toStoredProvider),
      };

      const next = await updateVaultBody(payload, rawDataKey, JSON.stringify(body));
      saveVaultToDisk(next, {
        hasInitialized: true,
        createdAt: meta?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        kdfIterations: PBKDF2_ITERATIONS,
        recoveryNeedsSetup: meta?.recoveryNeedsSetup ?? !next.recovery,
      });
    } catch (err) {
      console.error('[qin] failed to persist vault:', err);
      logEvent('error', 'Vault write failed', String((err as Error)?.message ?? err));
    } finally {
      savingRef.current = false;
    }
  }, [logEvent]);

  const scheduleSave = useCallback(() => {
    if (!passphraseRef.current || !dataKeyRef.current) return;
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      void persistSnapshot();
    }, SAVE_DEBOUNCE_MS);
  }, [persistSnapshot]);

  const flushSave = useCallback(async () => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    await persistSnapshot();
  }, [persistSnapshot]);

  /** The single place that mutates providers: keeps the ref and the save in sync. */
  const applyProviders = useCallback(
    (updater: (prev: ProviderConfig[]) => ProviderConfig[]) => {
      setProviders(prev => {
        const next = updater(prev);
        providersRef.current = next;
        return next;
      });
      scheduleSave();
    },
    [scheduleSave]
  );

  /* ------------------------------------------------------- vault lifecycle */

  const handleInitializeVault = useCallback(
    async (masterPassword: string, recoveryKey: string): Promise<boolean> => {
      try {
        const body: VaultBody = {
          version: KDF_VERSION,
          providers: providersRef.current.map(toStoredProvider),
        };
        const payload = await createVault(JSON.stringify(body), masterPassword, recoveryKey);

        saveVaultToDisk(payload, {
          hasInitialized: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          kdfIterations: PBKDF2_ITERATIONS,
          recoveryNeedsSetup: false,
        });

        // Keep the data key so later edits don't pay the KDF again.
        const unlocked = await unlockVault(payload, masterPassword);
        dataKeyRef.current = unlocked?.rawDataKey ?? null;
        setSessionPassphrase(masterPassword);
        setKeyring({
          isLocked: false,
          hasInitializedVault: true,
          salt: payload.salt,
          lastUnlocked: new Date().toISOString(),
        });

        logEvent(
          'info',
          'Vault initialized',
          'Data key wrapped twice: once for the master password, once for the recovery key.'
        );
        return true;
      } catch (err) {
        logEvent('error', 'Vault init failed', String((err as Error)?.message ?? err));
        return false;
      }
    },
    [logEvent]
  );

  const handleUnlockVault = useCallback(
    async (masterPassword: string): Promise<boolean> => {
      const { payload, meta } = loadVaultFromDisk();
      if (!payload) {
        setKeyring(prev => ({ ...prev, isLocked: false }));
        return true;
      }

      const unlocked = await unlockVault(payload, masterPassword);
      if (!unlocked) return false;

      const { providers: stored, legacyKeys } = parseVaultBody(unlocked.plaintext);
      const hydrated = hydrateProviders(stored, legacyKeys);
      providersRef.current = hydrated;
      setProviders(hydrated);
      dataKeyRef.current = unlocked.rawDataKey;
      setSessionPassphrase(masterPassword);
      setKeyring(prev => ({
        ...prev,
        isLocked: false,
        lastUnlocked: new Date().toISOString(),
      }));
      logEvent('info', 'Keystore unlocked', 'Decrypted the AES-GCM vault successfully.');

      // Legacy payload or weak KDF: migrate to the wrapped-data-key format now
      // that we hold the plaintext. The old recovery key cannot be carried over
      // (we never held it), so flag the vault as needing a new one.
      if (needsUpgrade(payload) || !unlocked.rawDataKey) {
        try {
          const migrated = await migrateLegacyVault(unlocked.plaintext, masterPassword);
          const recoveryNeedsSetup = !migrated.recovery;
          saveVaultToDisk(migrated, {
            hasInitialized: true,
            createdAt: meta?.createdAt ?? new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            kdfIterations: PBKDF2_ITERATIONS,
            recoveryNeedsSetup,
          });
          const reUnlocked = await unlockVault(migrated, masterPassword);
          dataKeyRef.current = reUnlocked?.rawDataKey ?? null;
          logEvent(
            'info',
            'Vault upgraded',
            `Re-encrypted at ${PBKDF2_ITERATIONS.toLocaleString()} PBKDF2 iterations with a wrapped data key.`
          );
          if (recoveryNeedsSetup) {
            logEvent(
              'warn',
              'Recovery key needs renewal',
              'This vault predates the wrapped-key format, so its old recovery key cannot unseal it. Set a new recovery key from the vault panel.',
              undefined,
              'Open Key Vault → [Set Recovery Key]'
            );
          }
        } catch (err) {
          logEvent('error', 'Vault upgrade failed', String((err as Error)?.message ?? err));
        }
      }

      if (settings.autoValidateOnStartup) {
        window.setTimeout(() => void validateAllRef.current(), 500);
      }

      return true;
    },
    [logEvent, settings.autoValidateOnStartup]
  );

  const handleRecoverVault = useCallback(
    async (recoveryKey: string, newPassword: string): Promise<boolean> => {
      const { payload, meta } = loadVaultFromDisk();
      if (!payload) return false;

      // Refuse rather than destroy. A vault with no recovery wrap cannot be
      // opened by a recovery key; the old build "recovered" by re-encrypting an
      // empty provider list, which silently wiped every stored key.
      if (!payload.recovery) {
        logEvent(
          'error',
          'Recovery unavailable',
          'This vault has no recovery key bound to it. Use [Reset Keystore] if the master password is lost.',
          undefined,
          'Set a recovery key while unlocked to prevent this'
        );
        return false;
      }

      const unlocked = await unlockVaultWithRecovery(payload, recoveryKey);
      if (!unlocked || !unlocked.rawDataKey) return false;

      const rekeyed = await rekeyWithPassword(payload, unlocked.rawDataKey, newPassword);
      saveVaultToDisk(rekeyed, {
        hasInitialized: true,
        createdAt: meta?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        kdfIterations: PBKDF2_ITERATIONS,
        recoveryNeedsSetup: false,
      });

      const { providers: stored, legacyKeys } = parseVaultBody(unlocked.plaintext);
      const hydrated = hydrateProviders(stored, legacyKeys);
      providersRef.current = hydrated;
      setProviders(hydrated);
      dataKeyRef.current = unlocked.rawDataKey;
      setSessionPassphrase(newPassword);
      setKeyring(prev => ({
        ...prev,
        isLocked: false,
        hasInitializedVault: true,
        lastUnlocked: new Date().toISOString(),
      }));

      logEvent(
        'warn',
        'Vault recovered',
        'Master password reset with the recovery key. Stored keys were preserved.'
      );
      return true;
    },
    [logEvent]
  );

  const handleSetRecoveryKey = useCallback(
    async (masterPassword: string): Promise<{ ok: boolean; recoveryKey?: string }> => {
      const { payload, meta } = loadVaultFromDisk();
      if (!payload) return { ok: false };

      const unlocked = await unlockVault(payload, masterPassword);
      if (!unlocked || !unlocked.rawDataKey) return { ok: false };

      const recoveryKey = generateEmergencyRecoveryKey();
      const wrapped = await wrapRecoveryKey(payload, unlocked.rawDataKey, recoveryKey);
      saveVaultToDisk(wrapped, {
        hasInitialized: true,
        createdAt: meta?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        kdfIterations: PBKDF2_ITERATIONS,
        recoveryNeedsSetup: false,
      });

      logEvent('info', 'Recovery key set', 'A new recovery key is now bound to this vault.');
      return { ok: true, recoveryKey };
    },
    [logEvent]
  );

  const handleLockVault = useCallback(() => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    void persistSnapshot();

    setSessionPassphrase(null);
    dataKeyRef.current = null;
    setKeyring(prev => ({ ...prev, isLocked: true }));
    const sealed = providersRef.current.map(provider => ({ ...provider, apiKey: '' }));
    providersRef.current = sealed;
    setProviders(sealed);
    setShowSplash(true);
    logEvent('info', 'Keystore sealed', 'Volatile key material purged. Session locked.');
  }, [logEvent, persistSnapshot]);

  /** Verify the master password by unwrapping the data key. */
  const handleVerifyMasterPassword = useCallback(async (password: string): Promise<boolean> => {
    const { payload } = loadVaultFromDisk();
    if (!payload) return password === passphraseRef.current;
    return (await unlockVault(payload, password)) !== null;
  }, []);

  /* ------------------------------------------------------------ provider ops */

  const handleUpdateProviderKey = useCallback(
    (id: ProviderId, newKey: string) => {
      applyProviders(prev =>
        prev.map(provider => {
          if (provider.id !== id) return provider;
          return {
            ...provider,
            apiKey: newKey,
            status: statusFor({ ...provider, apiKey: newKey }),
            statusMessage: newKey ? undefined : 'Unconfigured',
            balanceInfo: newKey ? provider.balanceInfo : null,
            models: newKey ? provider.models : [],
            latencyMs: newKey ? provider.latencyMs : undefined,
          };
        })
      );
      logEvent('info', 'API key stored', `Updated credential for ${id}.`, id);
    },
    [applyProviders, logEvent]
  );

  const handleAddEndpointInstance = useCallback(
    (cfg: {
      companyName: string;
      instanceName: string;
      baseUrl: string;
      modelsEndpoint: string;
      chatEndpoint?: string;
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
        baseUrl: cfg.baseUrl.trim(),
        modelsEndpoint: cfg.modelsEndpoint.trim() || '/models',
        chatEndpoint: cfg.chatEndpoint?.trim() || undefined,
        authType: cfg.authType,
        customHeaderName: cfg.customHeaderName?.trim() || undefined,
        apiKey: cfg.apiKey.trim(),
        presetKey: cfg.presetKey,
        isCustom: cfg.isCustom,
        status: statusFor({ apiKey: cfg.apiKey, authType: cfg.authType }),
        models: [],
        balanceInfo: null,
      };

      applyProviders(prev => [...prev, newInstance]);
      logEvent('info', 'Endpoint added', `Registered instance ${formattedName}.`, newId);

      if (newInstance.apiKey || newInstance.authType === 'none') {
        window.setTimeout(() => void validateOneRef.current(newId), 300);
      }
    },
    [applyProviders, logEvent]
  );

  const handleRemoveEndpointInstance = useCallback(
    (id: ProviderId) => {
      applyProviders(prev => prev.filter(provider => provider.id !== id));
      logEvent('info', 'Endpoint removed', `Deleted endpoint instance ${id}.`);
    },
    [applyProviders, logEvent]
  );

  /* ------------------------------------------------------------- validation */

  const handleValidateProvider = useCallback(
    async (id: ProviderId) => {
      // Read the freshest provider, never the one captured at render.
      const provider = providersRef.current.find(candidate => candidate.id === id);
      if (!provider) return;

      setInFlight(prev => new Set(prev).add(id));
      try {
        const result = await validateAndDiscover(provider);

        setProviders(prev => {
          const next = prev.map(candidate =>
            candidate.id === id
              ? {
                  ...candidate,
                  status: result.status,
                  statusMessage: result.statusMessage,
                  latencyMs: result.latencyMs,
                  models: result.models,
                  balanceInfo:
                    result.balanceInfo !== undefined
                      ? result.balanceInfo
                      : candidate.apiKey
                        ? candidate.balanceInfo
                        : null,
                  lastChecked: new Date().toISOString(),
                }
              : candidate
          );
          providersRef.current = next;
          return next;
        });
        scheduleSave();

        if (result.status === 'invalid_key') {
          logEvent(
            'auth',
            'Authentication failed',
            `${provider.name} rejected the credentials.`,
            id,
            'Re-enter a valid API key in the vault.'
          );
        } else if (result.status === 'rate_limited') {
          logEvent(
            'rate_limit',
            'Rate limited',
            `${provider.name}: ${result.statusMessage}`,
            id,
            'Back off requests or top up credits.'
          );
        } else if (result.status === 'offline') {
          logEvent(
            'error',
            'Endpoint unreachable',
            `${provider.name}: ${result.statusMessage}`,
            id,
            'Check the base URL, network, or local daemon.'
          );
        } else if (result.status === 'degraded') {
          logEvent('warn', 'Degraded endpoint', `${provider.name}: ${result.statusMessage}`, id);
        } else if (result.status === 'active') {
          logEvent(
            'info',
            'Validation succeeded',
            `${provider.name} verified in ${result.latencyMs}ms. ${result.models.length} models discovered.`,
            id
          );
        }
      } catch (err) {
        logEvent(
          'error',
          'Validation fault',
          `Error validating ${provider.name}: ${String((err as Error)?.message ?? err)}`,
          id
        );
      } finally {
        setInFlight(prev => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [logEvent, scheduleSave]
  );

  const handleValidateAll = useCallback(async () => {
    setIsValidatingAll(true);
    try {
      // Snapshot the freshest list so endpoints added moments ago are included.
      const targets = providersRef.current.filter(
        provider => provider.apiKey || provider.authType === 'none'
      );
      for (const target of targets) {
        await handleValidateProvider(target.id);
      }
    } finally {
      setIsValidatingAll(false);
    }
  }, [handleValidateProvider]);

  // Stable handles so timers and effects declared earlier call the latest version.
  const validateOneRef = useRef(handleValidateProvider);
  const validateAllRef = useRef(handleValidateAll);
  useEffect(() => {
    validateOneRef.current = handleValidateProvider;
    validateAllRef.current = handleValidateAll;
  }, [handleValidateProvider, handleValidateAll]);

  const handleRefreshDiscovery = useCallback(async () => {
    setIsRefreshingDiscovery(true);
    try {
      await validateAllRef.current();
    } finally {
      setIsRefreshingDiscovery(false);
    }
  }, []);

  /* --------------------------------------------------------- import / export */

  const handleExportVault = useCallback(() => {
    const { payload, meta } = loadVaultFromDisk();
    if (!payload) {
      logEvent('warn', 'Export skipped', 'There is no vault to export yet.');
      return;
    }

    const bundle = { format: 'qin-vault', exportedAt: new Date().toISOString(), payload, meta };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `qin-keyring-${Date.now()}.enc.json`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    logEvent('info', 'Vault exported', 'Encrypted keyring bundle downloaded.');
  }, [logEvent]);

  const handleImportVault = useCallback(
    async (jsonString: string): Promise<boolean> => {
      try {
        const parsed = JSON.parse(jsonString) as Record<string, unknown>;

        // Accept our export bundle, a bare encrypted payload, or a plaintext
        // provider list.
        const candidate =
          (parsed.payload as Record<string, unknown> | undefined) ??
          (typeof parsed.ciphertext === 'string' ? parsed : undefined);

        if (candidate && typeof candidate.ciphertext === 'string') {
          const payload = candidate as unknown as EncryptedPayload;
          const importedMeta = (parsed.meta as VaultMeta | undefined) ?? null;

          // We do not have this vault's password, so we cannot claim a password
          // verifier or a recovery binding for it. Record the truth; the unlock
          // path verifies by decryption.
          saveVaultToDisk(payload, {
            hasInitialized: true,
            createdAt: importedMeta?.createdAt ?? new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            kdfIterations: payload.iterations ?? PBKDF2_ITERATIONS,
            recoveryNeedsSetup: !payload.recovery,
          });

          setKeyring(prev => ({ ...prev, isLocked: true, hasInitializedVault: true }));
          setSessionPassphrase(null);
          dataKeyRef.current = null;
          logEvent(
            'info',
            'Vault imported',
            'Encrypted payload loaded. Unlock it with the password it was created with.'
          );
          return true;
        }

        if (Array.isArray(parsed.providers)) {
          const hydrated = hydrateProviders(parsed.providers as StoredProvider[], null);
          providersRef.current = hydrated;
          setProviders(hydrated);
          scheduleSave();
          logEvent(
            'info',
            'Providers imported',
            `Restored ${hydrated.length} endpoint instances from a plaintext backup.`
          );
          return true;
        }

        return false;
      } catch (err) {
        logEvent(
          'error',
          'Import failed',
          `Malformed JSON: ${String((err as Error)?.message ?? err)}`
        );
        return false;
      }
    },
    [logEvent, scheduleSave]
  );

  const handleResetVault = useCallback(() => {
    clearVaultFromDisk();
    dataKeyRef.current = null;
    setSessionPassphrase(null);
    const reset = CANONICAL_PROVIDERS.map(emptyProvider);
    providersRef.current = reset;
    setProviders(reset);
    setKeyring({ isLocked: false, hasInitializedVault: false });
    logEvent('warn', 'Keystore reset', 'Vault cleared. Set a new master password.');
    setShowSplash(true);
  }, [logEvent]);

  /* ----------------------------------------------------------------- ledger */

  const handleRecordTransaction = useCallback(
    (entry: Omit<LedgerEntry, 'id' | 'timestamp'>) => {
      const record = addLedgerRecord(entry);
      setLedgerEntries(prev => [record, ...prev]);

      if (entry.status !== 'success') {
        logEvent(
          entry.status === 'auth_error'
            ? 'auth'
            : entry.status === 'rate_limited'
              ? 'rate_limit'
              : 'error',
          `Completion ${entry.status.replace('_', ' ')}`,
          `${entry.modelId} on ${entry.providerId} failed: ${entry.errorMessage ?? 'no detail'}`,
          entry.providerId,
          entry.status === 'auth_error' ? 'Verify the API key in the vault' : undefined
        );
      }
    },
    [logEvent]
  );

  const handleSelectModelForTest = useCallback((providerId: ProviderId, modelId: string) => {
    setTestDispatcherTarget({ providerId, modelId });
    setActiveTab('dispatcher');
  }, []);

  /* --------------------------------------------------------------- shortcuts */

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === 'Escape') {
        setShowSplash(prev => !prev);
      } else if (event.key === '1') {
        setActiveTab('vault');
      } else if (event.key === '2') {
        setActiveTab('discovery');
      } else if (event.key === '3') {
        setActiveTab('ledger');
      } else if (event.key === '4') {
        setActiveTab('dispatcher');
      } else if (event.key === '5') {
        setActiveTab('settings');
      } else if (event.key === 'l' || event.key === 'L') {
        if (!keyring.isLocked) handleLockVault();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [keyring.isLocked, handleLockVault]);

  // Don't lose the last edit when the window closes.
  useEffect(() => {
    const onBeforeUnload = () => {
      void flushSave();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [flushSave]);

  const activeProviderCount = useMemo(
    () => providers.filter(provider => provider.status === 'active').length,
    [providers]
  );
  const errorCount = useMemo(
    () => logs.filter(entry => entry.level === 'error' || entry.level === 'auth').length,
    [logs]
  );

  if (booting) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center font-mono text-xs text-zinc-500">
        Mounting local keystore…
      </div>
    );
  }

  return (
    <div className="relative min-h-screen w-full select-none overflow-x-hidden">
      <div
        className="pointer-events-auto fixed inset-0 z-0 transition-opacity duration-1000"
        style={{ opacity: settings.fiberOpacity }}
      >
        <GhostFibers
          glowColor={settings.fiberGlowColor}
          secondaryColor={settings.fiberSecondaryColor}
          layers={settings.fiberLayers ?? 3}
          twist={settings.fiberTwist}
          threads={settings.fiberThreads ?? 72}
          fiberStyle={settings.fiberStyle ?? 'dots'}
          depthOfField={1}
          hoverEffect="focus"
          mouseInteraction
          speed={settings.fiberSpeed}
          perspective={0.8}
        />
      </div>

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
        <div className="animate-slidefadein relative z-10 flex min-h-screen flex-col">
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

          <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
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
                onSetRecoveryKey={handleSetRecoveryKey}
                isTestingProvider={inFlight}
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
                  logEvent('info', 'Ledger cleared', 'All local transaction records purged.');
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
                storageLocation={storageLocation()}
                appVersion={APP_VERSION}
                onUpdateSettings={next => setSettings(prev => ({ ...prev, ...next }))}
                onResetSettings={() => setSettings(DEFAULT_SETTINGS)}
                onTriggerSplash={() => setShowSplash(true)}
              />
            )}
          </main>

          <footer className="flex w-full flex-col items-center justify-between gap-2 border-t border-zinc-800/80 bg-zinc-950/80 px-6 py-2.5 font-mono text-xs text-zinc-500 backdrop-blur-md sm:flex-row">
            <div className="flex items-center gap-2">
              <span className="text-zinc-300">Qin v{APP_VERSION}</span>
              <span className="text-zinc-700">·</span>
              <span>{keyring.isLocked ? 'Vault sealed' : 'Vault unlocked'}</span>
              <span className="text-zinc-700">·</span>
              <span className="max-w-[22rem] truncate" title={storageLocation()}>
                {storageLocation()}
              </span>
            </div>
            <div className="text-zinc-400">
              Hotkeys: [1-5] workspaces · [L] lock · [Esc] splash
            </div>
            <a
              href="https://github.com/amon1s/qin"
              onClick={event => {
                const openExternal = bridge()?.openExternal;
                if (openExternal) {
                  event.preventDefault();
                  void openExternal('https://github.com/amon1s/qin');
                }
              }}
              className="text-zinc-300 transition-colors hover:text-white"
            >
              amon1s/qin
            </a>
          </footer>

          <StatusLoggerModal
            isOpen={isLogsModalOpen}
            onClose={() => setIsLogsModalOpen(false)}
            logs={logs}
            onClearLogs={() => setLogs([])}
            onNavigateToVault={providerId => {
              setActiveTab('vault');
              if (providerId) void validateOneRef.current(providerId);
            }}
          />
        </div>
      )}
    </div>
  );
}
