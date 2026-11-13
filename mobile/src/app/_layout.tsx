import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ApiError } from '../api/client';
import { AuthProvider, useAuth } from '../auth/AuthProvider';
import { colors } from '../ui/theme';

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        // Reads are safe to retry; authorization failures are not.
        retry: (count, error) => count < 2 && error instanceof ApiError
          && (error.kind === 'network' || error.kind === 'timeout'),
      },
      // State-changing requests are never retried automatically.
      mutations: { retry: false },
    },
  });
}

/** Refetch active screens when the app returns to the foreground. */
function useAppFocus() {
  useEffect(() => {
    const subscription = AppState.addEventListener('change', status => focusManager.setFocused(status === 'active'));
    return () => subscription.remove();
  }, []);
}

function RootStack() {
  const { state } = useAuth();
  const me = state.status === 'signedIn' ? state.me : null;
  const signedOut = state.status === 'signedOut';
  const applicant = me?.role === 'APPLICANT';
  const mustChange = Boolean(me && me.role === 'STUDENT' && me.mustChangePassword);
  const student = me?.role === 'STUDENT' && !mustChange;
  const staff = me?.role === 'ADMIN' || me?.role === 'TEACHER';
  const isAdmin = me?.role === 'ADMIN';

  return (
    <Stack screenOptions={{
      headerTintColor: colors.primary,
      headerTitleStyle: { color: colors.text },
      contentStyle: { backgroundColor: colors.background },
      headerBackButtonDisplayMode: 'minimal',
    }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Protected guard={signedOut}>
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        <Stack.Screen name="register" options={{ title: 'Student registration' }} />
      </Stack.Protected>
      <Stack.Protected guard={applicant}>
        <Stack.Screen name="applicant" options={{ title: 'Registration status', headerBackVisible: false }} />
      </Stack.Protected>
      <Stack.Protected guard={mustChange}>
        <Stack.Screen name="change-password" options={{ title: 'Change password', headerBackVisible: false }} />
      </Stack.Protected>
      <Stack.Protected guard={student}>
        <Stack.Screen name="student" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={staff}>
        <Stack.Screen name="staff" options={{ headerShown: false }} />
        <Stack.Screen name="session/[id]" options={{ title: 'Attendance review' }} />
        <Stack.Screen name="session/new" options={{ title: 'New session', presentation: 'modal' }} />
        <Stack.Screen name="reports" options={{ title: 'Reports' }} />
        <Stack.Screen name="recognition-settings" options={{ title: 'Recognition settings' }} />
        <Stack.Protected guard={isAdmin}>
          <Stack.Screen name="admin/student/[id]" options={{ title: 'Student' }} />
          <Stack.Screen name="admin/student/new" options={{ title: 'Add student', presentation: 'modal' }} />
          <Stack.Screen name="admin/registration/[id]" options={{ title: 'Registration request' }} />
          <Stack.Screen name="admin/face-review/[id]" options={{ title: 'Face photo review' }} />
          <Stack.Screen name="admin/teachers" options={{ title: 'Teachers' }} />
          <Stack.Screen name="admin/courses" options={{ title: 'Courses & offerings' }} />
          <Stack.Screen name="admin/offering/[id]" options={{ title: 'Offering' }} />
        </Stack.Protected>
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  const [queryClient] = useState(createQueryClient);
  useAppFocus();
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider queryClient={queryClient}>
            <StatusBar style="dark" />
            <RootStack />
          </AuthProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
