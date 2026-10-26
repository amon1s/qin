import React, { useMemo, useState } from 'react';
import { AuthType, KeyringState, ProviderConfig, ProviderId } from '../types';
import { PROVIDER_PRESETS } from '../services/providers';

interface EndpointDraft {
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
}

interface KeyVaultPanelProps {
  providers: ProviderConfig[];
  keyring: KeyringState;
  onUpdateProviderKey: (id: ProviderId, newKey: string) => void;
  onAddEndpointInstance: (endpointConfig: EndpointDraft) => void;
  onRemoveEndpointInstance: (id: ProviderId) => void;
  onValidateProvider: (id: ProviderId) => Promise<void>;
  onValidateAll: () => Promise<void>;
  onExportVault: () => void;
  onImportVault: (jsonContent: string) => Promise<boolean>;
  onResetVault: () => void;
  onVerifyMasterPassword: (password: string) => Promise<boolean>;
  onSetRecoveryKey: (masterPassword: string) => Promise<{ ok: boolean; recoveryKey?: string }>;
  isTestingProvider: Set<ProviderId>;
  isValidatingAll: boolean;
}

type SecretAction =
  | { type: 'reveal'; providerId: ProviderId; apiKey: string }
  | { type: 'copy'; providerId: ProviderId; apiKey: string }
  | { type: 'recovery' };

const maskKey = (key: string): string => {
  if (!key) return '';
  if (key.length <= 8) return '•'.repeat(8);
  return `${key.slice(0, 4)}${'•'.repeat(8)}${key.slice(-4)}`;
};

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export const KeyVaultPanel: React.FC<KeyVaultPanelProps> = ({
  providers,
  keyring,
  onUpdateProviderKey,
  onAddEndpointInstance,
  onRemoveEndpointInstance,
  onValidateProvider,
  onValidateAll,
  onExportVault,
  onImportVault,
  onResetVault,
  onVerifyMasterPassword,
  onSetRecoveryKey,
  isTestingProvider,
  isValidatingAll,
}) => {
  // Draft key text, keyed by provider. The stored key is never bound to an
  // editable input: the old build wrote the *masked* value back on every
  // keystroke and destroyed the real credential.
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [secretAction, setSecretAction] = useState<SecretAction | null>(null);
  const [verifyPassword, setVerifyPassword] = useState('');
  const [verifyError, setVerifyError] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [newRecoveryKey, setNewRecoveryKey] = useState<string | null>(null);

  const [showAddModal, setShowAddModal] = useState(false);
  const [endpointType, setEndpointType] = useState<'preset' | 'openai_compatible' | 'custom'>('preset');
  const [selectedPresetId, setSelectedPresetId] = useState('openai');
  const [customCompanyName, setCustomCompanyName] = useState('');
  const [userApiName, setUserApiName] = useState('');
  const [baseUrlInput, setBaseUrlInput] = useState('https://api.openai.com/v1');
  const [modelsEndpointInput, setModelsEndpointInput] = useState('/models');
  const [chatEndpointInput, setChatEndpointInput] = useState('');
  const [authTypeInput, setAuthTypeInput] = useState<AuthType>('bearer');
  const [customHeaderInput, setCustomHeaderInput] = useState('');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [addError, setAddError] = useState('');

  const [showImport, setShowImport] = useState(false);
  const [importJson, setImportJson] = useState('');
  const [importError, setImportError] = useState('');

  const [showConfirmReset, setShowConfirmReset] = useState(false);

  const effectiveCompanyName = useMemo(() => {
    if (endpointType === 'preset') {
      return PROVIDER_PRESETS.find(preset => preset.id === selectedPresetId)?.companyName ?? 'Provider';
    }
    return (
      customCompanyName.trim() ||
      (endpointType === 'openai_compatible' ? 'Custom OpenAI' : 'Custom')
    );
  }, [endpointType, selectedPresetId, customCompanyName]);

  const displayName = `${effectiveCompanyName} ${userApiName.trim() || 'Instance'}`.trim();

  const handlePresetChange = (presetId: string) => {
    setSelectedPresetId(presetId);
    const preset = PROVIDER_PRESETS.find(item => item.id === presetId);
    if (!preset) return;
    setBaseUrlInput(preset.defaultBaseUrl);
    setModelsEndpointInput(preset.defaultModelsEndpoint);
    setAuthTypeInput(preset.authType);
    setChatEndpointInput('');
  };

  /* --------------------------------------------------------- secret actions */

  const requestReveal = (providerId: ProviderId, apiKey: string) => {
    if (revealed[providerId]) {
      setRevealed(prev => ({ ...prev, [providerId]: false }));
      return;
    }
    if (!apiKey) return;
    setSecretAction({ type: 'reveal', providerId, apiKey });
    setVerifyPassword('');
    setVerifyError('');
  };

  const requestCopy = (providerId: ProviderId, apiKey: string) => {
    if (!apiKey) return;
    setSecretAction({ type: 'copy', providerId, apiKey });
    setVerifyPassword('');
    setVerifyError('');
  };

  const handleVerifySubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!verifyPassword || !secretAction) return;

    setIsVerifying(true);
    setVerifyError('');
    const valid = await onVerifyMasterPassword(verifyPassword);
    setIsVerifying(false);

    if (!valid) {
      setVerifyError('Incorrect master password.');
      return;
    }

    if (secretAction.type === 'reveal') {
      setRevealed(prev => ({ ...prev, [secretAction.providerId]: true }));
    } else if (secretAction.type === 'copy') {
      try {
        await navigator.clipboard.writeText(secretAction.apiKey);
        setCopiedId(secretAction.providerId);
        window.setTimeout(() => setCopiedId(null), 2000);
      } catch {
        setVerifyError('Clipboard access was denied by the system.');
        return;
      }
    } else if (secretAction.type === 'recovery') {
      const result = await onSetRecoveryKey(verifyPassword);
      if (!result.ok || !result.recoveryKey) {
        setVerifyError('Could not set a recovery key for this vault.');
        return;
      }
      setNewRecoveryKey(result.recoveryKey);
    }

    setSecretAction(null);
    setVerifyPassword('');
  };

  /* ------------------------------------------------------------ key editing */

  const commitKey = (providerId: ProviderId) => {
    const draft = keyDrafts[providerId];
    if (draft === undefined) return;
    onUpdateProviderKey(providerId, draft.trim());
    setKeyDrafts(prev => {
      const next = { ...prev };
      delete next[providerId];
      return next;
    });
    setRevealed(prev => ({ ...prev, [providerId]: false }));
  };

  const cancelKey = (providerId: ProviderId) => {
    setKeyDrafts(prev => {
      const next = { ...prev };
      delete next[providerId];
      return next;
    });
  };

  /* ------------------------------------------------------------- add endpoint */

  const handleAddEndpointSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setAddError('');

    const baseUrl = baseUrlInput.trim();
    if (!isHttpUrl(baseUrl)) {
      setAddError('Base URL must start with http:// or https://');
      return;
    }
    if (chatEndpointInput.trim() && !chatEndpointInput.trim().startsWith('/')) {
      setAddError('Chat path must start with "/" (e.g. /v1/chat/completions)');
      return;
    }
    if (authTypeInput === 'custom' && !customHeaderInput.trim()) {
      setAddError('Custom auth requires a header name.');
      return;
    }

    onAddEndpointInstance({
      companyName: effectiveCompanyName,
      instanceName: userApiName.trim() || 'Instance',
      baseUrl,
      modelsEndpoint: modelsEndpointInput.trim() || '/models',
      chatEndpoint: chatEndpointInput.trim() || undefined,
      authType: authTypeInput,
      customHeaderName: customHeaderInput.trim() || undefined,
      apiKey: apiKeyInput.trim(),
      presetKey: endpointType === 'preset' ? selectedPresetId : endpointType,
      isCustom: endpointType !== 'preset',
    });

    setUserApiName('');
    setCustomCompanyName('');
    setApiKeyInput('');
    setChatEndpointInput('');
    setAddError('');
    setShowAddModal(false);
  };

  const handleImportSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!importJson) return;
    setImportError('');
    const success = await onImportVault(importJson);
    if (!success) {
      setImportError('Import failed: unrecognised format or corrupted file.');
    } else {
      setShowImport(false);
      setImportJson('');
    }
  };

  const renderStatus = (provider: ProviderConfig) => {
    switch (provider.status) {
      case 'active':
        return 'Active';
      case 'invalid_key':
        return 'Invalid key';
      case 'rate_limited':
        return 'Rate limited';
      case 'offline':
        return 'Offline';
      case 'degraded':
        return 'Degraded';
      default:
        return 'Unconfigured';
    }
  };

  const statusClass = (provider: ProviderConfig) => {
    switch (provider.status) {
      case 'active':
        return 'bg-zinc-800 border-zinc-600 text-white';
      case 'invalid_key':
        return 'bg-rose-950/60 border-rose-800 text-rose-300';
      case 'rate_limited':
        return 'bg-amber-950/60 border-amber-800 text-amber-300';
      case 'degraded':
        return 'bg-zinc-900 border-zinc-700 text-zinc-300';
      default:
        return 'bg-zinc-900/60 border-zinc-800 text-zinc-500';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 rounded-xl border border-zinc-800 bg-zinc-950/70 p-5 backdrop-blur-md md:flex-row md:items-center">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-light tracking-wide text-zinc-100">Secure API Key Vault</h1>
            <span className="rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 font-mono text-xs text-zinc-300">
              AES-GCM 256 · PBKDF2 600k
            </span>
          </div>
          <p className="mt-1 text-sm text-zinc-400">
            Keys are encrypted locally. Multi-instance accounts and OpenAI-compatible endpoints supported.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
          <button
            onClick={() => void onValidateAll()}
            disabled={isValidatingAll}
            className="cursor-pointer rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-zinc-200 transition-colors hover:border-zinc-500 hover:text-white disabled:opacity-50"
          >
            {isValidatingAll ? '[Validating…]' : '[Validate All]'}
          </button>

          <button
            onClick={() => setShowAddModal(true)}
            className="cursor-pointer rounded-lg border border-zinc-500 bg-zinc-800 px-3 py-1.5 font-medium text-white transition-colors hover:border-zinc-300 hover:bg-zinc-700"
          >
            + Add Endpoint
          </button>

          <button
            onClick={onExportVault}
            className="cursor-pointer rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-zinc-400 transition-colors hover:border-zinc-700 hover:text-white"
          >
            [Export]
          </button>

          <button
            onClick={() => setShowImport(true)}
            className="cursor-pointer rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-zinc-400 transition-colors hover:border-zinc-700 hover:text-white"
          >
            [Import]
          </button>

          <button
            onClick={() => {
              setSecretAction({ type: 'recovery' });
              setVerifyPassword('');
              setVerifyError('');
              setNewRecoveryKey(null);
            }}
            className="cursor-pointer rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-zinc-400 transition-colors hover:border-zinc-600 hover:text-white"
          >
            [Set Recovery Key]
          </button>

          <button
            onClick={() => setShowConfirmReset(true)}
            className="cursor-pointer rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-1.5 text-zinc-500 transition-colors hover:border-rose-800 hover:text-rose-400"
          >
            [Reset Keystore]
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {providers.map(provider => {
          const isRevealed = !!revealed[provider.id];
          const isTesting = isTestingProvider.has(provider.id);
          const hasKey = !!provider.apiKey;
          const draft = keyDrafts[provider.id];
          const isEditing = draft !== undefined;

          return (
            <div
              key={provider.id}
              className={`flex flex-col justify-between rounded-xl border p-5 transition-all duration-200 ${
                provider.status === 'active'
                  ? 'border-zinc-700 bg-zinc-950/70 hover:border-zinc-500'
                  : provider.status === 'invalid_key'
                    ? 'border-rose-900/60 bg-zinc-950/80 hover:border-rose-700'
                    : provider.status === 'rate_limited'
                      ? 'border-amber-900/60 bg-zinc-950/80 hover:border-amber-700'
                      : 'border-zinc-800/80 bg-zinc-950/60 hover:border-zinc-700'
              }`}
            >
              <div>
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="truncate text-lg font-medium tracking-wide text-white">
                        {provider.name}
                      </h2>
                      {provider.isCustom && (
                        <span className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                          Custom
                        </span>
                      )}
                    </div>
                    <span className="mt-0.5 block truncate font-mono text-xs text-zinc-400">
                      {provider.baseUrl}
                    </span>
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span
                      className={`rounded border px-2 py-0.5 font-mono text-[11px] ${statusClass(provider)}`}
                    >
                      {renderStatus(provider)}
                    </span>
                    {provider.latencyMs !== undefined && provider.latencyMs > 0 && (
                      <span className="font-mono text-[11px] text-zinc-400">
                        {provider.latencyMs}ms
                      </span>
                    )}
                  </div>
                </div>

                {provider.presetKey === 'openrouter' && (
                  <div className="mb-3.5 flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/60 p-2.5 font-mono text-xs">
                    <span className="text-zinc-400">Credit balance</span>
                    {hasKey && provider.balanceInfo ? (
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white">
                          $
                          {provider.balanceInfo.creditsRemainingUsd !== undefined
                            ? provider.balanceInfo.creditsRemainingUsd.toFixed(4)
                            : 'n/a'}
                        </span>
                        <span className="text-zinc-600">·</span>
                        <span className="text-zinc-400">
                          spent ${provider.balanceInfo.usageTotalUsd?.toFixed(4) ?? '0.00'}
                        </span>
                      </div>
                    ) : (
                      <span className="text-zinc-500">$0.00 (unconfigured)</span>
                    )}
                  </div>
                )}

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between font-mono text-xs text-zinc-400">
                    <label>
                      {provider.authType === 'none' ? 'Local daemon (no key)' : 'API key'}
                    </label>
                    {provider.statusMessage && (
                      <span className="max-w-[220px] truncate text-[11px] text-zinc-400">
                        {provider.statusMessage}
                      </span>
                    )}
                  </div>

                  {provider.authType === 'none' ? (
                    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-2.5 font-mono text-xs text-zinc-400">
                      Connects to the local socket at {provider.baseUrl}.
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {isRevealed && hasKey && (
                        <div className="break-all rounded-lg border border-zinc-700 bg-black p-2 font-mono text-xs text-zinc-200">
                          {provider.apiKey}
                        </div>
                      )}

                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={draft ?? (hasKey ? maskKey(provider.apiKey) : '')}
                          onChange={event =>
                            setKeyDrafts(prev => ({ ...prev, [provider.id]: event.target.value }))
                          }
                          onKeyDown={event => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              commitKey(provider.id);
                            } else if (event.key === 'Escape') {
                              cancelKey(provider.id);
                            }
                          }}
                          placeholder={hasKey ? '' : 'sk-…'}
                          spellCheck={false}
                          className={`w-full rounded-lg border bg-zinc-900/90 px-3 py-2 font-mono text-xs text-white placeholder-zinc-600 transition-colors focus:outline-none ${
                            isEditing
                              ? 'border-zinc-400 focus:border-white'
                              : 'border-zinc-800 text-zinc-400 focus:border-zinc-500'
                          }`}
                        />

                        {isEditing ? (
                          <>
                            <button
                              type="button"
                              onClick={() => commitKey(provider.id)}
                              className="cursor-pointer rounded border border-zinc-600 bg-zinc-800 px-1.5 py-0.5 font-mono text-[11px] text-white hover:bg-zinc-700"
                            >
                              [Save]
                            </button>
                            <button
                              type="button"
                              onClick={() => cancelKey(provider.id)}
                              className="cursor-pointer rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 font-mono text-[11px] text-zinc-300 hover:text-white"
                            >
                              [Cancel]
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => requestReveal(provider.id, provider.apiKey)}
                              disabled={!hasKey}
                              title="Reveal (requires master password)"
                              className="cursor-pointer rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 font-mono text-[11px] text-zinc-300 hover:text-white disabled:opacity-30"
                            >
                              {isRevealed ? '[Hide]' : '[Reveal]'}
                            </button>
                            <button
                              type="button"
                              onClick={() => requestCopy(provider.id, provider.apiKey)}
                              disabled={!hasKey}
                              title="Copy (requires master password)"
                              className="cursor-pointer rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 font-mono text-[11px] text-zinc-300 hover:text-white disabled:opacity-30"
                            >
                              {copiedId === provider.id ? '[Copied]' : '[Copy]'}
                            </button>
                          </>
                        )}
                      </div>

                      <p className="font-mono text-[10px] text-zinc-600">
                        Type to replace this key, then press Enter or [Save].
                      </p>
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-zinc-800/60 pt-3 font-mono text-xs">
                <span className="text-zinc-400">
                  {provider.models.length} {provider.models.length === 1 ? 'model' : 'models'}
                </span>

                <div className="flex items-center gap-2">
                  {(provider.isCustom ||
                    providers.filter(item => item.companyName === provider.companyName).length >
                      1) && (
                    <button
                      onClick={() => onRemoveEndpointInstance(provider.id)}
                      className="cursor-pointer rounded border border-zinc-800 px-2.5 py-1 text-rose-400 transition-colors hover:border-rose-800 hover:text-rose-200"
                    >
                      [Delete]
                    </button>
                  )}

                  <button
                    onClick={() => void onValidateProvider(provider.id)}
                    disabled={isTesting}
                    className="cursor-pointer rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1 text-zinc-200 transition-colors hover:border-zinc-500 hover:text-white disabled:opacity-50"
                  >
                    {isTesting ? '[Validating…]' : '[Test & Discover]'}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Password guard / recovery key modal */}
      {secretAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md space-y-4 rounded-xl border border-zinc-700 bg-zinc-950 p-6 font-mono text-xs text-white shadow-2xl">
            <div>
              <span className="mb-1 block uppercase tracking-widest text-zinc-400">
                [Security verification]
              </span>
              <h3 className="text-lg font-light text-white">
                {secretAction.type === 'reveal'
                  ? 'Confirm master password to reveal'
                  : secretAction.type === 'copy'
                    ? 'Confirm master password to copy'
                    : 'Confirm master password to set a recovery key'}
              </h3>
              <p className="mt-1 leading-relaxed text-zinc-400">
                {secretAction.type === 'recovery'
                  ? 'A new 12-character recovery key will be generated and bound to this vault. Your current recovery key stops working.'
                  : 'The master password is verified by decrypting the vault — it is never stored.'}
              </p>
            </div>

            {newRecoveryKey ? (
              <div className="space-y-3">
                <div className="break-all rounded-lg border border-zinc-700 bg-black p-3 text-center text-sm tracking-widest text-white">
                  {newRecoveryKey}
                </div>
                <p className="text-[11px] leading-relaxed text-zinc-300">
                  Write this down and store it somewhere safe. Without it and your password, the
                  vault cannot be recovered.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setNewRecoveryKey(null);
                    setSecretAction(null);
                  }}
                  className="w-full cursor-pointer rounded-lg bg-zinc-200 py-2 font-bold text-zinc-950 hover:bg-white"
                >
                  [I have saved it]
                </button>
              </div>
            ) : (
              <form onSubmit={handleVerifySubmit} className="space-y-3">
                <input
                  type="password"
                  placeholder="Master password…"
                  value={verifyPassword}
                  onChange={event => setVerifyPassword(event.target.value)}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-white placeholder-zinc-600 focus:border-zinc-400 focus:outline-none"
                  autoFocus
                  required
                />

                {verifyError && <p className="text-rose-400">{verifyError}</p>}

                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setSecretAction(null);
                      setVerifyPassword('');
                    }}
                    className="cursor-pointer rounded-lg border border-zinc-800 px-3.5 py-1.5 text-zinc-400 hover:bg-zinc-900"
                  >
                    [Cancel]
                  </button>
                  <button
                    type="submit"
                    disabled={isVerifying || !verifyPassword}
                    className="cursor-pointer rounded-lg bg-zinc-200 px-4 py-1.5 font-bold text-zinc-950 transition-colors hover:bg-white disabled:opacity-50"
                  >
                    {isVerifying ? 'Verifying…' : '[Authorize]'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Add endpoint modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-xl space-y-4 overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-950 p-6 font-mono text-xs text-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div>
                <span className="block text-[10px] uppercase tracking-widest text-zinc-500">
                  [Endpoint engine]
                </span>
                <h3 className="text-lg font-light text-white">Add endpoint instance</h3>
              </div>
              <button
                onClick={() => setShowAddModal(false)}
                className="cursor-pointer text-sm text-zinc-500 hover:text-zinc-300"
              >
                [Close]
              </button>
            </div>

            <form onSubmit={handleAddEndpointSubmit} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-zinc-400">Endpoint mode</label>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      ['preset', 'Preset', 'OpenAI, Anthropic, Groq, Ollama…'],
                      ['openai_compatible', 'OpenAI-compatible', 'Nous, z.ai, vLLM, Together…'],
                      ['custom', 'Custom', 'Any base URL and header'],
                    ] as const
                  ).map(([mode, label, hint]) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => {
                        setEndpointType(mode);
                        if (mode === 'preset') {
                          handlePresetChange(selectedPresetId);
                        } else if (mode === 'openai_compatible') {
                          setModelsEndpointInput('/models');
                          setAuthTypeInput('bearer');
                          setBaseUrlInput('https://api.nous.ai/v1');
                        } else {
                          setModelsEndpointInput('/v1/models');
                        }
                      }}
                      className={`cursor-pointer rounded-lg border p-2.5 text-left transition-colors ${
                        endpointType === mode
                          ? 'border-zinc-400 bg-zinc-800 font-medium text-white'
                          : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-white'
                      }`}
                    >
                      <span className="block font-medium">{label}</span>
                      <span className="mt-0.5 block text-[10px] text-zinc-500">{hint}</span>
                    </button>
                  ))}
                </div>
              </div>

              {endpointType === 'preset' ? (
                <div>
                  <label className="mb-1 block text-zinc-400">Preset provider</label>
                  <select
                    value={selectedPresetId}
                    onChange={event => handlePresetChange(event.target.value)}
                    className="w-full cursor-pointer rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-white focus:border-zinc-500 focus:outline-none"
                  >
                    {PROVIDER_PRESETS.map(preset => (
                      <option key={preset.id} value={preset.id}>
                        {preset.companyName} — {preset.description}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div>
                  <label className="mb-1 block text-zinc-400">Company / organization</label>
                  <input
                    type="text"
                    placeholder="e.g. Nous, z.ai, vLLM cluster"
                    value={customCompanyName}
                    onChange={event => setCustomCompanyName(event.target.value)}
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-white focus:border-zinc-500 focus:outline-none"
                    required
                  />
                </div>
              )}

              <div>
                <label className="mb-1 block text-zinc-400">Your name for this API (tag)</label>
                <input
                  type="text"
                  placeholder="e.g. Personal, Work, Production"
                  value={userApiName}
                  onChange={event => setUserApiName(event.target.value)}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-white focus:border-zinc-500 focus:outline-none"
                  required
                />
              </div>

              <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
                <span className="text-zinc-500">Display name</span>
                <span className="rounded border border-zinc-700 bg-black px-2 py-0.5 font-bold text-white">
                  {displayName}
                </span>
              </div>

              <div>
                <label className="mb-1 block text-zinc-400">Base URL</label>
                <input
                  type="url"
                  placeholder="https://api.openai.com/v1"
                  value={baseUrlInput}
                  onChange={event => setBaseUrlInput(event.target.value)}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-white focus:border-zinc-500 focus:outline-none"
                  required
                />
                <span className="mt-0.5 block text-[10px] text-zinc-500">
                  The API root, e.g. <code>https://api.nous.ai/v1</code>. A trailing /v1 is not
                  duplicated.
                </span>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-zinc-400">Models path</label>
                  <input
                    type="text"
                    placeholder="/models"
                    value={modelsEndpointInput}
                    onChange={event => setModelsEndpointInput(event.target.value)}
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-white focus:border-zinc-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-zinc-400">Chat path (optional)</label>
                  <input
                    type="text"
                    placeholder="auto"
                    value={chatEndpointInput}
                    onChange={event => setChatEndpointInput(event.target.value)}
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-white placeholder-zinc-600 focus:border-zinc-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-zinc-400">API key / token</label>
                <input
                  type="password"
                  placeholder="sk-…"
                  value={apiKeyInput}
                  onChange={event => setApiKeyInput(event.target.value)}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-white placeholder-zinc-600 focus:border-zinc-500 focus:outline-none"
                />
              </div>

              {endpointType === 'custom' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-zinc-400">Auth type</label>
                    <select
                      value={authTypeInput}
                      onChange={event => setAuthTypeInput(event.target.value as AuthType)}
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-white focus:border-zinc-500 focus:outline-none"
                    >
                      <option value="bearer">Bearer token</option>
                      <option value="x-api-key">x-api-key</option>
                      <option value="custom">Custom header</option>
                      <option value="none">No auth (local)</option>
                    </select>
                  </div>

                  {authTypeInput === 'custom' && (
                    <div>
                      <label className="mb-1 block text-zinc-400">Header name</label>
                      <input
                        type="text"
                        placeholder="X-Inference-Key"
                        value={customHeaderInput}
                        onChange={event => setCustomHeaderInput(event.target.value)}
                        className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-white focus:border-zinc-500 focus:outline-none"
                      />
                    </div>
                  )}
                </div>
              )}

              {addError && <p className="text-rose-400">{addError}</p>}

              <div className="flex justify-end gap-2 border-t border-zinc-800 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="cursor-pointer rounded-lg border border-zinc-800 px-3.5 py-1.5 text-zinc-400 hover:bg-zinc-900"
                >
                  [Cancel]
                </button>
                <button
                  type="submit"
                  className="cursor-pointer rounded-lg bg-zinc-200 px-4 py-1.5 font-bold text-zinc-950 transition-colors hover:bg-white"
                >
                  [Add endpoint]
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Import modal */}
      {showImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg space-y-4 rounded-xl border border-zinc-800 bg-zinc-950 p-6 font-mono text-xs text-white shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-light text-white">[Import vault]</h3>
              <button
                onClick={() => setShowImport(false)}
                className="cursor-pointer text-zinc-500 hover:text-zinc-300"
              >
                [Close]
              </button>
            </div>
            <p className="leading-relaxed text-zinc-400">
              Paste an exported Qin bundle. Encrypted payloads need the password they were created
              with; plaintext provider lists are restored directly.
            </p>

            <form onSubmit={handleImportSubmit} className="space-y-3">
              <textarea
                rows={6}
                placeholder="Paste JSON here…"
                value={importJson}
                onChange={event => setImportJson(event.target.value)}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-white focus:border-zinc-500 focus:outline-none"
                required
              />

              {importError && <p className="text-rose-400">{importError}</p>}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowImport(false)}
                  className="cursor-pointer rounded-lg border border-zinc-800 px-3.5 py-1.5 text-zinc-400 hover:bg-zinc-900"
                >
                  [Cancel]
                </button>
                <button
                  type="submit"
                  className="cursor-pointer rounded-lg bg-zinc-200 px-4 py-1.5 font-bold text-zinc-950 transition-colors hover:bg-white"
                >
                  [Import]
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reset modal */}
      {showConfirmReset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md space-y-4 rounded-xl border border-zinc-700 bg-zinc-950 p-6 font-mono text-xs text-white shadow-2xl">
            <h3 className="text-lg font-light text-white">[Reset keystore]</h3>
            <p className="leading-relaxed text-zinc-400">
              This erases the encrypted vault, including every stored API key. It cannot be undone.
              Only do this if both the master password and recovery key are lost.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowConfirmReset(false)}
                className="cursor-pointer rounded-lg border border-zinc-800 px-3.5 py-1.5 text-zinc-400 hover:bg-zinc-900"
              >
                [Cancel]
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowConfirmReset(false);
                  onResetVault();
                }}
                className="cursor-pointer rounded-lg bg-rose-700 px-4 py-1.5 font-bold text-white transition-colors hover:bg-rose-600"
              >
                [Confirm reset]
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default KeyVaultPanel;
