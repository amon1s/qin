import React, { useState } from 'react';
import { ProviderConfig, ProviderId, KeyringState, AuthType } from '../types';
import { PROVIDER_PRESETS } from '../services/providers';

interface KeyVaultPanelProps {
  providers: ProviderConfig[];
  keyring: KeyringState;
  onUpdateProviderKey: (id: ProviderId, newKey: string) => void;
  onAddEndpointInstance: (endpointConfig: {
    companyName: string;
    instanceName: string;
    baseUrl: string;
    modelsEndpoint: string;
    authType: AuthType;
    customHeaderName?: string;
    apiKey: string;
    presetKey?: string;
    isCustom?: boolean;
  }) => void;
  onRemoveEndpointInstance: (id: ProviderId) => void;
  onValidateProvider: (id: ProviderId) => Promise<void>;
  onValidateAll: () => Promise<void>;
  onExportVault: () => void;
  onImportVault: (jsonContent: string) => Promise<boolean>;
  onResetVault: () => void;
  onVerifyMasterPassword: (password: string) => Promise<boolean>;
  isTestingProvider: ProviderId | null;
  isValidatingAll: boolean;
}

export const KeyVaultPanel: React.FC<KeyVaultPanelProps> = ({
  providers,
  keyring: _keyring,
  onUpdateProviderKey,
  onAddEndpointInstance,
  onRemoveEndpointInstance,
  onValidateProvider,
  onValidateAll,
  onExportVault,
  onImportVault,
  onResetVault,
  onVerifyMasterPassword,
  isTestingProvider,
  isValidatingAll,
}) => {
  const [revealedKeys, setRevealedKeys] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Password verification guard state
  const [pendingSecretAction, setPendingSecretAction] = useState<{
    type: 'reveal' | 'copy';
    providerId: ProviderId;
    apiKey: string;
  } | null>(null);
  const [verifyPasswordInput, setVerifyPasswordInput] = useState('');
  const [verifyError, setVerifyError] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);

  // Add Custom / OpenAI-Compatible Endpoint Modal State
  const [showAddModal, setShowAddModal] = useState(false);
  const [endpointType, setEndpointType] = useState<'preset' | 'openai_compatible' | 'custom'>('preset');
  const [selectedPresetId, setSelectedPresetId] = useState('openai');

  // Dynamic naming scheme fields: formatted as "*Company Name* *Your Name for this API*"
  const [customCompanyName, setCustomCompanyName] = useState('');
  const [userApiName, setUserApiName] = useState('');

  const [baseUrlInput, setBaseUrlInput] = useState('https://api.openai.com/v1');
  const [modelsEndpointInput, setModelsEndpointInput] = useState('/models');
  const [authTypeInput, setAuthTypeInput] = useState<AuthType>('bearer');
  const [customHeaderInput, setCustomHeaderInput] = useState('');
  const [apiKeyInput, setApiKeyInput] = useState('');

  // Import modal state
  const [showImport, setShowImport] = useState(false);
  const [importJson, setImportJson] = useState('');
  const [importError, setImportError] = useState('');

  // Confirm reset state
  const [showConfirmReset, setShowConfirmReset] = useState(false);

  // When preset changes, prefill defaults
  const handlePresetChange = (presetId: string) => {
    setSelectedPresetId(presetId);
    const p = PROVIDER_PRESETS.find(item => item.id === presetId);
    if (p) {
      setBaseUrlInput(p.defaultBaseUrl);
      setModelsEndpointInput(p.defaultModelsEndpoint);
      setAuthTypeInput(p.authType);
    }
  };

  // Derive Company Name based on endpoint type
  const effectiveCompanyName =
    endpointType === 'preset'
      ? PROVIDER_PRESETS.find(p => p.id === selectedPresetId)?.companyName || 'Provider'
      : customCompanyName.trim() || (endpointType === 'openai_compatible' ? 'Custom OpenAI' : 'Custom');

  // Formatted strictly as: "*Company Name* *Your Name for this API*"
  const formattedInstanceDisplayName = `${effectiveCompanyName} ${userApiName.trim() || 'Instance'}`.trim();

  // Guarded Reveal handler
  const handleRequestReveal = (providerId: ProviderId, apiKey: string) => {
    if (revealedKeys[providerId]) {
      setRevealedKeys(prev => ({ ...prev, [providerId]: false }));
      return;
    }
    setPendingSecretAction({ type: 'reveal', providerId, apiKey });
    setVerifyPasswordInput('');
    setVerifyError('');
  };

  // Guarded Copy handler
  const handleRequestCopy = (providerId: ProviderId, apiKey: string) => {
    if (!apiKey) return;
    setPendingSecretAction({ type: 'copy', providerId, apiKey });
    setVerifyPasswordInput('');
    setVerifyError('');
  };

  const handleVerifySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!verifyPasswordInput || !pendingSecretAction) return;

    setIsVerifying(true);
    setVerifyError('');
    const isValid = await onVerifyMasterPassword(verifyPasswordInput);
    setIsVerifying(false);

    if (isValid) {
      if (pendingSecretAction.type === 'reveal') {
        setRevealedKeys(prev => ({ ...prev, [pendingSecretAction.providerId]: true }));
      } else if (pendingSecretAction.type === 'copy') {
        navigator.clipboard.writeText(pendingSecretAction.apiKey);
        setCopiedId(pendingSecretAction.providerId);
        setTimeout(() => setCopiedId(null), 2000);
      }
      setPendingSecretAction(null);
      setVerifyPasswordInput('');
    } else {
      setVerifyError('Incorrect Master Password. Secret access denied.');
    }
  };

  const handleAddEndpointSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!baseUrlInput) return;

    onAddEndpointInstance({
      companyName: effectiveCompanyName,
      instanceName: userApiName.trim() || 'Instance',
      baseUrl: baseUrlInput.trim(),
      modelsEndpoint: modelsEndpointInput.trim() || '/models',
      authType: authTypeInput,
      customHeaderName: customHeaderInput.trim() || undefined,
      apiKey: apiKeyInput.trim(),
      presetKey: endpointType === 'preset' ? selectedPresetId : endpointType,
      isCustom: endpointType !== 'preset',
    });

    // Reset modal
    setUserApiName('');
    setCustomCompanyName('');
    setApiKeyInput('');
    setShowAddModal(false);
  };

  const handleImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!importJson) return;
    setImportError('');
    const success = await onImportVault(importJson);
    if (!success) {
      setImportError('Failed to import vault: invalid format or corrupted file.');
    } else {
      setShowImport(false);
      setImportJson('');
    }
  };

  const maskKey = (key: string) => {
    if (!key) return '';
    if (key.length <= 8) return '••••••••';
    return `${key.slice(0, 4)}••••••••${key.slice(-4)}`;
  };

  return (
    <div className="space-y-6">
      {/* Top Header & Master Vault Control Strip */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 p-5 rounded-xl border border-zinc-800 bg-zinc-950/70 backdrop-blur-md">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-light text-zinc-100 tracking-wide">
              Secure API Key Vault
            </h1>
            <span className="text-xs font-mono px-2 py-0.5 rounded bg-zinc-900 text-zinc-300 border border-zinc-700">
              AES-GCM 256-bit
            </span>
          </div>
          <p className="text-sm text-zinc-400 mt-1">
            Persisted locally with PBKDF2 encryption. Supports multi-instance accounts and OpenAI-compatible endpoints.
          </p>
        </div>

        {/* Text-First Minimalist Action Toolbar (Renamed button per spec) */}
        <div className="flex items-center flex-wrap gap-2 text-xs font-mono">
          <button
            onClick={() => onValidateAll()}
            disabled={isValidatingAll}
            className="px-3 py-1.5 rounded-lg border border-zinc-700 hover:border-zinc-500 bg-zinc-900 text-zinc-200 hover:text-white transition-colors disabled:opacity-50 cursor-pointer"
          >
            {isValidatingAll ? '[Validating...]' : '[Validate All]'}
          </button>

          {/* Action button renamed strictly per prompt Section II.1 */}
          <button
            onClick={() => setShowAddModal(true)}
            className="px-3 py-1.5 rounded-lg border border-zinc-500 hover:border-zinc-300 bg-zinc-800 hover:bg-zinc-700 text-white font-medium transition-colors cursor-pointer shadow-[0_0_10px_rgba(255,255,255,0.06)]"
          >
            + Add Custom / OpenAI-Compatible Endpoint
          </button>

          <button
            onClick={onExportVault}
            className="px-3 py-1.5 rounded-lg border border-zinc-800 hover:border-zinc-700 bg-zinc-900/60 text-zinc-400 hover:text-white transition-colors cursor-pointer"
          >
            [Export Vault]
          </button>

          <button
            onClick={() => setShowImport(true)}
            className="px-3 py-1.5 rounded-lg border border-zinc-800 hover:border-zinc-700 bg-zinc-900/60 text-zinc-400 hover:text-white transition-colors cursor-pointer"
          >
            [Import Vault]
          </button>

          <button
            onClick={() => setShowConfirmReset(true)}
            className="px-3 py-1.5 rounded-lg border border-zinc-800 hover:border-rose-800 bg-zinc-900/40 text-zinc-500 hover:text-rose-400 transition-colors cursor-pointer"
          >
            [Reset Keystore]
          </button>
        </div>
      </div>

      {/* Provider & Endpoint Instance Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {providers.map(provider => {
          const isRevealed = !!revealedKeys[provider.id];
          const isTesting = isTestingProvider === provider.id;
          const hasKey = !!provider.apiKey;

          return (
            <div
              key={provider.id}
              className={`p-5 rounded-xl border transition-all duration-200 flex flex-col justify-between ${
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
                {/* Header row: Dynamic Formatted Name (*Company Name* *Your Name for this API*) */}
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-medium text-white tracking-wide">
                        {provider.name}
                      </h2>
                      {provider.isCustom && (
                        <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
                          Custom
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-zinc-400 font-mono block mt-0.5 truncate max-w-[260px]">
                      {provider.baseUrl}
                    </span>
                  </div>

                  {/* Status Indicator Badge */}
                  <div className="flex flex-col items-end gap-1">
                    <span
                      className={`text-[11px] font-mono px-2 py-0.5 rounded border ${
                        provider.status === 'active'
                          ? 'bg-zinc-800 border-zinc-600 text-white font-medium'
                          : provider.status === 'invalid_key'
                          ? 'bg-rose-950/60 border-rose-800 text-rose-300'
                          : provider.status === 'rate_limited'
                          ? 'bg-amber-950/60 border-amber-800 text-amber-300'
                          : provider.status === 'offline'
                          ? 'bg-zinc-900 border-zinc-800 text-zinc-400'
                          : provider.status === 'degraded'
                          ? 'bg-zinc-900 border-zinc-700 text-zinc-300'
                          : 'bg-zinc-900/60 border-zinc-800 text-zinc-500'
                      }`}
                    >
                      {provider.status === 'active' && 'Active (Valid)'}
                      {provider.status === 'invalid_key' && 'Invalid Key'}
                      {provider.status === 'rate_limited' && 'Rate Limited'}
                      {provider.status === 'offline' && 'Offline'}
                      {provider.status === 'degraded' && 'Degraded'}
                      {provider.status === 'unconfigured' && 'Unconfigured'}
                    </span>

                    {provider.latencyMs !== undefined && provider.latencyMs > 0 && (
                      <span className="text-[11px] font-mono text-zinc-400">
                        {provider.latencyMs}ms latency
                      </span>
                    )}
                  </div>
                </div>

                {/* OpenRouter Live Balance Display (Strictly reset to $0.00 / Unconfigured when no valid key is present) */}
                {provider.presetKey === 'openrouter' && (
                  <div className="mb-3.5 p-2.5 rounded-lg border border-zinc-800 bg-zinc-900/60 flex items-center justify-between text-xs font-mono">
                    <span className="text-zinc-400">Live Credit Balance:</span>
                    <div>
                      {hasKey && provider.balanceInfo ? (
                        <div className="flex items-center gap-2">
                          <span className="text-white font-bold">
                            ${provider.balanceInfo.creditsRemainingUsd !== undefined ? provider.balanceInfo.creditsRemainingUsd.toFixed(4) : '0.00'}
                          </span>
                          <span className="text-zinc-600">·</span>
                          <span className="text-zinc-400">
                            Spent: ${provider.balanceInfo.usageTotalUsd?.toFixed(4) ?? '0.00'}
                          </span>
                        </div>
                      ) : (
                        <span className="text-zinc-500">$0.00 (Unconfigured)</span>
                      )}
                    </div>
                  </div>
                )}

                {/* API Key Input / Masked Display */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-zinc-400 font-mono">
                    <label>
                      {provider.authType === 'none' ? 'Local Daemon (No Key Required)' : 'API Key Secret'}
                    </label>
                    {provider.statusMessage && (
                      <span className="text-[11px] text-zinc-400 truncate max-w-[220px]">
                        {provider.statusMessage}
                      </span>
                    )}
                  </div>

                  {provider.authType !== 'none' ? (
                    <div className="relative flex items-center">
                      <input
                        type={isRevealed ? 'text' : 'password'}
                        value={isRevealed ? provider.apiKey : maskKey(provider.apiKey)}
                        onChange={e => onUpdateProviderKey(provider.id, e.target.value)}
                        placeholder="sk-..."
                        className="w-full pl-3 pr-28 py-2 text-xs font-mono rounded-lg border border-zinc-800 bg-zinc-900/90 text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 transition-colors"
                      />

                      <div className="absolute right-2 flex items-center gap-1.5 font-mono text-[11px]">
                        <button
                          type="button"
                          onClick={() => handleRequestReveal(provider.id, provider.apiKey)}
                          disabled={!provider.apiKey}
                          className="px-1.5 py-0.5 rounded border border-zinc-700 bg-zinc-800 text-zinc-300 hover:text-white disabled:opacity-30 cursor-pointer"
                          title="Reveal API Key (requires Master Password confirmation)"
                        >
                          {isRevealed ? '[Hide]' : '[Reveal]'}
                        </button>

                        <button
                          type="button"
                          onClick={() => handleRequestCopy(provider.id, provider.apiKey)}
                          disabled={!provider.apiKey}
                          className="px-1.5 py-0.5 rounded border border-zinc-700 bg-zinc-800 text-zinc-300 hover:text-white disabled:opacity-30 cursor-pointer"
                          title="Copy Key to Clipboard (requires Master Password confirmation)"
                        >
                          {copiedId === provider.id ? '[Copied]' : '[Copy]'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="p-2.5 rounded-lg border border-zinc-800 bg-zinc-900/40 text-xs font-mono text-zinc-400">
                      Connects automatically to local socket at {provider.baseUrl}.
                    </div>
                  )}
                </div>
              </div>

              {/* Bottom Card Footer: Actions */}
              <div className="mt-4 pt-3 border-t border-zinc-800/60 flex items-center justify-between text-xs font-mono">
                <span className="text-zinc-400">
                  {provider.models.length} {provider.models.length === 1 ? 'model' : 'models'} discovered
                </span>

                <div className="flex items-center gap-2">
                  {/* Delete button available for custom or extra instances */}
                  {(provider.isCustom || providers.filter(p => p.companyName === provider.companyName).length > 1) && (
                    <button
                      onClick={() => onRemoveEndpointInstance(provider.id)}
                      className="px-2.5 py-1 text-xs text-rose-400 hover:text-rose-200 border border-zinc-800 hover:border-rose-800 rounded transition-colors cursor-pointer"
                      title="Remove this endpoint instance from vault"
                    >
                      [Delete]
                    </button>
                  )}

                  <button
                    onClick={() => onValidateProvider(provider.id)}
                    disabled={isTesting}
                    className="px-3 py-1 rounded-md border border-zinc-700 hover:border-zinc-500 bg-zinc-900 text-zinc-200 hover:text-white transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    {isTesting ? '[Validating...]' : '[Test & Discover]'}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Password Verification Guard Modal */}
      {pendingSecretAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
          <div className="w-full max-w-md p-6 rounded-xl border border-zinc-700 bg-zinc-950 text-white shadow-2xl space-y-4 font-mono text-xs">
            <div>
              <span className="text-zinc-400 uppercase tracking-widest block mb-1">
                [Security Verification Guard]
              </span>
              <h3 className="text-lg font-light text-white">
                Confirm Master Password
              </h3>
              <p className="text-zinc-400 mt-1 leading-relaxed">
                Re-enter your Master Password to {pendingSecretAction.type === 'reveal' ? 'reveal' : 'copy'} the credential secret for {pendingSecretAction.providerId}.
              </p>
            </div>

            <form onSubmit={handleVerifySubmit} className="space-y-3">
              <input
                type="password"
                placeholder="Enter master password..."
                value={verifyPasswordInput}
                onChange={e => setVerifyPasswordInput(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-zinc-700 bg-zinc-900 text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-400"
                autoFocus
                required
              />

              {verifyError && (
                <p className="text-rose-400">{verifyError}</p>
              )}

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setPendingSecretAction(null);
                    setVerifyPasswordInput('');
                  }}
                  className="px-3.5 py-1.5 rounded-lg border border-zinc-800 hover:bg-zinc-900 text-zinc-400 cursor-pointer"
                >
                  [Cancel]
                </button>
                <button
                  type="submit"
                  disabled={isVerifying || !verifyPasswordInput}
                  className="px-4 py-1.5 rounded-lg bg-zinc-200 hover:bg-white text-zinc-950 font-bold transition-colors cursor-pointer disabled:opacity-50"
                >
                  {isVerifying ? 'Verifying...' : '[Authorize]'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Custom / OpenAI-Compatible Endpoint Engine Modal (Section II.2) */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-xl p-6 rounded-xl border border-zinc-700 bg-zinc-950 text-white shadow-2xl space-y-4 font-mono text-xs max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div>
                <span className="text-[10px] text-zinc-500 uppercase tracking-widest block">
                  [ENDPOINT ENGINE]
                </span>
                <h3 className="text-lg font-light text-white">
                  Add Endpoint Instance
                </h3>
              </div>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-zinc-500 hover:text-zinc-300 cursor-pointer text-sm"
              >
                [Close]
              </button>
            </div>

            <form onSubmit={handleAddEndpointSubmit} className="space-y-4">
              {/* Type Selector: Preset Provider vs Custom OpenAI-Compatible vs Custom Unpreseted */}
              <div>
                <label className="block text-zinc-400 mb-1.5">Select Endpoint Mode:</label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setEndpointType('preset');
                      handlePresetChange(selectedPresetId);
                    }}
                    className={`p-2.5 rounded-lg border text-left transition-colors cursor-pointer ${
                      endpointType === 'preset'
                        ? 'border-zinc-400 bg-zinc-800 text-white font-medium'
                        : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-white'
                    }`}
                  >
                    <span className="block font-medium">Preseted Provider</span>
                    <span className="text-[10px] text-zinc-500 block mt-0.5">OpenAI, Anthropic, Groq, Ollama...</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setEndpointType('openai_compatible');
                      setModelsEndpointInput('/models');
                      setAuthTypeInput('bearer');
                      setBaseUrlInput('https://api.nous.ai/v1');
                    }}
                    className={`p-2.5 rounded-lg border text-left transition-colors cursor-pointer ${
                      endpointType === 'openai_compatible'
                        ? 'border-zinc-400 bg-zinc-800 text-white font-medium'
                        : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-white'
                    }`}
                  >
                    <span className="block font-medium">OpenAI-Compatible</span>
                    <span className="text-[10px] text-zinc-500 block mt-0.5">Nous, z.ai, vLLM, Together...</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setEndpointType('custom');
                      setModelsEndpointInput('/v1/models');
                    }}
                    className={`p-2.5 rounded-lg border text-left transition-colors cursor-pointer ${
                      endpointType === 'custom'
                        ? 'border-zinc-400 bg-zinc-800 text-white font-medium'
                        : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-white'
                    }`}
                  >
                    <span className="block font-medium">Custom Unpreseted</span>
                    <span className="text-[10px] text-zinc-500 block mt-0.5">Fully custom base URLs & headers</span>
                  </button>
                </div>
              </div>

              {/* Preseted Provider Choice */}
              {endpointType === 'preset' && (
                <div>
                  <label className="block text-zinc-400 mb-1">Preset Provider Company:</label>
                  <select
                    value={selectedPresetId}
                    onChange={e => handlePresetChange(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-zinc-800 bg-zinc-900 text-white focus:outline-none focus:border-zinc-500 cursor-pointer"
                  >
                    {PROVIDER_PRESETS.map(preset => (
                      <option key={preset.id} value={preset.id}>
                        {preset.companyName} — {preset.description}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Custom Company Name Input if not preset */}
              {endpointType !== 'preset' && (
                <div>
                  <label className="block text-zinc-400 mb-1">Company / Organization Name:</label>
                  <input
                    type="text"
                    placeholder="e.g. Nous, z.ai, vLLM Cluster, DeepInfra"
                    value={customCompanyName}
                    onChange={e => setCustomCompanyName(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-zinc-800 bg-zinc-900 text-white focus:outline-none focus:border-zinc-500"
                    required
                  />
                </div>
              )}

              {/* Dynamic Naming Scheme: "Your Name for this API" */}
              <div>
                <label className="block text-zinc-400 mb-1">Your Name for this API (Account / Tag):</label>
                <input
                  type="text"
                  placeholder="e.g. ABC, Production, Personal, Work, Staging"
                  value={userApiName}
                  onChange={e => setUserApiName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-zinc-800 bg-zinc-900 text-white focus:outline-none focus:border-zinc-500"
                  required
                />
              </div>

              {/* Live Preview of formatted naming scheme: strictly "*Company Name* *Your Name for this API*" */}
              <div className="p-3 rounded-lg border border-zinc-800 bg-zinc-900/60 flex items-center justify-between">
                <span className="text-zinc-500">Instance Display Name Scheme:</span>
                <span className="text-white font-bold bg-black px-2 py-0.5 rounded border border-zinc-700">
                  {formattedInstanceDisplayName}
                </span>
              </div>

              {/* Base Endpoint URL */}
              <div>
                <label className="block text-zinc-400 mb-1">Base Endpoint URL:</label>
                <input
                  type="url"
                  placeholder="e.g. https://api.openai.com/v1 or https://api.z.ai/v1"
                  value={baseUrlInput}
                  onChange={e => setBaseUrlInput(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-zinc-800 bg-zinc-900 text-white focus:outline-none focus:border-zinc-500"
                  required
                />
              </div>

              {/* Models Discovery Endpoint Path */}
              <div>
                <label className="block text-zinc-400 mb-1">Discovery Endpoint Path:</label>
                <input
                  type="text"
                  placeholder="/models or /v1/models"
                  value={modelsEndpointInput}
                  onChange={e => setModelsEndpointInput(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-zinc-800 bg-zinc-900 text-white focus:outline-none focus:border-zinc-500"
                  required
                />
                <span className="text-[10px] text-zinc-500 mt-0.5 block">
                  Targeted with standard GET /v1/models payload resolution.
                </span>
              </div>

              {/* API Key */}
              <div>
                <label className="block text-zinc-400 mb-1">API Key / Token:</label>
                <input
                  type="password"
                  placeholder="sk-... or authorization token"
                  value={apiKeyInput}
                  onChange={e => setApiKeyInput(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-zinc-800 bg-zinc-900 text-white focus:outline-none focus:border-zinc-500"
                />
              </div>

              {/* Custom Header if Custom Mode */}
              {endpointType === 'custom' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-zinc-400 mb-1">Auth Type:</label>
                    <select
                      value={authTypeInput}
                      onChange={e => setAuthTypeInput(e.target.value as AuthType)}
                      className="w-full px-3 py-2 rounded-lg border border-zinc-800 bg-zinc-900 text-white focus:outline-none focus:border-zinc-500"
                    >
                      <option value="bearer">Bearer Token</option>
                      <option value="x-api-key">x-api-key</option>
                      <option value="custom">Custom Header</option>
                      <option value="none">No Auth (Local)</option>
                    </select>
                  </div>

                  {authTypeInput === 'custom' && (
                    <div>
                      <label className="block text-zinc-400 mb-1">Custom Header Name:</label>
                      <input
                        type="text"
                        placeholder="e.g. X-Inference-Key"
                        value={customHeaderInput}
                        onChange={e => setCustomHeaderInput(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-zinc-800 bg-zinc-900 text-white focus:outline-none focus:border-zinc-500"
                        required
                      />
                    </div>
                  )}
                </div>
              )}

              <div className="pt-2 flex justify-end gap-2 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-3.5 py-1.5 rounded-lg border border-zinc-800 hover:bg-zinc-900 text-zinc-400 cursor-pointer"
                >
                  [Cancel]
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg bg-zinc-200 hover:bg-white text-zinc-950 font-bold transition-colors cursor-pointer"
                >
                  [Add Endpoint Instance]
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Import Vault Modal */}
      {showImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
          <div className="w-full max-w-lg p-6 rounded-xl border border-zinc-800 bg-zinc-950 text-white shadow-2xl space-y-4 font-mono text-xs">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-light text-white">[Import Encrypted Vault]</h3>
              <button
                onClick={() => setShowImport(false)}
                className="text-zinc-500 hover:text-zinc-300 cursor-pointer"
              >
                [Close]
              </button>
            </div>
            <p className="text-zinc-400 leading-relaxed">
              Paste the exported JSON vault backup to import your credentials and endpoint instances.
            </p>

            <form onSubmit={handleImportSubmit} className="space-y-3">
              <textarea
                rows={6}
                placeholder="Paste encrypted JSON backup content here..."
                value={importJson}
                onChange={e => setImportJson(e.target.value)}
                className="w-full p-3 rounded-lg border border-zinc-800 bg-zinc-900 text-white focus:outline-none focus:border-zinc-500"
                required
              />

              {importError && (
                <p className="text-rose-400">{importError}</p>
              )}

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowImport(false)}
                  className="px-3.5 py-1.5 rounded-lg border border-zinc-800 hover:bg-zinc-900 text-zinc-400 cursor-pointer"
                >
                  [Cancel]
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg bg-zinc-200 hover:bg-white text-zinc-950 font-bold transition-colors cursor-pointer"
                >
                  [Import Vault]
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Keystore Reinitialization Modal */}
      {showConfirmReset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
          <div className="w-full max-w-md p-6 rounded-xl border border-zinc-700 bg-zinc-950 text-white shadow-2xl space-y-4 font-mono text-xs">
            <h3 className="text-lg font-light text-white">[Reset Keystore]</h3>
            <p className="text-zinc-400 leading-relaxed">
              This will clear the encrypted local storage and prompt you to establish a fresh Master Password. Use this if you forgot your password and recovery key.
            </p>
            <div className="pt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowConfirmReset(false)}
                className="px-3.5 py-1.5 rounded-lg border border-zinc-800 hover:bg-zinc-900 text-zinc-400 cursor-pointer"
              >
                [Cancel]
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowConfirmReset(false);
                  onResetVault();
                }}
                className="px-4 py-1.5 rounded-lg bg-rose-700 hover:bg-rose-600 text-white font-bold transition-colors cursor-pointer"
              >
                [Confirm Reset]
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default KeyVaultPanel;
