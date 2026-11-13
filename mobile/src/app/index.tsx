import { Redirect } from 'expo-router';
import React from 'react';
import { View } from 'react-native';

import { useAuth } from '../auth/AuthProvider';
import { apiBaseUrl } from '../config';
import { Banner, Body, Button, H1, Loading, Screen } from '../ui/components';

/** Entry point: routes each role to its own area. */
export default function Index() {
  const { state, retryRestore, signOut } = useAuth();
  if (state.status === 'loading') {
    return <Screen scroll={false}><View style={{ marginTop: 120 }}><Loading label="Starting Attend…" /></View></Screen>;
  }
  if (state.status === 'unreachable') {
    let server = '';
    try { server = apiBaseUrl(); } catch { /* shown in message */ }
    return (
      <Screen>
        <H1>◉ Attend</H1>
        <Banner tone="error" title="Cannot reach the attendance server">{state.message}</Banner>
        {server ? <Body>Server: {server}</Body> : null}
        <Button title="Retry" onPress={() => void retryRestore()} />
        <Button title="Sign out" variant="secondary" onPress={() => void signOut()} />
      </Screen>
    );
  }
  if (state.status === 'signedOut') return <Redirect href="/sign-in" />;
  const { me } = state;
  if (me.role === 'APPLICANT') return <Redirect href="/applicant" />;
  if (me.role === 'STUDENT') return <Redirect href={me.mustChangePassword ? '/change-password' : '/student'} />;
  return <Redirect href="/staff" />;
}
