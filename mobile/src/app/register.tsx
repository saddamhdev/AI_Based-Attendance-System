import React, { useState } from 'react';

import { ApiError } from '../api/client';
import { registration } from '../api/endpoints';
import { useAuth } from '../auth/AuthProvider';
import { validateRegistration, type RegistrationFields } from '../features/registrationForm';
import { Banner, Button, Card, ErrorBanner, Field, H2, Muted, Screen } from '../ui/components';

const empty: RegistrationFields = { name: '', roll: '', email: '', username: '', password: '', confirm: '', department: '', batch: '' };

/**
 * Self-registration creates a PENDING_APPROVAL request only. An administrator must approve it,
 * and a matching roll number is never claimed automatically — the admin links records explicitly.
 */
export default function Register() {
  const { signIn } = useAuth();
  const [fields, setFields] = useState(empty);
  const [errors, setErrors] = useState<Partial<Record<keyof RegistrationFields, string>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [submitted, setSubmitted] = useState(false);
  const set = (key: keyof RegistrationFields) => (value: string) => setFields(current => ({ ...current, [key]: value }));

  async function submit() {
    const found = validateRegistration(fields, { requirePassword: true, checkUsername: true });
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    setError(null);
    try {
      await registration.submit({
        name: fields.name.trim(), roll: fields.roll.trim(), email: fields.email.trim(), username: fields.username.trim(),
        password: fields.password, department: fields.department.trim() || undefined, batch: fields.batch.trim() || undefined,
      });
      setSubmitted(true);
      // Sign in to the restricted status view; the password is kept only in memory for this call.
      await signIn(fields.username, fields.password);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
      setFields(current => ({ ...current, password: '', confirm: '' }));
    }
  }

  return (
    <Screen>
      {submitted ? (
        <Banner tone="success" title="Registration submitted">
          Your request is pending approval. If you are not taken to the status screen, sign in with your new username and password.
        </Banner>
      ) : null}
      <Card>
        <H2>Your details</H2>
        <Muted>An administrator reviews every registration before you can access the student dashboard.</Muted>
        <Field label="Full name" value={fields.name} onChangeText={set('name')} error={errors.name} autoComplete="name" />
        <Field label="Roll / student ID" value={fields.roll} onChangeText={set('roll')} error={errors.roll} autoCapitalize="characters" />
        <Field label="Email" value={fields.email} onChangeText={set('email')} error={errors.email} keyboardType="email-address"
          autoCapitalize="none" autoComplete="email" />
        <Field label="Department (optional)" value={fields.department} onChangeText={set('department')} error={errors.department} />
        <Field label="Batch (optional)" value={fields.batch} onChangeText={set('batch')} error={errors.batch} />
      </Card>
      <Card>
        <H2>Account</H2>
        <Field label="Username" value={fields.username} onChangeText={set('username')} error={errors.username}
          autoCapitalize="none" autoCorrect={false} autoComplete="username-new" />
        <Field label="Password" value={fields.password} onChangeText={set('password')} error={errors.password}
          secureTextEntry autoComplete="password-new" hint="12–128 characters." />
        <Field label="Confirm password" value={fields.confirm} onChangeText={set('confirm')} error={errors.confirm}
          secureTextEntry autoComplete="password-new" />
      </Card>
      {error ? <ErrorBanner error={error instanceof ApiError ? error : new ApiError({ kind: 'http', message: String(error) })}
        title="Registration not submitted" /> : null}
      <Button title="Submit registration" onPress={() => void submit()} loading={busy} disabled={submitted} />
    </Screen>
  );
}
