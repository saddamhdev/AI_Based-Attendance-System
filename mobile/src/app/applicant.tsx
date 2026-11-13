import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useState } from 'react';

import { registration } from '../api/endpoints';
import { useAuth } from '../auth/AuthProvider';
import { validateRegistration, type RegistrationFields } from '../features/registrationForm';
import { Banner, Button, Card, ErrorBanner, Field, H1, H2, KeyValue, Muted, Pill, QueryView, Screen } from '../ui/components';

/** Restricted, authenticated view for applicants whose registration is not approved yet. */
export default function Applicant() {
  const { signOut } = useAuth();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['applicant', 'registration'], queryFn: registration.mine, refetchInterval: 60_000 });
  const [editing, setEditing] = useState(false);
  const [fields, setFields] = useState<RegistrationFields | null>(null);
  const [errors, setErrors] = useState<Partial<Record<keyof RegistrationFields, string>>>({});
  const resubmit = useMutation({
    mutationFn: (value: RegistrationFields) => registration.resubmit({
      name: value.name.trim(), roll: value.roll.trim(), email: value.email.trim(),
      department: value.department.trim() || undefined, batch: value.batch.trim() || undefined,
      newPassword: value.password || undefined,
    }),
    onSuccess: data => {
      queryClient.setQueryData(['applicant', 'registration'], data);
      setEditing(false);
      setFields(null);
    },
  });

  return (
    <Screen refreshing={query.isRefetching} onRefresh={() => void query.refetch()}>
      <H1>Registration</H1>
      <QueryView query={query} loadingLabel="Checking your registration…">
        {data => (
          <>
            <Card>
              <Pill label={data.status.replace('_', ' ')} tone={data.status === 'REJECTED' ? 'error' : data.status === 'APPROVED' ? 'success' : 'warning'} />
              {data.status === 'PENDING_APPROVAL' ? (
                <Muted style={{ marginTop: 8 }}>
                  An administrator is reviewing your request. You will get access to the student dashboard once it is approved.
                  Pull down to refresh.
                </Muted>
              ) : null}
              {data.status === 'APPROVED' ? (
                <Banner tone="success" title="Approved">
                  Your account is ready. Sign out and sign in again with the same username and password to open your dashboard.
                </Banner>
              ) : null}
              {data.status === 'REJECTED' ? (
                <Banner tone="error" title="Not approved">{`Reason: ${data.rejectionReason ?? 'No reason given.'}`}</Banner>
              ) : null}
              <KeyValue label="Name" value={data.name} />
              <KeyValue label="Roll" value={data.roll} />
              <KeyValue label="Email" value={data.email} />
              <KeyValue label="Username" value={data.username} />
              <KeyValue label="Department" value={data.department} />
              <KeyValue label="Batch" value={data.batch} />
              <KeyValue label="Submitted" value={data.submittedAt?.slice(0, 16).replace('T', ' ')} />
            </Card>
            {data.status === 'APPROVED' ? <Button title="Sign out and sign in again" onPress={() => void signOut('Sign in to open your student dashboard.')} /> : null}
            {data.status === 'REJECTED' && !editing ? (
              <Button title="Correct and resubmit" onPress={() => {
                setFields({ name: data.name, roll: data.roll, email: data.email, username: data.username, password: '', confirm: '',
                  department: data.department ?? '', batch: data.batch ?? '' });
                setEditing(true);
              }} />
            ) : null}
            {editing && fields ? (
              <Card>
                <H2>Correct your details</H2>
                {(['name', 'roll', 'email', 'department', 'batch'] as const).map(key => (
                  <Field key={key} label={key[0].toUpperCase() + key.slice(1)} value={fields[key]} error={errors[key]}
                    autoCapitalize={key === 'email' ? 'none' : undefined}
                    onChangeText={value => setFields({ ...fields, [key]: value })} />
                ))}
                <Field label="New password (optional)" value={fields.password} secureTextEntry error={errors.password}
                  onChangeText={value => setFields({ ...fields, password: value })} hint="Leave blank to keep your current password." />
                <Field label="Confirm new password" value={fields.confirm} secureTextEntry error={errors.confirm}
                  onChangeText={value => setFields({ ...fields, confirm: value })} />
                <ErrorBanner error={resubmit.error} title="Resubmission failed" />
                <Button title="Resubmit for approval" loading={resubmit.isPending} onPress={() => {
                  const found = validateRegistration(fields, { requirePassword: false, checkUsername: false });
                  setErrors(found);
                  if (!Object.keys(found).length) resubmit.mutate(fields);
                }} />
                <Button title="Cancel" variant="secondary" onPress={() => setEditing(false)} />
              </Card>
            ) : null}
          </>
        )}
      </QueryView>
      <Button title="Sign out" variant="secondary" onPress={() => void signOut()} />
    </Screen>
  );
}
