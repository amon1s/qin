/**
 * Qin — local cryptographic vault.
 *
 * Architecture (payload v3):
 *
 *   data key  (random 32 bytes)  ──AES-GCM──▶  vault body (providers + keys)
 *        │
 *        ├── wrapped with PBKDF2(master password, 600k)   → payload.salt/iv/ciphertext
 *        └── wrapped with PBKDF2(recovery key,   600k)   → payload.recovery
 *
 * Wrapping the data key twice is what makes the recovery key actually work.
 * The previous build encrypted the vault directly with the password and then
 * "recovered" by re-encrypting whatever providers happened to be in memory —
 * which, while locked, is an empty list. Forgetting your password therefore
 * destroyed every stored key. With a wrapped data key, the recovery key unwraps
 * the same data key and the body is never re-encrypted from memory.
 *
 * The master password is never stored or hashed: correctness is proven by GCM
 * authentication when unwrapping the data key.
 *
 * Legacy payloads (v1/v2, encrypted directly with the password at 100k
 * iterations) still open and are migrated to v3 on the next successful unlock.
 */

import { readKey, writeKey, removeKey } from './storage';

export const PBKDF2_ITERATIONS = 600_000;
/** Iteration count used by the pre-1.1 build. Kept so old vaults still open. */
export const LEGACY_ITERATIONS = 100_000;
export const KDF_VERSION = 3;

const AES_KEY_LENGTH = 256;
const RAW_KEY_BYTES = 32;
const SALT_BYTES = 16;
const IV_BYTES = 12;

/* --------------------------------------------------------------- base64 I/O */

export function arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  // Chunked: spreading a large vault into `fromCharCode` blows the argument
  // limit, and appending one character at a time is quadratic.
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function base64ToBytes(base64: string): Uint8Array {
  return new Uint8Array(base64ToArrayBuffer(base64));
}

/**
 * TypeScript 7 distinguishes `Uint8Array<ArrayBufferLike>` from `BufferSource`,
 * which `crypto.subtle` expects. The runtime value is always a plain view.
 */
const asBufferSource = (bytes: Uint8Array): BufferSource => bytes as unknown as BufferSource;

/** Single-round SHA-256. Retained only to verify legacy recovery keys. */
export async function hashString(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return arrayBufferToBase64(hashBuffer);
}

/* --------------------------------------------------------------- primitives */

async function deriveAesKey(
  secret: string,
  salt: Uint8Array,
  iterations: number
): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: AES_KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  );
}

async function importDataKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw as unknown as BufferSource, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
}

export interface WrappedKey {
  salt: string;
  iv: string;
  ciphertext: string;
  iterations: number;
}

/** Wrap a raw data key under a secret-derived KEK. */
async function wrapKeyWithSecret(
  secret: string,
  rawDataKey: Uint8Array,
  iterations = PBKDF2_ITERATIONS
): Promise<WrappedKey> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const kek = await deriveAesKey(secret, salt, iterations);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: asBufferSource(iv) },
    kek,
    rawDataKey as unknown as BufferSource
  );

  return {
    salt: arrayBufferToBase64(salt),
    iv: arrayBufferToBase64(iv),
    ciphertext: arrayBufferToBase64(ciphertext),
    iterations,
  };
}

/** Unwrap a data key. Returns null for a wrong secret or corrupt wrap. */
async function unwrapKeyWithSecret(secret: string, wrapped: WrappedKey): Promise<Uint8Array | null> {
  try {
    const kek = await deriveAesKey(secret, base64ToBytes(wrapped.salt), wrapped.iterations);
    const raw = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: asBufferSource(base64ToBytes(wrapped.iv)) },
      kek,
      base64ToArrayBuffer(wrapped.ciphertext)
    );
    return new Uint8Array(raw);
  } catch {
    return null;
  }
}

async function sealBody(
  dataKey: CryptoKey,
  plaintext: string
): Promise<{ iv: string; ciphertext: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: asBufferSource(iv) },
    dataKey,
    new TextEncoder().encode(plaintext) as unknown as BufferSource
  );
  return { iv: arrayBufferToBase64(iv), ciphertext: arrayBufferToBase64(ciphertext) };
}

async function openBody(
  dataKey: CryptoKey,
  body: { iv: string; ciphertext: string }
): Promise<string | null> {
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: asBufferSource(base64ToBytes(body.iv)) },
      dataKey,
      base64ToArrayBuffer(body.ciphertext)
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    return null;
  }
}

/* ----------------------------------------------------------------- recovery */

const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*+?';
const RECOVERY_LENGTH = 12;

/**
 * 12-character emergency recovery key (~73 bits). Rejection sampling rather
 * than `random % length`, so no character is favoured.
 */
export function generateEmergencyRecoveryKey(): string {
  const alphabetLength = RECOVERY_ALPHABET.length;
  const limit = Math.floor(0x100000000 / alphabetLength) * alphabetLength;
  const buffer = new Uint32Array(1);
  let result = '';
  while (result.length < RECOVERY_LENGTH) {
    crypto.getRandomValues(buffer);
    if (buffer[0] >= limit) continue;
    result += RECOVERY_ALPHABET[buffer[0] % alphabetLength];
  }
  return result;
}

/* ------------------------------------------------------------------ payload */

export interface EncryptedPayload {
  v: number;
  /** Password-wrapped data key (v3) or directly-encrypted body (v1/v2). */
  salt: string;
  iv: string;
  ciphertext: string;
  iterations?: number;
  /** v3+: the vault body, encrypted under the data key. */
  data?: { iv: string; ciphertext: string };
  /** v3+: the same data key, wrapped under the recovery key. */
  recovery?: WrappedKey;
}

export function payloadIterations(payload: EncryptedPayload): number {
  return payload.iterations ?? LEGACY_ITERATIONS;
}

/** True when the payload predates the wrapped-data-key format or a weaker KDF. */
export function needsUpgrade(payload: EncryptedPayload): boolean {
  return (payload.v ?? 1) < KDF_VERSION || payloadIterations(payload) < PBKDF2_ITERATIONS;
}

export interface UnlockedVault {
  plaintext: string;
  /** Null only for legacy payloads, which cannot be re-wrapped without migrating. */
  rawDataKey: Uint8Array | null;
}

/** Create a brand-new vault, wrapping the data key with password and recovery key. */
export async function createVault(
  plaintext: string,
  password: string,
  recoveryKey?: string
): Promise<EncryptedPayload> {
  const rawDataKey = crypto.getRandomValues(new Uint8Array(RAW_KEY_BYTES));
  const dataKey = await importDataKey(rawDataKey);
  const body = await sealBody(dataKey, plaintext);
  const passwordWrap = await wrapKeyWithSecret(password, rawDataKey);
  const recoveryWrap = recoveryKey
    ? await wrapKeyWithSecret(recoveryKey, rawDataKey)
    : undefined;

  return {
    v: KDF_VERSION,
    salt: passwordWrap.salt,
    iv: passwordWrap.iv,
    ciphertext: passwordWrap.ciphertext,
    iterations: passwordWrap.iterations,
    data: body,
    recovery: recoveryWrap,
  };
}

/**
 * Unlock with the master password. Returns null when the password is wrong or
 * the payload is corrupt.
 */
export async function unlockVault(
  payload: EncryptedPayload,
  password: string
): Promise<UnlockedVault | null> {
  // v3: unwrap the data key, then open the body.
  if ((payload.v ?? 1) >= 3 && payload.data) {
    const rawDataKey = await unwrapKeyWithSecret(password, {
      salt: payload.salt,
      iv: payload.iv,
      ciphertext: payload.ciphertext,
      iterations: payloadIterations(payload),
    });
    if (!rawDataKey) return null;

    const plaintext = await openBody(await importDataKey(rawDataKey), payload.data);
    if (plaintext === null) return null;

    return { plaintext, rawDataKey };
  }

  // Legacy v1/v2: the body was encrypted directly with the password.
  try {
    const key = await deriveAesKey(password, base64ToBytes(payload.salt), payloadIterations(payload));
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: asBufferSource(base64ToBytes(payload.iv)) },
      key,
      base64ToArrayBuffer(payload.ciphertext)
    );
    return { plaintext: new TextDecoder().decode(plaintext), rawDataKey: null };
  } catch {
    return null;
  }
}

/**
 * Unlock with the emergency recovery key. Only possible on v3 payloads that
 * carry a recovery wrap.
 */
export async function unlockVaultWithRecovery(
  payload: EncryptedPayload,
  recoveryKey: string
): Promise<UnlockedVault | null> {
  if (!payload.recovery || !payload.data) return null;

  const rawDataKey = await unwrapKeyWithSecret(recoveryKey, payload.recovery);
  if (!rawDataKey) return null;

  const plaintext = await openBody(await importDataKey(rawDataKey), payload.data);
  if (plaintext === null) return null;

  return { plaintext, rawDataKey };
}

/**
 * Re-wrap the data key under a new password. The recovery wrap is unaffected
 * because it wraps the same data key, so recovery keeps working across a
 * password change.
 */
export async function rekeyWithPassword(
  payload: EncryptedPayload,
  rawDataKey: Uint8Array,
  newPassword: string
): Promise<EncryptedPayload> {
  const passwordWrap = await wrapKeyWithSecret(newPassword, rawDataKey);
  return {
    ...payload,
    v: KDF_VERSION,
    salt: passwordWrap.salt,
    iv: passwordWrap.iv,
    ciphertext: passwordWrap.ciphertext,
    iterations: passwordWrap.iterations,
  };
}

/** Replace the recovery wrap with one derived from a new recovery key. */
export async function setRecoveryKey(
  payload: EncryptedPayload,
  rawDataKey: Uint8Array,
  recoveryKey: string
): Promise<EncryptedPayload> {
  const recoveryWrap = await wrapKeyWithSecret(recoveryKey, rawDataKey);
  return { ...payload, v: KDF_VERSION, recovery: recoveryWrap };
}

/** Re-seal the vault body (e.g. after adding or editing providers). */
export async function updateVaultBody(
  payload: EncryptedPayload,
  rawDataKey: Uint8Array,
  plaintext: string
): Promise<EncryptedPayload> {
  const body = await sealBody(await importDataKey(rawDataKey), plaintext);
  return { ...payload, v: KDF_VERSION, data: body };
}

/**
 * Migrate a legacy payload to v3. A fresh data key is generated and the body is
 * re-encrypted; the password wrap is replaced. The old recovery key cannot be
 * carried over (we never held it), so callers should flag the vault as needing
 * a new recovery key.
 */
export async function migrateLegacyVault(
  plaintext: string,
  password: string
): Promise<EncryptedPayload> {
  return createVault(plaintext, password);
}

/* --------------------------------------------------------------------- meta */

export interface VaultMeta {
  hasInitialized: boolean;
  createdAt: string;
  updatedAt?: string;
  kdfIterations: number;
  /** True when no recovery key is wrapped into the payload. */
  recoveryNeedsSetup?: boolean;
  /** Legacy read-only fields, present on vaults written by the old build. */
  masterPasswordHash?: string;
  recoveryKeyHash?: string;
  salt?: string;
}

/* ------------------------------------------------------------------ storage */

export function saveVaultToDisk(payload: EncryptedPayload, meta: VaultMeta): void {
  writeKey('vault', payload);
  writeKey('vault_meta', meta);
}

export function loadVaultFromDisk(): {
  payload: EncryptedPayload | null;
  meta: VaultMeta | null;
} {
  const payload = readKey<EncryptedPayload>('vault');
  const meta = readKey<VaultMeta>('vault_meta');
  const validPayload =
    payload && typeof payload === 'object' && typeof payload.ciphertext === 'string'
      ? payload
      : null;
  return {
    payload: validPayload,
    meta: meta && typeof meta === 'object' ? meta : null,
  };
}

export function clearVaultFromDisk(): void {
  removeKey('vault');
  removeKey('vault_meta');
}
