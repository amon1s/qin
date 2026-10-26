import { describe, expect, it } from 'vitest';
import {
  EncryptedPayload,
  KDF_VERSION,
  createVault,
  generateEmergencyRecoveryKey,
  needsUpgrade,
  rekeyWithPassword,
  setRecoveryKey,
  unlockVault,
  unlockVaultWithRecovery,
  updateVaultBody,
} from './crypto';

const BODY = JSON.stringify({ version: 3, providers: [{ id: 'openai_primary', apiKey: 'sk-secret' }] });
const PASSWORD = 'correct horse battery staple';
const RECOVERY = 'Ab3!xY9@zQ1#';

const toB64 = (value: ArrayBuffer | Uint8Array): string =>
  Buffer.from(value instanceof Uint8Array ? value : new Uint8Array(value)).toString('base64');

/**
 * Build a payload the way the pre-1.1 build did: the body encrypted directly
 * with a password-derived key at 100,000 iterations, no wrapped data key.
 * Constructed here rather than through production code so the migration path is
 * tested against the real old format.
 */
async function makeLegacyPayload(plaintext: string, password: string): Promise<EncryptedPayload> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  const key = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as unknown as BufferSource,
      iterations: 100_000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    new TextEncoder().encode(plaintext) as unknown as BufferSource
  );

  return { v: 1, salt: toB64(salt), iv: toB64(iv), ciphertext: toB64(ciphertext) };
}

describe('vault creation and unlock', () => {
  it('round-trips the body with the master password', async () => {
    const payload = await createVault(BODY, PASSWORD, RECOVERY);
    expect(payload.v).toBe(KDF_VERSION);

    const unlocked = await unlockVault(payload, PASSWORD);
    expect(unlocked?.plaintext).toBe(BODY);
    expect(unlocked?.rawDataKey).toHaveLength(32);
  });

  it('rejects a wrong password instead of returning garbage', async () => {
    const payload = await createVault(BODY, PASSWORD, RECOVERY);
    expect(await unlockVault(payload, 'wrong password')).toBeNull();
  });

  it('does not store the password or a hash of it anywhere in the payload', async () => {
    const payload = await createVault(BODY, PASSWORD, RECOVERY);
    const serialised = JSON.stringify(payload);
    expect(serialised).not.toContain(PASSWORD);
    // The old build wrote a single-round SHA-256 of the password into meta.
    expect(payload).not.toHaveProperty('masterPasswordHash');
  });
});

describe('recovery key', () => {
  it('unlocks the vault and yields the same data key as the password', async () => {
    const payload = await createVault(BODY, PASSWORD, RECOVERY);

    const viaPassword = await unlockVault(payload, PASSWORD);
    const viaRecovery = await unlockVaultWithRecovery(payload, RECOVERY);

    expect(viaRecovery?.plaintext).toBe(BODY);
    expect(Array.from(viaRecovery!.rawDataKey!)).toEqual(Array.from(viaPassword!.rawDataKey!));
  });

  it('rejects a wrong recovery key', async () => {
    const payload = await createVault(BODY, PASSWORD, RECOVERY);
    expect(await unlockVaultWithRecovery(payload, 'WrongKey1234')).toBeNull();
  });

  it('preserves stored keys across a password reset', async () => {
    // Regression: the old recovery flow re-encrypted whatever providers happened
    // to be in memory — an empty list while locked — destroying every key.
    const payload = await createVault(BODY, PASSWORD, RECOVERY);
    const recovered = await unlockVaultWithRecovery(payload, RECOVERY);
    const rekeyed = await rekeyWithPassword(payload, recovered!.rawDataKey!, 'brand new password');

    const reopened = await unlockVault(rekeyed, 'brand new password');
    expect(reopened?.plaintext).toBe(BODY);
    expect(reopened?.plaintext).toContain('sk-secret');

    // Old password no longer works.
    expect(await unlockVault(rekeyed, PASSWORD)).toBeNull();
  });

  it('keeps working after the password changes', async () => {
    const payload = await createVault(BODY, PASSWORD, RECOVERY);
    const recovered = await unlockVaultWithRecovery(payload, RECOVERY);
    const rekeyed = await rekeyWithPassword(payload, recovered!.rawDataKey!, 'another password');

    const viaRecoveryAgain = await unlockVaultWithRecovery(rekeyed, RECOVERY);
    expect(viaRecoveryAgain?.plaintext).toBe(BODY);
  });

  it('can be replaced without touching the body', async () => {
    const payload = await createVault(BODY, PASSWORD, RECOVERY);
    const unlocked = await unlockVault(payload, PASSWORD);

    const nextRecovery = generateEmergencyRecoveryKey();
    const updated = await setRecoveryKey(payload, unlocked!.rawDataKey!, nextRecovery);

    expect(await unlockVaultWithRecovery(updated, RECOVERY)).toBeNull();
    expect((await unlockVaultWithRecovery(updated, nextRecovery))?.plaintext).toBe(BODY);
    expect((await unlockVault(updated, PASSWORD))?.plaintext).toBe(BODY);
  });

  it('reports the vault as unopenable by recovery when no wrap exists', async () => {
    const payload = await createVault(BODY, PASSWORD);
    expect(payload.recovery).toBeUndefined();
    expect(await unlockVaultWithRecovery(payload, RECOVERY)).toBeNull();
  });
});

describe('body updates', () => {
  it('re-seals the body without changing either wrapped key', async () => {
    const payload = await createVault(BODY, PASSWORD, RECOVERY);
    const unlocked = await unlockVault(payload, PASSWORD);

    const nextBody = JSON.stringify({ version: 3, providers: [{ id: 'x', apiKey: 'sk-new' }] });
    const updated = await updateVaultBody(payload, unlocked!.rawDataKey!, nextBody);

    expect(updated.ciphertext).toBe(payload.ciphertext);
    expect(updated.recovery?.ciphertext).toBe(payload.recovery?.ciphertext);
    expect((await unlockVault(updated, PASSWORD))?.plaintext).toBe(nextBody);
    expect((await unlockVaultWithRecovery(updated, RECOVERY))?.plaintext).toBe(nextBody);
  });
});

describe('legacy payloads', () => {
  it('opens a v1 payload written with 100k iterations and flags it for upgrade', async () => {
    const legacy = await makeLegacyPayload(BODY, PASSWORD);

    expect(needsUpgrade(legacy)).toBe(true);

    const unlocked = await unlockVault(legacy, PASSWORD);
    expect(unlocked?.plaintext).toBe(BODY);
    // Legacy payloads have no wrapped data key, which is what forces a migration.
    expect(unlocked?.rawDataKey).toBeNull();
  });

  it('rejects a wrong password on a legacy payload', async () => {
    const legacy = await makeLegacyPayload(BODY, PASSWORD);
    expect(await unlockVault(legacy, 'nope')).toBeNull();
  });

  it('marks a current payload as not needing an upgrade', async () => {
    const payload = await createVault(BODY, PASSWORD, RECOVERY);
    expect(needsUpgrade(payload)).toBe(false);
  });
});

describe('generateEmergencyRecoveryKey', () => {
  it('produces 12 distinct-ish characters from the allowed alphabet', () => {
    const keys = new Set<string>();
    for (let i = 0; i < 25; i++) {
      const key = generateEmergencyRecoveryKey();
      expect(key).toHaveLength(12);
      expect(key).toMatch(/^[A-Za-z0-9!@#$%&*+?]+$/);
      keys.add(key);
    }
    // 25 draws from a ~73-bit space should all differ.
    expect(keys.size).toBe(25);
  });
});
