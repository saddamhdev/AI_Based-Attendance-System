const mockStore = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'wutdo',
  getItemAsync: jest.fn(async (key: string) => mockStore.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => { mockStore.set(key, value); }),
  deleteItemAsync: jest.fn(async (key: string) => { mockStore.delete(key); }),
}));
jest.mock('../src/auth/privateFiles', () => ({ clearPrivateFiles: jest.fn(), deleteTempFile: jest.fn(), privateDir: jest.fn() }));


import { QueryClient } from '@tanstack/react-query';
import * as SecureStore from 'expo-secure-store';

import { clearPrivateData, onPrivateStateReset } from '../src/auth/AuthProvider';
import { clearPrivateFiles } from '../src/auth/privateFiles';
import { clearSession, isExpired, readSession, writeSession } from '../src/auth/tokenStore';

describe('token storage', () => {
  beforeEach(() => mockStore.clear());

  it('stores only the token and expiry in secure storage — never a password', async () => {
    await writeSession({ token: 'att_abc', expiresAt: '2099-01-01T00:00:00Z' });
    const [, value, options] = (SecureStore.setItemAsync as jest.Mock).mock.calls.at(-1);
    expect(JSON.parse(value)).toEqual({ token: 'att_abc', expiresAt: '2099-01-01T00:00:00Z' });
    expect(value).not.toMatch(/password/i);
    expect(options.keychainAccessible).toBe('wutdo');
    await expect(readSession()).resolves.toEqual({ token: 'att_abc', expiresAt: '2099-01-01T00:00:00Z' });
  });

  it('treats expired or malformed expiries as expired', () => {
    expect(isExpired({ token: 't', expiresAt: '2000-01-01T00:00:00Z' })).toBe(true);
    expect(isExpired({ token: 't', expiresAt: 'nonsense' })).toBe(true);
    expect(isExpired({ token: 't', expiresAt: '2099-01-01T00:00:00Z' })).toBe(false);
  });

  it('removes the session on logout and tolerates corrupt values', async () => {
    mockStore.set('attend.session.v1', '{not json');
    await expect(readSession()).resolves.toBeNull();
    await writeSession({ token: 'x', expiresAt: '2099-01-01T00:00:00Z' });
    await clearSession();
    await expect(readSession()).resolves.toBeNull();
  });

  it('does not use AsyncStorage at all', () => {

    const sources = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'auth', 'tokenStore.ts'), 'utf8');
    expect(sources).not.toMatch(/AsyncStorage/);
  });
});

describe('logout cleanup', () => {
  it('clears cached API data, in-memory photo selections, and private files', async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(['student', 'dashboard'], { profile: { name: 'Private' } });
    const listener = jest.fn();
    const unsubscribe = onPrivateStateReset(listener);
    await clearPrivateData(queryClient);
    expect(queryClient.getQueryData(['student', 'dashboard'])).toBeUndefined();
    expect(listener).toHaveBeenCalled();
    expect(clearPrivateFiles).toHaveBeenCalled();
    unsubscribe();
  });

  it('continues cleanup when one listener throws', async () => {
    const after = jest.fn();
    const a = onPrivateStateReset(() => { throw new Error('boom'); });
    const b = onPrivateStateReset(after);
    await clearPrivateData(new QueryClient());
    expect(after).toHaveBeenCalled();
    a(); b();
  });
});
