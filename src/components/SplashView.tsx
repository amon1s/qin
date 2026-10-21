import React, { useState, useEffect } from 'react';
import SplitText from './SplitText';
import { generateEmergencyRecoveryKey } from '../services/crypto';

interface SplashViewProps {
  hasInitializedVault: boolean;
  isVaultLocked: boolean;
  onInitializeVault: (masterPassword: string, recoveryKey: string) => Promise<boolean>;
  onUnlockVault: (masterPassword: string) => Promise<boolean>;
  onRecoverVault: (recoveryKey: string, newPassword: string) => Promise<boolean>;
  onEnterApp: () => void;
}

export const SplashView: React.FC<SplashViewProps> = ({
  hasInitializedVault,
  isVaultLocked,
  onInitializeVault,
  onUnlockVault,
  onRecoverVault,
  onEnterApp,
}) => {
  // Phase 0 = Intro letter animation, Phase 1 = Auth prompt (Setup / Unlock / Recover)
  const [phase, setPhase] = useState<'intro' | 'auth'>(() => {
    // If vault is locked or uninitialized and user previously passed intro, go to auth
    return 'intro';
  });

  const [animationFinished, setAnimationFinished] = useState(false);

  // Setup form state
  const [setupPassword, setSetupPassword] = useState('');
  const [setupConfirm, setSetupConfirm] = useState('');
  const [recoveryKey, setRecoveryKey] = useState('');
  const [setupError, setSetupError] = useState('');
  const [hasCopiedRecovery, setHasCopiedRecovery] = useState(false);

  // Unlock form state
  const [unlockPassword, setUnlockPassword] = useState('');
  const [unlockError, setUnlockError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Recovery mode state
  const [isRecoveryMode, setIsRecoveryMode] = useState(false);
  const [inputRecoveryKey, setInputRecoveryKey] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [recoveryError, setRecoveryError] = useState('');

  // Generate 12-char emergency recovery key on mount
  useEffect(() => {
    if (!hasInitializedVault) {
      setRecoveryKey(generateEmergencyRecoveryKey());
    }
  }, [hasInitializedVault]);

  const handleProceedFromIntro = () => {
    if (!hasInitializedVault || isVaultLocked) {
      setPhase('auth');
    } else {
      onEnterApp();
    }
  };

  const handleSetupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!setupPassword) {
      setSetupError('Please enter a master password.');
      return;
    }
    if (setupPassword.length < 6) {
      setSetupError('Password should be at least 6 characters.');
      return;
    }
    if (setupPassword !== setupConfirm) {
      setSetupError('Passwords do not match.');
      return;
    }

    setIsSubmitting(true);
    setSetupError('');
    const success = await onInitializeVault(setupPassword, recoveryKey);
    setIsSubmitting(false);

    if (success) {
      onEnterApp();
    } else {
      setSetupError('Failed to initialize cryptographic vault.');
    }
  };

  const handleUnlockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!unlockPassword) return;

    setIsSubmitting(true);
    setUnlockError('');
    const success = await onUnlockVault(unlockPassword);
    setIsSubmitting(false);

    if (success) {
      onEnterApp();
    } else {
      setUnlockError('Incorrect master password.');
    }
  };

  const handleRecoverySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputRecoveryKey || !newPassword) {
      setRecoveryError('Please fill in both recovery key and new password.');
      return;
    }
    if (newPassword.length < 6) {
      setRecoveryError('New password must be at least 6 characters.');
      return;
    }

    setIsSubmitting(true);
    setRecoveryError('');
    const success = await onRecoverVault(inputRecoveryKey.trim(), newPassword);
    setIsSubmitting(false);

    if (success) {
      onEnterApp();
    } else {
      setRecoveryError('Invalid recovery key.');
    }
  };

  const handleCopyRecoveryKey = () => {
    navigator.clipboard.writeText(recoveryKey);
    setHasCopiedRecovery(true);
    setTimeout(() => setHasCopiedRecovery(false), 2500);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-between p-6 sm:p-10 md:p-14 select-none bg-black/60 backdrop-blur-[2px] text-zinc-100">
      {/* Top Bar: Clean left area (no arch/hypr tag), Megrim "Qin" logo on top-right */}
      <div className="flex items-center justify-between w-full">
        <div className="flex items-center gap-2 text-xs font-mono text-zinc-400">
          <span className="tracking-widest uppercase">Qin API Manager</span>
        </div>

        {/* Top-Right Logo: "Qin" in Megrim font (No purple glow, monochrome crisp silver) */}
        <div className="flex items-center gap-2">
          <span className="font-megrim text-4xl sm:text-5xl md:text-6xl text-white tracking-widest leading-none drop-shadow-[0_0_20px_rgba(255,255,255,0.45)]">
            Qin
          </span>
        </div>
      </div>

      {/* Main Center Stage */}
      <div className="flex flex-col items-center justify-center my-auto text-center max-w-2xl mx-auto w-full px-4">
        {phase === 'intro' ? (
          <div
            onClick={handleProceedFromIntro}
            className="cursor-pointer flex flex-col items-center w-full"
          >
            {/* SplitText mission statement */}
            <div className="py-4">
              <SplitText
                text="Your Universal LLM API manager and handler."
                className="text-3xl sm:text-4xl md:text-5xl font-light tracking-wide text-zinc-100 max-w-2xl"
                effect="flip"
                splitType="chars"
                delay={30}
                duration={1.05}
                staggerFrom="start"
                textAlign="center"
                onLetterAnimationComplete={() => setAnimationFinished(true)}
              />
            </div>

            {/* Low-opacity, pulsating text: click anywhere to continue */}
            <div
              className={`mt-10 flex flex-col items-center gap-2 transition-opacity duration-1000 ${
                animationFinished ? 'opacity-100' : 'opacity-40'
              }`}
            >
              <span className="text-sm sm:text-base tracking-widest text-zinc-300 font-mono animate-pulse-glow">
                click anywhere to continue
              </span>
            </div>
          </div>
        ) : (
          /* Phase === 'auth': Master Password Authentication & Registration */
          <div className="w-full max-w-lg p-6 sm:p-8 rounded-xl border border-zinc-800 bg-zinc-950/90 text-left font-mono animate-slidefadein shadow-2xl">
            {!hasInitializedVault ? (
              /* First-time Master Password Setup */
              <form onSubmit={handleSetupSubmit} className="space-y-4">
                <div>
                  <span className="text-xs uppercase tracking-widest text-zinc-400 block mb-1">
                    [First-Time Vault Setup]
                  </span>
                  <h2 className="text-xl font-light text-white tracking-wide">
                    Set Master Encryption Password
                  </h2>
                  <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                    Set a master password to seal and encrypt all your API keys locally using AES-GCM 256-bit cryptography.
                  </p>
                </div>

                {/* Emergency Recovery Key Display */}
                <div className="p-3.5 rounded-lg border border-zinc-700 bg-zinc-900/90 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-zinc-400 font-bold uppercase tracking-wider">
                      Emergency Recovery Key:
                    </span>
                    <button
                      type="button"
                      onClick={handleCopyRecoveryKey}
                      className="text-[11px] px-2 py-0.5 rounded border border-zinc-700 bg-zinc-800 text-zinc-200 hover:text-white transition-colors cursor-pointer"
                    >
                      {hasCopiedRecovery ? '[Copied]' : '[Copy Key]'}
                    </button>
                  </div>

                  <div className="p-2.5 rounded border border-zinc-800 bg-black text-center text-sm font-mono tracking-widest text-white select-all">
                    {recoveryKey}
                  </div>

                  {/* Mandatory exact warning notice */}
                  <p className="text-[11px] text-zinc-300 leading-relaxed pt-1">
                    "Please write down this key in real life and store it somewhere safe. This key will be required in case you forget your password, otherwise you won't be able to access your APIs."
                  </p>
                </div>

                <div className="space-y-2.5 pt-1 text-xs">
                  <div>
                    <label className="block text-zinc-400 mb-1">Master Password</label>
                    <input
                      type="password"
                      placeholder="Enter master password..."
                      value={setupPassword}
                      onChange={e => setSetupPassword(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-zinc-800 bg-zinc-900 text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-400"
                      autoFocus
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-zinc-400 mb-1">Confirm Master Password</label>
                    <input
                      type="password"
                      placeholder="Repeat master password..."
                      value={setupConfirm}
                      onChange={e => setSetupConfirm(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-zinc-800 bg-zinc-900 text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-400"
                      required
                    />
                  </div>
                </div>

                {setupError && (
                  <p className="text-xs text-rose-400">{setupError}</p>
                )}

                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full py-2.5 rounded-lg bg-zinc-200 hover:bg-white text-zinc-950 font-bold tracking-wide transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {isSubmitting ? 'Encrypting & Initializing...' : '[Initialize Secure Vault]'}
                  </button>
                </div>
              </form>
            ) : isRecoveryMode ? (
              /* Emergency Recovery Mode */
              <form onSubmit={handleRecoverySubmit} className="space-y-4">
                <div>
                  <span className="text-xs uppercase tracking-widest text-zinc-400 block mb-1">
                    [Emergency Vault Recovery]
                  </span>
                  <h2 className="text-xl font-light text-white tracking-wide">
                    Recover Keystore with 12-Char Key
                  </h2>
                  <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                    Enter the 12-character emergency key generated during setup to reset your master password.
                  </p>
                </div>

                <div className="space-y-2.5 text-xs">
                  <div>
                    <label className="block text-zinc-400 mb-1">12-Character Recovery Key</label>
                    <input
                      type="text"
                      placeholder="Paste 12-character emergency key..."
                      value={inputRecoveryKey}
                      onChange={e => setInputRecoveryKey(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-zinc-800 bg-zinc-900 text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-400"
                      autoFocus
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-zinc-400 mb-1">New Master Password</label>
                    <input
                      type="password"
                      placeholder="Enter new master password..."
                      value={newPassword}
                      onChange={e => setNewPassword(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-zinc-800 bg-zinc-900 text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-400"
                      required
                    />
                  </div>
                </div>

                {recoveryError && (
                  <p className="text-xs text-rose-400">{recoveryError}</p>
                )}

                <div className="pt-2 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsRecoveryMode(false);
                      setRecoveryError('');
                    }}
                    className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
                  >
                    [Back to Password Login]
                  </button>

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-5 py-2.5 rounded-lg bg-zinc-200 hover:bg-white text-zinc-950 font-bold transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {isSubmitting ? 'Recovering...' : '[Reset Password & Unseal]'}
                  </button>
                </div>
              </form>
            ) : (
              /* Regular Login & Session Unlock */
              <form onSubmit={handleUnlockSubmit} className="space-y-4">
                <div>
                  <span className="text-xs uppercase tracking-widest text-zinc-400 block mb-1">
                    [Encrypted Session Lock]
                  </span>
                  <h2 className="text-xl font-light text-white tracking-wide">
                    Enter Master Password
                  </h2>
                  <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                    Unseal your encrypted AES-GCM local keystore to access API keys and trigger discovery.
                  </p>
                </div>

                <div className="text-xs">
                  <label className="block text-zinc-400 mb-1">Master Password</label>
                  <input
                    type="password"
                    placeholder="Enter master password..."
                    value={unlockPassword}
                    onChange={e => setUnlockPassword(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-zinc-800 bg-zinc-900 text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-400"
                    autoFocus
                    required
                  />
                </div>

                {unlockError && (
                  <p className="text-xs text-rose-400">{unlockError}</p>
                )}

                <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setIsRecoveryMode(true);
                      setUnlockError('');
                    }}
                    className="text-xs text-zinc-400 hover:text-white underline transition-colors cursor-pointer"
                  >
                    [Forgot Password? Use Recovery Key]
                  </button>

                  <button
                    type="submit"
                    disabled={isSubmitting || !unlockPassword}
                    className="w-full sm:w-auto px-6 py-2.5 rounded-lg bg-zinc-200 hover:bg-white text-zinc-950 font-bold transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {isSubmitting ? 'Verifying...' : '[Unseal Vault]'}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>

      {/* Bottom bar on Splash: Clean, minimal status only (removed bottom right text) */}
      <div className="flex items-center justify-between text-xs text-zinc-400 font-mono">
        <div>
          <span>Qin v1.0.0</span>
        </div>
        <div className="text-right">
          <span>{hasInitializedVault ? 'AES-256 Vault Initialized' : 'Vault Ready for Setup'}</span>
        </div>
      </div>
    </div>
  );
};

export default SplashView;
