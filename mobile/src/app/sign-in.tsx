import { Link } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../auth/AuthProvider';
import { apiBaseUrl, isDeviceUnreachableHost } from '../config';
import { Banner, Button, Card, ErrorBanner, Field, Muted, Screen } from '../ui/components';
import { colors, space } from '../ui/theme';

export default function SignIn() {
  const { signIn, state } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const notice = state.status === 'signedOut' ? state.notice : undefined;

  let configProblem: string | null = null;
  let server = '';
  try {
    server = apiBaseUrl();
  } catch (problem) {
    configProblem = problem instanceof Error ? problem.message : String(problem);
  }

  async function submit() {
    if (!username.trim() || !password) {
      setError(new Error('Enter your username and password.'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await signIn(username, password);
      setPassword('');
    } catch (failure) {
      setError(failure);
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <View style={{ marginTop: 64 }}>
        <Text style={styles.brand}>◉ Attend</Text>
        <Text style={styles.title}>Welcome back</Text>
        <Muted>Classroom attendance, thoughtfully reviewed.</Muted>
      </View>
      <Card style={{ marginTop: space.xl }}>
        {notice ? <Banner tone="info">{notice}</Banner> : null}
        {configProblem ? <Banner tone="error" title="App configuration">{configProblem}</Banner> : null}
        {!configProblem && isDeviceUnreachableHost(server) ? (
          <Banner tone="warning" title="Server address uses localhost">
            {'A physical phone cannot reach "localhost". Set EXPO_PUBLIC_API_URL to your computer\'s LAN address (see the mobile README).'}
          </Banner>
        ) : null}
        <Field label="Username" value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false}
          autoComplete="username" textContentType="username" returnKeyType="next" />
        <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password"
          textContentType="password" returnKeyType="go" onSubmitEditing={() => void submit()} />
        {error ? (error instanceof Error && !(error as { kind?: string }).kind
          ? <Banner tone="error">{error.message}</Banner> : <ErrorBanner error={error} title="Sign-in failed" />) : null}
        <Button title="Sign in" onPress={() => void submit()} loading={busy} disabled={Boolean(configProblem)} />
        <Muted style={{ marginTop: space.sm }}>
          Students who registered but are not yet approved can sign in to check their registration status.
        </Muted>
      </Card>
      <Link href="/register" asChild>
        <Button title="New student? Register" variant="secondary" />
      </Link>
      {server ? <Muted style={{ textAlign: 'center', marginTop: space.md }}>Server: {server}</Muted> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  brand: { fontSize: 25, fontWeight: '800', color: colors.primaryDark, letterSpacing: -1, marginBottom: space.lg },
  title: { fontSize: 30, fontWeight: '800', color: colors.text },
});
