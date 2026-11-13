import React, { useState } from 'react';

import { auth as authApi } from '../api/endpoints';
import { Banner, Button, ErrorBanner, Field } from '../ui/components';

export function ChangePasswordForm({ onChanged }: { onChanged: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [problem, setProblem] = useState('');
  const [done, setDone] = useState(false);

  async function submit() {
    setProblem('');
    if (next.length < 12 || next.length > 128) return setProblem('The new password must be 12–128 characters.');
    if (next !== confirm) return setProblem('The new passwords do not match.');
    setBusy(true);
    setError(null);
    try {
      await authApi.changePassword(current, next, confirm);
      setDone(true);
      onChanged();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
      setCurrent('');
      setNext('');
      setConfirm('');
    }
  }

  return (
    <>
      {done ? <Banner tone="success">Password changed. Other devices were signed out.</Banner> : null}
      <Field label="Current password" value={current} onChangeText={setCurrent} secureTextEntry autoComplete="current-password" />
      <Field label="New password" value={next} onChangeText={setNext} secureTextEntry autoComplete="password-new" hint="12–128 characters." />
      <Field label="Confirm new password" value={confirm} onChangeText={setConfirm} secureTextEntry autoComplete="password-new" />
      {problem ? <Banner tone="error">{problem}</Banner> : null}
      <ErrorBanner error={error} title="Password not changed" />
      <Button title="Change password" onPress={() => void submit()} loading={busy} disabled={!current || !next} />
    </>
  );
}
