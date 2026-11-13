import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import React, { useState } from 'react';

import { admin } from '../../../api/endpoints';
import { Banner, Button, Card, Checkbox, ErrorBanner, Field, H2, Muted, Screen } from '../../../ui/components';

/**
 * Direct creation by an administrator. The account (if any) is approved immediately and must
 * change its temporary password on first sign-in. A profile-only student can get an account later.
 */
export default function NewStudent() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: '', roll: '', email: '', department: '', batch: '', username: '', temporaryPassword: '' });
  const [withAccount, setWithAccount] = useState(false);
  const [consent, setConsent] = useState(false);
  const [problem, setProblem] = useState('');
  const set = (key: keyof typeof form) => (value: string) => setForm(current => ({ ...current, [key]: value }));
  const create = useMutation({
    mutationFn: () => admin.createStudent({
      name: form.name.trim(), roll: form.roll.trim(), email: form.email.trim() || undefined,
      department: form.department.trim() || undefined, batch: form.batch.trim() || undefined,
      username: withAccount ? form.username.trim() : undefined,
      temporaryPassword: withAccount ? form.temporaryPassword : undefined, consent,
    }),
    onSuccess: result => {
      void queryClient.invalidateQueries({ queryKey: ['admin'] });
      router.replace(`/admin/student/${result.id}`);
    },
  });

  function submit() {
    setProblem('');
    if (!form.name.trim() || !form.roll.trim()) return setProblem('Name and roll are required.');
    if (withAccount) {
      if (!form.email.trim()) return setProblem('An email is required for a student account.');
      if (!/^[A-Za-z0-9._-]{3,64}$/.test(form.username.trim())) return setProblem('Username: 3–64 letters, numbers, dots, dashes, or underscores.');
      if (form.temporaryPassword.length < 12) return setProblem('The temporary password must be at least 12 characters.');
    }
    create.mutate();
  }

  return (
    <Screen>
      <Card>
        <H2>Student profile</H2>
        <Field label="Full name" value={form.name} onChangeText={set('name')} />
        <Field label="Roll / student ID" value={form.roll} onChangeText={set('roll')} autoCapitalize="characters" />
        <Field label="Email" value={form.email} onChangeText={set('email')} keyboardType="email-address" autoCapitalize="none" />
        <Field label="Department" value={form.department} onChangeText={set('department')} />
        <Field label="Batch" value={form.batch} onChangeText={set('batch')} />
        <Checkbox checked={consent} onChange={setConsent} label="Identity verified and explicit biometric consent recorded (needed only for face enrollment)." />
      </Card>
      <Card>
        <Checkbox checked={withAccount} onChange={setWithAccount} label="Create a sign-in account now (approved immediately)" />
        {withAccount ? (
          <>
            <Field label="Username" value={form.username} onChangeText={set('username')} autoCapitalize="none" autoCorrect={false} />
            <Field label="Temporary password" value={form.temporaryPassword} onChangeText={set('temporaryPassword')} secureTextEntry
              hint="12–128 characters. The student must change it at first sign-in." />
          </>
        ) : <Muted>You can add an account later from the student’s page.</Muted>}
      </Card>
      {problem ? <Banner tone="error">{problem}</Banner> : null}
      <ErrorBanner error={create.error} title="Student not created" />
      <Button title="Create student" onPress={submit} loading={create.isPending} />
    </Screen>
  );
}
