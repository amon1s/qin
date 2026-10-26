import React, { useState } from 'react';
import { AppSettings } from '../types';
import { bridge } from '../services/storage';

interface SettingsPanelProps {
  settings: AppSettings;
  storageLocation: string;
  appVersion: string;
  onUpdateSettings: (newSettings: Partial<AppSettings>) => void;
  onResetSettings: () => void;
  onTriggerSplash: () => void;
}

const BLUR_OPTIONS = [
  { id: 'none', label: 'Crisp (0px)', desc: 'No blur' },
  { id: 'sm', label: 'Soft (4px)', desc: 'Subtle' },
  { id: 'md', label: 'Balanced (12px)', desc: 'Frosted glass' },
  { id: 'xl', label: 'Heavy (28px)', desc: 'Deep diffusion' },
] as const;

const PALETTES = [
  { label: 'Slate monochrome', glow: '#d4d4d8', secondary: '#71717a' },
  { label: 'Ethereal violet', glow: '#8b5cf6', secondary: '#ffffff' },
  { label: 'Cyan plasma', glow: '#38bdf8', secondary: '#bae6fd' },
  { label: 'Emerald aurora', glow: '#34d399', secondary: '#a7f3d0' },
  { label: 'Minimal white', glow: '#ffffff', secondary: '#a1a1aa' },
  { label: 'Amber solar', glow: '#f59e0b', secondary: '#fef3c7' },
];

const FIBER_DEFAULTS: Partial<AppSettings> = {
  fiberOpacity: 0.75,
  fiberSpeed: 1.2,
  fiberTwist: 1.2,
  fiberGlowColor: '#d4d4d8',
  fiberSecondaryColor: '#71717a',
  fiberStyle: 'dots',
  fiberThreads: 72,
  fiberLayers: 3,
};

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  settings,
  storageLocation,
  appVersion,
  onUpdateSettings,
  onResetSettings,
  onTriggerSplash,
}) => {
  const [tab, setTab] = useState<'appearance' | 'interface' | 'about'>('appearance');

  const openExternal = (url: string) => {
    const bridgeApi = bridge();
    if (bridgeApi) void bridgeApi.openExternal(url);
    else window.open(url, '_blank', 'noreferrer');
  };

  const slider = (
    label: string,
    key: 'fiberOpacity' | 'fiberTwist' | 'fiberSpeed',
    min: number,
    max: number,
    step: number,
    format: (value: number) => string
  ) => (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-medium text-zinc-200">{label}</span>
        <span className="rounded border border-zinc-800 bg-zinc-900 px-2 py-0.5 font-mono text-white">
          {format(settings[key])}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={settings[key]}
        onChange={event => onUpdateSettings({ [key]: parseFloat(event.target.value) })}
        className="h-1.5 w-full cursor-pointer accent-zinc-300"
      />
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 rounded-xl border border-zinc-800 bg-zinc-950/70 p-5 backdrop-blur-md md:flex-row md:items-center">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-light tracking-wide text-zinc-100">
              Settings &amp; Customization
            </h1>
            <span className="rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 font-mono text-xs text-zinc-300">
              Desktop preferences
            </span>
          </div>
          <p className="mt-1 text-sm text-zinc-400">
            Backdrop blur, typography scale, background canvas, and vault details.
          </p>
        </div>

        <button
          onClick={onResetSettings}
          className="cursor-pointer rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 font-mono text-xs text-zinc-400 transition-colors hover:border-zinc-700 hover:text-white"
        >
          [Reset defaults]
        </button>
      </div>

      <div className="flex items-center gap-2 border-b border-zinc-800 pb-2 font-mono text-xs">
        {(
          [
            ['appearance', 'Appearance'],
            ['interface', 'Interface'],
            ['about', 'About'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`cursor-pointer rounded-lg px-4 py-2 transition-colors ${
              tab === id
                ? 'border border-zinc-600 bg-zinc-800 font-medium text-white'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            [{label}]
          </button>
        ))}
      </div>

      {tab === 'appearance' && (
        <div className="space-y-5 font-mono text-xs">
          <div className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-950/60 p-5">
            <div>
              <h2 className="text-sm font-medium uppercase tracking-wider text-white">
                [Backdrop blur]
              </h2>
              <p className="mt-1 leading-relaxed text-zinc-400">
                Applies a CSS variable across every glass panel at once.
              </p>
            </div>

            <div className="grid max-w-xl grid-cols-2 gap-3 pt-1 sm:grid-cols-4">
              {BLUR_OPTIONS.map(option => (
                <button
                  key={option.id}
                  onClick={() => onUpdateSettings({ blurIntensity: option.id })}
                  className={`cursor-pointer rounded-lg border p-3 text-left transition-colors ${
                    settings.blurIntensity === option.id
                      ? 'border-zinc-400 bg-zinc-800 font-bold text-white'
                      : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-white'
                  }`}
                >
                  <span className="mb-0.5 block font-medium text-white">{option.label}</span>
                  <span className="block text-[10px] leading-tight text-zinc-500">
                    {option.desc}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-5 rounded-xl border border-zinc-800 bg-zinc-950/60 p-5">
            <div className="flex flex-col justify-between gap-2 border-b border-zinc-800/80 pb-3 sm:flex-row sm:items-center">
              <div>
                <h2 className="text-sm font-medium uppercase tracking-wider text-white">
                  [Background canvas]
                </h2>
                <p className="mt-1 leading-relaxed text-zinc-400">
                  WebGL ribbons behind the interface. Disabling motion at the OS level stops it.
                </p>
              </div>
              <button
                onClick={() => onUpdateSettings(FIBER_DEFAULTS)}
                className="cursor-pointer self-start rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-[11px] text-zinc-400 transition-colors hover:border-zinc-700 hover:text-white sm:self-auto"
              >
                [Reset canvas]
              </button>
            </div>

            {slider('Canvas opacity', 'fiberOpacity', 0.05, 1, 0.05, value =>
              `${Math.round(value * 100)}%`
            )}
            {slider('Ribbon twist', 'fiberTwist', 0, 3, 0.1, value => `${value.toFixed(1)}×`)}
            {slider('Flow speed', 'fiberSpeed', 0.1, 3, 0.1, value => `${value.toFixed(1)}×`)}

            <div className="space-y-1.5 border-t border-zinc-900 pt-3">
              <span className="text-[11px] text-zinc-400">Palette presets</span>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {PALETTES.map(palette => {
                  const selected =
                    settings.fiberGlowColor.toLowerCase() === palette.glow.toLowerCase() &&
                    settings.fiberSecondaryColor.toLowerCase() === palette.secondary.toLowerCase();
                  return (
                    <button
                      key={palette.label}
                      onClick={() =>
                        onUpdateSettings({
                          fiberGlowColor: palette.glow,
                          fiberSecondaryColor: palette.secondary,
                        })
                      }
                      className={`flex cursor-pointer items-center justify-between rounded-lg border p-2 text-left transition-colors ${
                        selected
                          ? 'border-zinc-400 bg-zinc-800 font-bold text-white'
                          : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-white'
                      }`}
                    >
                      <span className="text-[11px]">{palette.label}</span>
                      <span className="flex items-center gap-1">
                        <span
                          className="h-3 w-3 rounded-full border border-zinc-700"
                          style={{ backgroundColor: palette.glow }}
                        />
                        <span
                          className="h-3 w-3 rounded-full border border-zinc-700"
                          style={{ backgroundColor: palette.secondary }}
                        />
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 border-t border-zinc-900 pt-3 sm:grid-cols-2">
              {(
                [
                  ['Primary / glow', 'fiberGlowColor'],
                  ['Secondary / wave', 'fiberSecondaryColor'],
                ] as const
              ).map(([label, key]) => (
                <div key={key} className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-zinc-300">{label}</span>
                    <span className="font-mono text-[10px] text-zinc-400">{settings[key]}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={settings[key]}
                      onChange={event => onUpdateSettings({ [key]: event.target.value })}
                      className="h-8 w-8 cursor-pointer rounded border border-zinc-700 bg-transparent"
                    />
                    <input
                      type="text"
                      value={settings[key]}
                      onChange={event => onUpdateSettings({ [key]: event.target.value })}
                      className="flex-1 rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1 font-mono text-xs text-white focus:border-zinc-500 focus:outline-none"
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-3 border-t border-zinc-900 pt-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <span className="text-[11px] text-zinc-400">Style</span>
                <div className="grid grid-cols-3 gap-1">
                  {(['dots', 'dashes', 'lines'] as const).map(style => (
                    <button
                      key={style}
                      onClick={() => onUpdateSettings({ fiberStyle: style })}
                      className={`cursor-pointer rounded border px-2 py-1.5 text-center text-[10px] uppercase transition-colors ${
                        (settings.fiberStyle ?? 'dots') === style
                          ? 'border-zinc-400 bg-zinc-800 font-bold text-white'
                          : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-white'
                      }`}
                    >
                      {style}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <span className="text-[11px] text-zinc-400">Layers</span>
                <div className="grid grid-cols-3 gap-1">
                  {[1, 2, 3].map(layer => (
                    <button
                      key={layer}
                      onClick={() => onUpdateSettings({ fiberLayers: layer })}
                      className={`cursor-pointer rounded border px-2 py-1.5 text-center text-[10px] transition-colors ${
                        (settings.fiberLayers ?? 3) === layer
                          ? 'border-zinc-400 bg-zinc-800 font-bold text-white'
                          : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-white'
                      }`}
                    >
                      {layer}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <span className="text-[11px] text-zinc-400">Threads</span>
                <div className="grid grid-cols-3 gap-1">
                  {[
                    { label: '36', value: 36 },
                    { label: '72', value: 72 },
                    { label: '108', value: 108 },
                  ].map(thread => (
                    <button
                      key={thread.value}
                      onClick={() => onUpdateSettings({ fiberThreads: thread.value })}
                      className={`cursor-pointer rounded border px-2 py-1.5 text-center text-[10px] transition-colors ${
                        (settings.fiberThreads ?? 72) === thread.value
                          ? 'border-zinc-400 bg-zinc-800 font-bold text-white'
                          : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-white'
                      }`}
                    >
                      {thread.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'interface' && (
        <div className="space-y-5 font-mono text-xs">
          <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-950/60 p-5">
            <div>
              <h2 className="text-sm font-medium uppercase tracking-wider text-white">
                [Typography scale]
              </h2>
              <p className="mt-0.5 text-zinc-400">
                Scales the base root font size for the whole interface.
              </p>
            </div>

            <div className="grid max-w-md grid-cols-3 gap-3 pt-2">
              {(['small', 'medium', 'large'] as const).map(scale => (
                <button
                  key={scale}
                  onClick={() => onUpdateSettings({ fontScale: scale })}
                  className={`cursor-pointer rounded-lg border p-3 text-center transition-colors ${
                    settings.fontScale === scale
                      ? 'border-zinc-500 bg-zinc-800 font-bold text-white'
                      : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-white'
                  }`}
                >
                  <span className="block capitalize">{scale}</span>
                  <span className="mt-0.5 block text-[10px] text-zinc-500">
                    {scale === 'small' ? '0.90×' : scale === 'medium' ? '1.00×' : '1.15×'}
                  </span>
                </button>
              ))}
            </div>

            <div className="space-x-2 pt-2 text-zinc-400">
              <span className="text-zinc-500">Preview:</span>
              <span className="font-smooch text-lg font-light">Smooch Sans body</span>
              <span className="text-zinc-600">/</span>
              <span className="font-megrim text-xl text-white">Megrim title</span>
            </div>
          </div>

          <div className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-950/60 p-5">
            <h2 className="text-sm font-medium uppercase tracking-wider text-white">[Behaviour]</h2>
            <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
              <span className="text-zinc-300">
                Validate every configured endpoint automatically on unlock
              </span>
              <input
                type="checkbox"
                checked={settings.autoValidateOnStartup}
                onChange={event =>
                  onUpdateSettings({ autoValidateOnStartup: event.target.checked })
                }
                className="h-4 w-4 cursor-pointer accent-zinc-300"
              />
            </label>
          </div>
        </div>
      )}

      {tab === 'about' && (
        <div className="space-y-5 font-mono text-xs">
          <div className="space-y-6 rounded-xl border border-zinc-800 bg-zinc-950/70 p-6 backdrop-blur-md">
            <div className="flex flex-col justify-between gap-4 border-b border-zinc-800 pb-6 sm:flex-row sm:items-center">
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-zinc-700 bg-zinc-900">
                  <span className="font-megrim text-3xl text-white">Q</span>
                </div>
                <div>
                  <div className="flex items-center gap-3">
                    <span className="font-megrim text-3xl tracking-widest text-white sm:text-4xl">
                      Qin
                    </span>
                    <span className="rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-xs text-zinc-300">
                      v{appVersion}
                    </span>
                  </div>
                  <p className="mt-0.5 text-sm text-zinc-400">
                    A local LLM API manager and request router.
                  </p>
                </div>
              </div>

              <button
                onClick={onTriggerSplash}
                className="cursor-pointer rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-1.5 text-zinc-200 transition-colors hover:border-zinc-500 hover:text-white"
              >
                [Replay splash]
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
                <span className="mb-1 block text-[11px] uppercase tracking-wider text-zinc-500">
                  Author
                </span>
                <div className="text-base font-medium text-white">Amon (amon1s)</div>
                <div className="mt-0.5 text-[11px] text-zinc-500">MIT licensed</div>
              </div>

              <div className="space-y-1 rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
                <span className="block text-[11px] uppercase tracking-wider text-zinc-500">
                  Repository
                </span>
                <button
                  onClick={() => openExternal('https://github.com/amon1s/qin')}
                  className="cursor-pointer text-left font-medium text-white underline-offset-2 hover:underline"
                >
                  github.com/amon1s/qin
                </button>
              </div>
            </div>

            <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
              <span className="block text-[11px] uppercase tracking-wider text-zinc-500">
                Vault
              </span>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-zinc-300">Storage location</span>
                <code className="break-all rounded border border-zinc-800 bg-black px-2 py-0.5 text-[11px] text-zinc-200">
                  {storageLocation}
                </code>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-zinc-300">Encryption</span>
                <span className="text-zinc-400">AES-GCM 256 · PBKDF2-SHA256 600,000</span>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-zinc-300">Key model</span>
                <span className="text-zinc-400">Random data key, wrapped twice</span>
              </div>
            </div>

            <div className="space-y-1.5 rounded-lg border border-zinc-800 bg-zinc-900/30 p-4 text-[11px] leading-relaxed text-zinc-400">
              <div>· Credentials never leave this machine; there is no telemetry.</div>
              <div>
                · The proxy listens on 127.0.0.1 only and requires a per-launch session token.
              </div>
              <div>
                · The recovery key unwraps the same data key as your password, so resetting the
                password keeps your stored keys.
              </div>
              <div>· SIL Open Font License: Megrim by Daniel Johnson, Smooch Sans by Google.</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SettingsPanel;
