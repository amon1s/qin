/**
 * Qin persistence layer.
 *
 * In the packaged app this writes JSON files under the Electron userData
 * directory (`~/.config/qin/`) through the preload bridge. In a plain browser
 * (`npm run dev` without Electron) it falls back to `localStorage` so the dev
 * server stays usable.
 *
 * The public API is synchronous: the cache is hydrated once by
 * `initStorage()` at boot, and writes are queued to the backend. That keeps
 * every existing call site simple while still landing on disk.
 */

export type StorageKey = 'vault' | 'vault_meta' | 'ledger' | 'settings';

interface QinBridge {
  config: {
    proxyPort: number;
    proxyToken: string;
    userDataPath: string;
    version: string;
  };
  storage: {
    get: (key: string) => Promise<unknown>;
    set: (key: string, value: unknown) => Promise<boolean>;
    remove: (key: string) => Promise<boolean>;
    keys: () => Promise<string[]>;
  };
  openExternal: (url: string) => Promise<boolean>;
}

declare global {
  interface Window {
    qin?: QinBridge;
  }
}

/** Key names used by the pre-1.1 `localStorage` implementation. */
const LEGACY_KEYS: Record<StorageKey, string> = {
  vault: 'qin_secure_vault_payload',
  vault_meta: 'qin_vault_meta',
  ledger: 'qin_token_ledger_v2',
  settings: 'qin_app_settings',
};

const ALL_KEYS = Object.keys(LEGACY_KEYS) as StorageKey[];

const cache = new Map<StorageKey, unknown>();
const pending = new Set<Promise<unknown>>();
let initialized = false;

export function bridge(): QinBridge | undefined {
  return typeof window !== 'undefined' ? window.qin : undefined;
}

export function storageBackend(): 'file' | 'localStorage' {
  return bridge() ? 'file' : 'localStorage';
}

/** Human-readable location, shown in the UI so storage is never a mystery. */
export function storageLocation(): string {
  const b = bridge();
  if (b?.config?.userDataPath) return b.config.userDataPath;
  return 'browser localStorage (dev mode)';
}

export function isInitialized(): boolean {
  return initialized;
}

function readLegacy(key: StorageKey): unknown {
  try {
    const raw = localStorage.getItem(LEGACY_KEYS[key]);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Hydrate the cache and, on first run after upgrading from the old
 * `localStorage` build, migrate anything that is still sitting there. Without
 * this an existing vault would look empty after the upgrade.
 */
export async function initStorage(): Promise<void> {
  if (initialized) return;
  const b = bridge();

  for (const key of ALL_KEYS) {
    let stored: unknown = null;
    if (b) {
      try {
        stored = await b.storage.get(key);
      } catch (err) {
        console.error(`[qin] could not read ${key} from disk:`, err);
      }
    }

    if (stored !== null && stored !== undefined) {
      cache.set(key, stored);
      continue;
    }

    const legacy = readLegacy(key);
    if (legacy !== null && legacy !== undefined) {
      cache.set(key, legacy);
      if (b) {
        // One-time migration; a failure here is not fatal, the cache still
        // holds the value for this session.
        const migration = b.storage
          .set(key, legacy)
          .catch(err => console.error(`[qin] migration of ${key} failed:`, err));
        pending.add(migration);
        migration.finally(() => pending.delete(migration));
      }
    }
  }

  initialized = true;
}

export function readKey<T>(key: StorageKey): T | null {
  if (!cache.has(key)) return null;
  return cache.get(key) as T;
}

export function writeKey(key: StorageKey, value: unknown): void {
  cache.set(key, value);
  const b = bridge();

  if (b) {
    const write = b.storage
      .set(key, value)
      .catch(err => console.error(`[qin] failed to persist ${key}:`, err));
    pending.add(write);
    write.finally(() => pending.delete(write));
    return;
  }

  try {
    localStorage.setItem(LEGACY_KEYS[key], JSON.stringify(value));
  } catch (err) {
    console.error(`[qin] failed to persist ${key}:`, err);
  }
}

export function removeKey(key: StorageKey): void {
  cache.delete(key);
  const b = bridge();

  if (b) {
    const removal = b.storage
      .remove(key)
      .catch(err => console.error(`[qin] failed to remove ${key}:`, err));
    pending.add(removal);
    removal.finally(() => pending.delete(removal));
    return;
  }

  try {
    localStorage.removeItem(LEGACY_KEYS[key]);
  } catch {
    // nothing useful to do
  }
}

/** Wait for queued writes to land. Used before closing/exporting. */
export async function flushStorage(): Promise<void> {
  await Promise.all([...pending]);
}
