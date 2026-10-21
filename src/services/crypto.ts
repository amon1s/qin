/**
 * Qin - Secure Local Cryptographic Vault
 * Implements AES-GCM 256-bit with PBKDF2 key derivation (100,000 iterations, SHA-256).
 * Aligns with Arch Linux / system keyring security standards (libsecret/KWallet semantics).
 */

const PBKDF2_ITERATIONS = 100000;
const AES_KEY_LENGTH = 256;

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export async function hashString(value: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(value);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return arrayBufferToBase64(hashBuffer);
}

/**
 * Generate a 12-character emergency recovery key made of letters, numbers, and symbols
 */
export function generateEmergencyRecoveryKey(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*+?';
  const array = new Uint32Array(12);
  crypto.getRandomValues(array);
  let result = '';
  for (let i = 0; i < 12; i++) {
    result += chars[array[i] % chars.length];
  }
  return result;
}

/**
 * Derive AES-GCM Key from user passphrase + salt
 */
async function deriveKey(passphrase: string, saltBuffer: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBuffer as unknown as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: AES_KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  );
}

export interface EncryptedPayload {
  v: number;
  salt: string;
  iv: string;
  ciphertext: string;
}

export interface VaultMeta {
  hasInitialized: boolean;
  salt: string;
  masterPasswordHash: string;
  recoveryKeyHash: string;
  createdAt: string;
}

/**
 * Encrypt plaintext using AES-GCM 256-bit
 */
export async function encryptData(plainText: string, passphrase: string): Promise<EncryptedPayload> {
  const encoder = new TextEncoder();
  const data = encoder.encode(plainText);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);

  const ciphertextBuffer = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
    },
    key,
    data
  );

  return {
    v: 1,
    salt: arrayBufferToBase64(salt.buffer),
    iv: arrayBufferToBase64(iv.buffer),
    ciphertext: arrayBufferToBase64(ciphertextBuffer),
  };
}

/**
 * Decrypt AES-GCM payload using passphrase
 */
export async function decryptData(payload: EncryptedPayload, passphrase: string): Promise<string> {
  try {
    const salt = new Uint8Array(base64ToArrayBuffer(payload.salt));
    const iv = new Uint8Array(base64ToArrayBuffer(payload.iv));
    const ciphertext = base64ToArrayBuffer(payload.ciphertext);

    const key = await deriveKey(passphrase, salt);
    const decryptedBuffer = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv,
      },
      key,
      ciphertext
    );

    const decoder = new TextDecoder();
    return decoder.decode(decryptedBuffer);
  } catch (error) {
    throw new Error('Keystore decryption failed: Invalid passphrase or corrupted ciphertext');
  }
}

const VAULT_STORAGE_KEY = 'qin_secure_vault_payload';
const VAULT_META_KEY = 'qin_vault_meta';

export function saveVaultToDisk(payload: EncryptedPayload, meta: VaultMeta): void {
  localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(payload));
  localStorage.setItem(VAULT_META_KEY, JSON.stringify(meta));
}

export function loadVaultFromDisk(): { payload: EncryptedPayload | null; meta: VaultMeta | null } {
  try {
    const rawPayload = localStorage.getItem(VAULT_STORAGE_KEY);
    const rawMeta = localStorage.getItem(VAULT_META_KEY);
    return {
      payload: rawPayload ? JSON.parse(rawPayload) : null,
      meta: rawMeta ? JSON.parse(rawMeta) : null,
    };
  } catch {
    return { payload: null, meta: null };
  }
}

export function clearVaultFromDisk(): void {
  localStorage.removeItem(VAULT_STORAGE_KEY);
  localStorage.removeItem(VAULT_META_KEY);
}
