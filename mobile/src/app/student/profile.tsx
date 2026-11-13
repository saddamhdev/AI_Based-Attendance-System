import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React from 'react';
import { Alert } from 'react-native';

import { student } from '../../api/endpoints';
import { useAuth } from '../../auth/AuthProvider';
import { ChangePasswordForm } from '../../features/ChangePasswordForm';
import { Banner, Button, Card, ErrorBanner, H2, KeyValue, Muted, QueryView, Screen } from '../../ui/components';

export default function StudentProfile() {
  const { signOut } = useAuth();
  const queryClient = useQueryClient();
  const dashboard = useQuery({ queryKey: ['student', 'dashboard'], queryFn: () => student.dashboard() });
  const withdraw = useMutation({
    mutationFn: student.withdrawConsent,
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['student'] }),
  });

  const confirmWithdraw = () => Alert.alert(
    'Withdraw biometric consent?',
    'Recognition stops immediately, pending submissions are cancelled, and your face templates are deleted. '
      + 'Your attendance history is kept, and your teacher can still mark you manually.',
    [{ text: 'Keep consent', style: 'cancel' }, { text: 'Withdraw', style: 'destructive', onPress: () => withdraw.mutate() }],
  );

  return (
    <Screen>
      <QueryView query={dashboard}>
        {data => (
          <Card>
            <H2>Profile</H2>
            <KeyValue label="Name" value={data.profile.name} />
            <KeyValue label="Roll" value={data.profile.roll} />
            <KeyValue label="Email" value={data.profile.email} />
            <KeyValue label="Department" value={data.profile.department} />
            <KeyValue label="Batch" value={data.profile.batch} />
            <KeyValue label="Account" value={data.profile.account_status} />
            <KeyValue label="Biometric consent" value={data.profile.consent ? 'Given' : 'Not given'} />
            {data.profile.consent ? (
              <>
                <ErrorBanner error={withdraw.error} title="Consent withdrawn, cleanup pending" />
                <Button title="Withdraw biometric consent" variant="danger" loading={withdraw.isPending} onPress={confirmWithdraw} />
              </>
            ) : null}
            {withdraw.isSuccess ? <Banner tone="success">Consent withdrawn and face templates deleted.</Banner> : null}
            <Muted>Contact an administrator to correct your profile details.</Muted>
          </Card>
        )}
      </QueryView>
      <Card>
        <H2>Change password</H2>
        <ChangePasswordForm onChanged={() => undefined} />
      </Card>
      <Button title="Sign out" variant="secondary" onPress={() => void signOut()} />
    </Screen>
  );
}
