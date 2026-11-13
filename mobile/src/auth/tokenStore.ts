import * as SecureStore from 'expo-secure-store';

/**
 * Only the opaque bearer token and its expiry are persisted, in the platform keystore
 * (iOS Keychain / Android Keystore-backed storage). Passwords are never stored.
 */
const KEY = 'attend.session.v1';

export type StoredSession = { token: string; expiresAt: string };

const options: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export function isExpired(session: StoredSession, now = Date.now()): boolean {
  const expiry = Date.parse(session.expiresAt);
  return !Number.isFinite(expiry) || expiry <= now;
}

export async function readSession(): Promise<StoredSession | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY, options);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    if (typeof parsed.token !== 'string' || typeof parsed.expiresAt !== 'string') return null;
    return { token: parsed.token, expiresAt: parsed.expiresAt };
  } catch {
    return null;
  }
}

export async function writeSession(session: StoredSession): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(session), options);
}

export async function clearSession(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(KEY, options);
  } catch {
    // Nothing stored.
  }
}
