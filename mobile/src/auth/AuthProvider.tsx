import { QueryClient } from '@tanstack/react-query';
import { Platform } from 'react-native';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { ApiError, configureApiClient, describeError } from '../api/client';
import { auth as authApi } from '../api/endpoints';
import type { Me } from '../api/types';
import { clearPrivateFiles } from './privateFiles';
import { clearSession, isExpired, readSession, writeSession, type StoredSession } from './tokenStore';

export type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut'; notice?: string }
  | { status: 'unreachable'; message: string }
  | { status: 'signedIn'; me: Me };

type AuthContextValue = {
  state: AuthState;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: (notice?: string) => Promise<void>;
  refreshMe: () => Promise<Me | null>;
  retryRestore: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

/** Listeners that hold private in-memory state (photo selections, drafts) and must reset on logout. */
const resetListeners = new Set<() => void>();
export function onPrivateStateReset(listener: () => void): () => void {
  resetListeners.add(listener);
  return () => resetListeners.delete(listener);
}

/** Clears everything private to the signed-in person on this device. */
export async function clearPrivateData(queryClient: QueryClient) {
  await queryClient.cancelQueries();
  queryClient.clear();
  resetListeners.forEach(listener => {
    try {
      listener();
    } catch {
      // A failing listener must not block the rest of the cleanup.
    }
  });
  clearPrivateFiles();
}

export function AuthProvider({ children, queryClient }: { children: React.ReactNode; queryClient: QueryClient }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const session = useRef<StoredSession | null>(null);
  const expiryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const signingOut = useRef(false);

  const endSession = useCallback(async (notice: string | undefined, revoke: boolean) => {
    if (signingOut.current) return;
    signingOut.current = true;
    const token = session.current?.token;
    session.current = null;
    if (expiryTimer.current) clearTimeout(expiryTimer.current);
    try {
      if (revoke && token) await authApi.signOut(token).catch(() => undefined);
      await clearSession();
      await clearPrivateData(queryClient);
    } finally {
      setState({ status: 'signedOut', notice });
      signingOut.current = false;
    }
  }, [queryClient]);

  useEffect(() => {
    configureApiClient({
      getToken: () => session.current?.token ?? null,
      onUnauthorized: () => {
        void endSession('Your session expired or was signed out. Sign in again.', false);
      },
    });
  }, [endSession]);

  const scheduleExpiry = useCallback((stored: StoredSession) => {
    if (expiryTimer.current) clearTimeout(expiryTimer.current);
    const remaining = Date.parse(stored.expiresAt) - Date.now();
    // setTimeout overflows above ~24.8 days; tokens are shorter, but clamp to be safe.
    expiryTimer.current = setTimeout(() => {
      void endSession('Your session expired. Sign in again.', false);
    }, Math.max(0, Math.min(remaining, 2_000_000_000)));
  }, [endSession]);

  /** Restores a stored session; returns the next state (null when endSession already handled a 401). */
  const restore = useCallback(async (): Promise<AuthState | null> => {
    clearPrivateFiles(); // Leftovers from a crash or a force-quit during a previous session.
    const stored = await readSession();
    if (!stored) return { status: 'signedOut' };
    if (isExpired(stored)) {
      await clearSession();
      return { status: 'signedOut', notice: 'Your session expired. Sign in again.' };
    }
    session.current = stored;
    try {
      const me = await authApi.me();
      scheduleExpiry(stored);
      return { status: 'signedIn', me };
    } catch (error) {
      if (error instanceof ApiError && error.kind === 'unauthorized') return null;
      return { status: 'unreachable', message: describeError(error) };
    }
  }, [scheduleExpiry]);

  useEffect(() => {
    let active = true;
    restore().then(next => {
      if (active && next) setState(next);
    });
    return () => {
      active = false;
      if (expiryTimer.current) clearTimeout(expiryTimer.current);
    };
  }, [restore]);

  const signIn = useCallback(async (username: string, password: string) => {
    const issued = await authApi.signIn(username.trim(), password, `Attend mobile (${Platform.OS})`);
    const stored = { token: issued.accessToken, expiresAt: issued.expiresAt };
    const me = await authApi.me(stored.token);
    await clearPrivateData(queryClient); // Never show a previous user's cached data.
    await writeSession(stored);
    session.current = stored;
    scheduleExpiry(stored);
    setState({ status: 'signedIn', me });
  }, [queryClient, scheduleExpiry]);

  const refreshMe = useCallback(async () => {
    if (!session.current) return null;
    const me = await authApi.me();
    setState({ status: 'signedIn', me });
    return me;
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    state,
    signIn,
    signOut: notice => endSession(notice, true),
    refreshMe,
    retryRestore: async () => {
      setState({ status: 'loading' });
      const next = await restore();
      if (next) setState(next);
    },
  }), [state, signIn, endSession, refreshMe, restore]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}

export function useMe(): Me {
  const { state } = useAuth();
  if (state.status !== 'signedIn') throw new Error('useMe requires a signed-in user');
  return state.me;
}
