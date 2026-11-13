import React from 'react';

import { useAuth } from '../auth/AuthProvider';
import { ChangePasswordForm } from '../features/ChangePasswordForm';
import { Button, Card, H1, Muted, Screen } from '../ui/components';

/** Admin-created accounts must replace the temporary password before using the dashboard. */
export default function ChangePassword() {
  const { refreshMe, signOut } = useAuth();
  return (
    <Screen>
      <H1>Set your password</H1>
      <Muted>Your account was created with a temporary password. Choose a new one to continue.</Muted>
      <Card style={{ marginTop: 16 }}>
        <ChangePasswordForm onChanged={() => void refreshMe()} />
      </Card>
      <Button title="Sign out" variant="secondary" onPress={() => void signOut()} />
    </Screen>
  );
}
