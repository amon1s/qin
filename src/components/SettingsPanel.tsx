import React, { useState } from 'react';
import { AppSettings } from '../types';

interface SettingsPanelProps {
  settings: AppSettings;
  onUpdateSettings: (newSettings: Partial<AppSettings>) => void;
  onResetSettings: () => void;
  onTriggerSplash: () => void;
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  settings,
  onUpdateSettings,
  onResetSettings,
  onTriggerSplash,
}) => {
  const [activeTab, setActiveTab] = useState<'appearance' | 'interface' | 'about'>('appearance');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 p-5 rounded-xl border border-zinc-800 bg-zinc-950/70 backdrop-blur-md">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-light text-zinc-100 tracking-wide">
              Settings & Customization
            </h1>
            <span className="text-xs font-mono px-2 py-0.5 rounded bg-zinc-900 border border-zinc-700 text-zinc-300">
              Desktop Preferences
            </span>
          </div>
          <p className="text-sm text-zinc-400 mt-1">
            Configure dynamic glassmorphism backdrop blur, typography scaling, and environment metadata.
          </p>
        </div>

        <button
          onClick={onResetSettings}
          className="px-3 py-1.5 rounded-lg border border-zinc-800 hover:border-zinc-700 bg-zinc-900 text-xs font-mono text-zinc-400 hover:text-white transition-colors cursor-pointer"
        >
          [Reset Defaults]
        </button>
      </div>

      {/* Settings Tab Navigation (Text-First, Zero Icons) */}
      <div className="flex items-center gap-2 border-b border-zinc-800 pb-2 font-mono text-xs">
        <button
          onClick={() => setActiveTab('appearance')}
          className={`px-4 py-2 rounded-lg transition-colors cursor-pointer ${
            activeTab === 'appearance'
              ? 'bg-zinc-800 text-white font-medium border border-zinc-600'
              : 'text-zinc-400 hover:text-white'
          }`}
        >
          [Appearance]
        </button>

        <button
          onClick={() => setActiveTab('interface')}
          className={`px-4 py-2 rounded-lg transition-colors cursor-pointer ${
            activeTab === 'interface'
              ? 'bg-zinc-800 text-white font-medium border border-zinc-600'
              : 'text-zinc-400 hover:text-white'
          }`}
        >
          [Interface & Scale]
        </button>

        <button
          onClick={() => setActiveTab('about')}
          className={`px-4 py-2 rounded-lg transition-colors cursor-pointer ${
            activeTab === 'about'
              ? 'bg-zinc-800 text-white font-medium border border-zinc-600'
              : 'text-zinc-400 hover:text-white'
          }`}
        >
          [About Qin]
        </button>
      </div>

      {/* Tab 1: Appearance & Background Canvas Settings */}
      {activeTab === 'appearance' && (
        <div className="space-y-5 font-mono text-xs">
          {/* Functional Glassmorphism & Backdrop Blur */}
          <div className="p-5 rounded-xl border border-zinc-800 bg-zinc-950/60 space-y-4">
            <div>
              <h2 className="text-sm font-medium text-white uppercase tracking-wider">
                [Glassmorphism Backdrop Blur Engine]
              </h2>
              <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                Actively updates panel CSS backdrop-filter blur dynamically across all containers without breaking layout or rendering.
              </p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-xl pt-1">
              {[
                { id: 'none', label: 'Crisp (0px)', desc: 'Zero blur, pure translucency' },
                { id: 'sm', label: 'SM Blur (4px)', desc: 'Soft subtle blur' },
                { id: 'md', label: 'MD Blur (12px)', desc: 'Balanced frosted glass' },
                { id: 'xl', label: 'XL Blur (28px)', desc: 'Heavy diffusion' },
              ].map(item => (
                <button
                  key={item.id}
                  onClick={() => onUpdateSettings({ blurIntensity: item.id as AppSettings['blurIntensity'] })}
                  className={`p-3 rounded-lg border text-left transition-all duration-150 cursor-pointer ${
                    settings.blurIntensity === item.id
                      ? 'border-zinc-400 bg-zinc-800 text-white font-bold shadow-[0_0_12px_rgba(255,255,255,0.08)]'
                      : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-white hover:border-zinc-700'
                  }`}
                >
                  <span className="block text-white font-medium mb-0.5">{item.label}</span>
                  <span className="text-[10px] text-zinc-500 font-normal block leading-tight">{item.desc}</span>
                </button>
              ))}
            </div>

            {/* Live Interactive Blur Tester Box */}
            <div className="p-4 rounded-lg border border-zinc-800 bg-zinc-900/40 backdrop-blur-md space-y-1">
              <span className="text-zinc-500 text-[11px] block uppercase tracking-wider">
                Live Backdrop Filter Verification:
              </span>
              <p className="text-zinc-300 text-xs">
                Active CSS Value: <code className="text-white bg-black px-1.5 py-0.5 rounded border border-zinc-800">
                  backdrop-filter: {settings.blurIntensity === 'none' ? 'none' : `blur(${settings.blurIntensity === 'sm' ? '4px' : settings.blurIntensity === 'md' ? '12px' : '28px'})`}
                </code>
              </p>
            </div>
          </div>

          {/* Background Canvas & GhostFibers Manipulation Engine */}
          <div className="p-5 rounded-xl border border-zinc-800 bg-zinc-950/60 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-800/80 pb-3">
              <div>
                <h2 className="text-sm font-medium text-white uppercase tracking-wider">
                  [GhostFibers WebGL Canvas Engine]
                </h2>
                <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                  Real-time manipulation of WebGL ribbon shaders, twist deformation, dynamic opacity, and color palettes.
                </p>
              </div>

              <button
                onClick={() =>
                  onUpdateSettings({
                    fiberOpacity: 0.75,
                    fiberSpeed: 1.2,
                    fiberTwist: 1.2,
                    fiberGlowColor: '#d4d4d8',
                    fiberSecondaryColor: '#71717a',
                    fiberStyle: 'dots',
                    fiberThreads: 72,
                    fiberLayers: 3,
                  })
                }
                className="px-2.5 py-1 rounded border border-zinc-800 hover:border-zinc-700 bg-zinc-900 text-[11px] text-zinc-400 hover:text-white transition-colors cursor-pointer self-start sm:self-auto"
              >
                [Reset Canvas to Default]
              </button>
            </div>

            {/* 1. Background Opacity */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-zinc-200 font-medium">Background Canvas Opacity</span>
                <span className="text-white font-mono bg-zinc-900 px-2 py-0.5 rounded border border-zinc-800">
                  {Math.round(settings.fiberOpacity * 100)}%
                </span>
              </div>
              <input
                type="range"
                min="0.05"
                max="1.0"
                step="0.05"
                value={settings.fiberOpacity}
                onChange={e => onUpdateSettings({ fiberOpacity: parseFloat(e.target.value) })}
                className="w-full accent-zinc-300 bg-zinc-800 h-1.5 rounded cursor-pointer"
              />
              <div className="flex items-center gap-2 pt-1">
                {[
                  { label: 'Dim (25%)', val: 0.25 },
                  { label: 'Subtle (50%)', val: 0.5 },
                  { label: 'Standard (75%)', val: 0.75 },
                  { label: 'Vivid (100%)', val: 1.0 },
                ].map(p => (
                  <button
                    key={p.val}
                    onClick={() => onUpdateSettings({ fiberOpacity: p.val })}
                    className={`px-2 py-1 rounded text-[10px] border transition-colors cursor-pointer ${
                      Math.abs(settings.fiberOpacity - p.val) < 0.01
                        ? 'border-zinc-400 bg-zinc-800 text-white font-bold'
                        : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-white'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 2. Twist & Deformation */}
            <div className="space-y-2 pt-2 border-t border-zinc-900">
              <div className="flex items-center justify-between">
                <span className="text-zinc-200 font-medium">Fiber Twist & Ribbon Curvature</span>
                <span className="text-white font-mono bg-zinc-900 px-2 py-0.5 rounded border border-zinc-800">
                  {settings.fiberTwist.toFixed(1)}x
                </span>
              </div>
              <input
                type="range"
                min="0.0"
                max="3.0"
                step="0.1"
                value={settings.fiberTwist}
                onChange={e => onUpdateSettings({ fiberTwist: parseFloat(e.target.value) })}
                className="w-full accent-zinc-300 bg-zinc-800 h-1.5 rounded cursor-pointer"
              />
              <div className="flex items-center gap-2 pt-1 flex-wrap">
                {[
                  { label: 'Linear (0.0x)', val: 0.0 },
                  { label: 'Gentle (0.6x)', val: 0.6 },
                  { label: 'Default (1.2x)', val: 1.2 },
                  { label: 'Dynamic (2.0x)', val: 2.0 },
                  { label: 'Vortex (3.0x)', val: 3.0 },
                ].map(p => (
                  <button
                    key={p.val}
                    onClick={() => onUpdateSettings({ fiberTwist: p.val })}
                    className={`px-2 py-1 rounded text-[10px] border transition-colors cursor-pointer ${
                      Math.abs(settings.fiberTwist - p.val) < 0.05
                        ? 'border-zinc-400 bg-zinc-800 text-white font-bold'
                        : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-white'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 3. Animation Speed */}
            <div className="space-y-2 pt-2 border-t border-zinc-900">
              <div className="flex items-center justify-between">
                <span className="text-zinc-200 font-medium">Flow Rate & Oscillation Speed</span>
                <span className="text-white font-mono bg-zinc-900 px-2 py-0.5 rounded border border-zinc-800">
                  {settings.fiberSpeed.toFixed(1)}x
                </span>
              </div>
              <input
                type="range"
                min="0.1"
                max="3.0"
                step="0.1"
                value={settings.fiberSpeed}
                onChange={e => onUpdateSettings({ fiberSpeed: parseFloat(e.target.value) })}
                className="w-full accent-zinc-300 bg-zinc-800 h-1.5 rounded cursor-pointer"
              />
              <div className="flex items-center gap-2 pt-1">
                {[
                  { label: 'Glacial (0.3x)', val: 0.3 },
                  { label: 'Relaxed (0.8x)', val: 0.8 },
                  { label: 'Default (1.2x)', val: 1.2 },
                  { label: 'Rapid (2.2x)', val: 2.2 },
                ].map(p => (
                  <button
                    key={p.val}
                    onClick={() => onUpdateSettings({ fiberSpeed: p.val })}
                    className={`px-2 py-1 rounded text-[10px] border transition-colors cursor-pointer ${
                      Math.abs(settings.fiberSpeed - p.val) < 0.05
                        ? 'border-zinc-400 bg-zinc-800 text-white font-bold'
                        : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-white'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 4. Color Manipulation & Palettes here and uhhh i think thats it */}
            <div className="space-y-3 pt-2 border-t border-zinc-900">
              <span className="text-zinc-200 font-medium block">Color Manipulation & Shading</span>

              {/* Preset Palettes */}
              <div className="space-y-1.5">
                <span className="text-[11px] text-zinc-400">Quick Palette Presets:</span>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {[
                    { label: 'Slate & Monochrome', glow: '#d4d4d8', secondary: '#71717a' },
                    { label: 'Ethereal Violet', glow: '#8b5cf6', secondary: '#ffffff' },
                    { label: 'Cyan Plasma', glow: '#38bdf8', secondary: '#bae6fd' },
                    { label: 'Emerald Aurora', glow: '#34d399', secondary: '#a7f3d0' },
                    { label: 'Minimal White', glow: '#ffffff', secondary: '#a1a1aa' },
                    { label: 'Amber Solar', glow: '#f59e0b', secondary: '#fef3c7' },
                  ].map(pal => {
                    const isSelected =
                      settings.fiberGlowColor.toLowerCase() === pal.glow.toLowerCase() &&
                      settings.fiberSecondaryColor.toLowerCase() === pal.secondary.toLowerCase();
                    return (
                      <button
                        key={pal.label}
                        onClick={() =>
                          onUpdateSettings({
                            fiberGlowColor: pal.glow,
                            fiberSecondaryColor: pal.secondary,
                          })
                        }
                        className={`p-2 rounded-lg border text-left flex items-center justify-between transition-colors cursor-pointer ${
                          isSelected
                            ? 'border-zinc-400 bg-zinc-800 text-white font-bold'
                            : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-white'
                        }`}
                      >
                        <span className="text-[11px]">{pal.label}</span>
                        <div className="flex items-center gap-1">
                          <span
                            className="w-3 h-3 rounded-full border border-zinc-700"
                            style={{ backgroundColor: pal.glow }}
                          />
                          <span
                            className="w-3 h-3 rounded-full border border-zinc-700"
                            style={{ backgroundColor: pal.secondary }}
                          />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Custom Hex / Color Pickers */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <div className="p-3 rounded-lg border border-zinc-800 bg-zinc-900/50 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-zinc-300">Glow / Primary Color</span>
                    <span className="text-[10px] text-zinc-400 font-mono">{settings.fiberGlowColor}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={settings.fiberGlowColor}
                      onChange={e => onUpdateSettings({ fiberGlowColor: e.target.value })}
                      className="w-8 h-8 rounded border border-zinc-700 bg-transparent cursor-pointer"
                    />
                    <input
                      type="text"
                      value={settings.fiberGlowColor}
                      onChange={e => onUpdateSettings({ fiberGlowColor: e.target.value })}
                      className="flex-1 px-2.5 py-1 rounded bg-zinc-950 border border-zinc-800 text-white font-mono text-xs focus:outline-none focus:border-zinc-500"
                      placeholder="#d4d4d8"
                    />
                  </div>
                </div>

                <div className="p-3 rounded-lg border border-zinc-800 bg-zinc-900/50 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-zinc-300">Secondary / Wave Color</span>
                    <span className="text-[10px] text-zinc-400 font-mono">{settings.fiberSecondaryColor}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={settings.fiberSecondaryColor}
                      onChange={e => onUpdateSettings({ fiberSecondaryColor: e.target.value })}
                      className="w-8 h-8 rounded border border-zinc-700 bg-transparent cursor-pointer"
                    />
                    <input
                      type="text"
                      value={settings.fiberSecondaryColor}
                      onChange={e => onUpdateSettings({ fiberSecondaryColor: e.target.value })}
                      className="flex-1 px-2.5 py-1 rounded bg-zinc-950 border border-zinc-800 text-white font-mono text-xs focus:outline-none focus:border-zinc-500"
                      placeholder="#71717a"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* 5. Geometry Style & Complexity */}
            <div className="space-y-3 pt-2 border-t border-zinc-900">
              <span className="text-zinc-200 font-medium block">Fiber Style & Geometry Density</span>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* Fiber Style */}
                <div className="space-y-1.5">
                  <span className="text-[11px] text-zinc-400">Fiber Drawing Style:</span>
                  <div className="grid grid-cols-3 gap-1">
                    {(['dots', 'dashes', 'lines'] as const).map(style => (
                      <button
                        key={style}
                        onClick={() => onUpdateSettings({ fiberStyle: style })}
                        className={`py-1.5 px-2 rounded border text-center uppercase text-[10px] transition-colors cursor-pointer ${
                          (settings.fiberStyle || 'dots') === style
                            ? 'border-zinc-400 bg-zinc-800 text-white font-bold'
                            : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-white'
                        }`}
                      >
                        {style}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Layers Count */}
                <div className="space-y-1.5">
                  <span className="text-[11px] text-zinc-400">Shader Ribbon Layers:</span>
                  <div className="grid grid-cols-3 gap-1">
                    {[1, 2, 3].map(layer => (
                      <button
                        key={layer}
                        onClick={() => onUpdateSettings({ fiberLayers: layer })}
                        className={`py-1.5 px-2 rounded border text-center text-[10px] transition-colors cursor-pointer ${
                          (settings.fiberLayers || 3) === layer
                            ? 'border-zinc-400 bg-zinc-800 text-white font-bold'
                            : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-white'
                        }`}
                      >
                        {layer} {layer === 1 ? 'Layer' : 'Layers'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Threads Count */}
                <div className="space-y-1.5">
                  <span className="text-[11px] text-zinc-400">Thread Count Density:</span>
                  <div className="grid grid-cols-3 gap-1">
                    {[
                      { label: '36 Thin', val: 36 },
                      { label: '72 Std', val: 72 },
                      { label: '108 Full', val: 108 },
                    ].map(thread => (
                      <button
                        key={thread.val}
                        onClick={() => onUpdateSettings({ fiberThreads: thread.val })}
                        className={`py-1.5 px-2 rounded border text-center text-[10px] transition-colors cursor-pointer ${
                          (settings.fiberThreads || 72) === thread.val
                            ? 'border-zinc-400 bg-zinc-800 text-white font-bold'
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
        </div>
      )}

      {/* Tab 2: Interface & Typography */}
      {activeTab === 'interface' && (
        <div className="space-y-5 font-mono text-xs">
          {/* Typography Scale */}
          <div className="p-5 rounded-xl border border-zinc-800 bg-zinc-950/60 space-y-3">
            <div>
              <h2 className="text-sm font-medium text-white uppercase tracking-wider">
                [Typography Scale / Text Resizing]
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                Dynamically updates base REM scale across the entire application interface.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-3 max-w-md pt-2">
              {(['small', 'medium', 'large'] as const).map(scale => (
                <button
                  key={scale}
                  onClick={() => onUpdateSettings({ fontScale: scale })}
                  className={`p-3 rounded-lg border text-center transition-colors cursor-pointer ${
                    settings.fontScale === scale
                      ? 'border-zinc-500 bg-zinc-800 text-white font-bold'
                      : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-white'
                  }`}
                >
                  <span className="capitalize block">{scale}</span>
                  <span className="text-[10px] text-zinc-500 mt-0.5 block">
                    {scale === 'small' ? '0.90x rem' : scale === 'medium' ? '1.00x (Default)' : '1.15x rem'}
                  </span>
                </button>
              ))}
            </div>

            <div className="pt-2 text-zinc-400 space-x-2">
              <span className="text-zinc-500">Preview:</span>
              <span className="font-smooch text-lg font-light">Smooch Sans Light Body</span>
              <span className="text-zinc-600">/</span>
              <span className="font-megrim text-xl text-white">Megrim Title</span>
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: About Sectionn */}
      {activeTab === 'about' && (
        <div className="space-y-5 font-mono text-xs">
          <div className="p-6 rounded-xl border border-zinc-800 bg-zinc-950/70 backdrop-blur-md space-y-6">
            {/* Branding block */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-6 border-b border-zinc-800">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-xl bg-zinc-900 border border-zinc-700 flex items-center justify-center">
                  <span className="font-megrim text-3xl text-white">Q</span>
                </div>
                <div>
                  <div className="flex items-center gap-3">
                    <span className="font-megrim text-3xl sm:text-4xl text-white tracking-widest">
                      Qin
                    </span>
                    <span className="px-2 py-0.5 rounded bg-zinc-900 border border-zinc-700 text-xs text-zinc-300">
                      v1.0.0
                    </span>
                  </div>
                  <p className="text-sm text-zinc-400 mt-0.5">
                    Your Universal LLM API manager and handler.
                  </p>
                </div>
              </div>

              <button
                onClick={onTriggerSplash}
                className="px-3.5 py-1.5 rounded-lg border border-zinc-700 hover:border-zinc-500 bg-zinc-900 text-zinc-200 hover:text-white transition-colors cursor-pointer"
              >
                [Replay Splash Intro]
              </button>
            </div>

            {/* Arch / Wayland Environment Optimization Badge do i needa add ts */}
            <div className="p-4 rounded-lg border border-zinc-800 bg-zinc-900/60 space-y-1">
              <div className="text-white font-medium text-sm">
                Optimized for ArchLinux / Wayland
              </div>
              <p className="text-zinc-400 text-xs leading-relaxed">
                Native Hyprland tiling compatibility, low memory footprint, zero electron bloat, and offline AES-GCM keystore integration.
              </p>
            </div>

            {/* Developer Credit & GitHub Integration heree */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Exact developer credit heading: Developed by amon1s i think? what else */}
              <div className="p-4 rounded-lg border border-zinc-800 bg-zinc-900/40">
                <span className="text-zinc-500 block mb-1 text-[11px] uppercase tracking-wider">
                  AUTHOR
                </span>
                <div className="text-base font-medium text-white">
                  Developed by amon1s
                </div>
              </div>

              {/* GitHub Integration: explicitly amon1s/qin and https://github.com/amon1s/qin */}
              <div className="p-4 rounded-lg border border-zinc-800 bg-zinc-900/40 space-y-1">
                <span className="text-zinc-500 block text-[11px] uppercase tracking-wider">
                  REPOSITORY
                </span>
                <div className="flex items-center justify-between">
                  <span className="text-white font-medium">amon1s/qin</span>
                  <a
                    href="https://github.com/amon1s/qin"
                    target="_blank"
                    rel="noreferrer"
                    className="text-zinc-300 hover:text-white hover:underline transition-colors cursor-pointer"
                  >
                    github.com/amon1s/qin
                  </a>
                </div>
              </div>
            </div>

            {/* Cryptography and License info */}
            <div className="p-4 rounded-lg border border-zinc-800 bg-zinc-900/30 text-[11px] text-zinc-400 space-y-1 leading-relaxed">
              <div>· Zero Remote Telemetry: All credentials remain locally encrypted via AES-GCM (256-bit).</div>
              <div>· Emergency Recovery Key: 12-character high-entropy passkey for unsealing in case of forgotten password.</div>
              <div>· SIL Open Font License: Megrim by Daniel Johnson and Smooch Sans by Google Fonts Authors.</div>
              <div> Developed by amon1s/ (Amon).</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SettingsPanel;
