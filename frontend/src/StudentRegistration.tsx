import { useState } from 'react';

type Application = {
  name: string;
  roll: string;
  email: string;
  username: string;
  password: string;
  department: string;
  batch: string;
};

const emptyApplication: Application = {
  name: '',
  roll: '',
  email: '',
  username: '',
  password: '',
  department: '',
  batch: '',
};

async function publicRequest(path: string, body: unknown) {
  const response = await fetch(`/api/student-registrations${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message || payload.detail || response.statusText);
  }
  return payload;
}

export default function StudentRegistration({ onBack }: { onBack: () => void }) {
  const [application, setApplication] = useState(emptyApplication);
  const [confirmPassword, setConfirmPassword] = useState('');
  const [reference, setReference] = useState('');
  const [token, setToken] = useState('');
  const [status, setStatus] = useState<Record<string, string> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (application.password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      const result = await publicRequest('', application);
      setReference(result.reference);
      setToken(result.statusToken);
      setStatus({ status: result.status });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }

  async function checkStatus(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      setStatus(await publicRequest('/status', { reference, token }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }

  async function resubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (application.password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      await publicRequest('/resubmit', { reference, token, application });
      setStatus({ status: 'PENDING_APPROVAL' });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }

  const fields = <>
    <label>Full name<input required maxLength={160} value={application.name} onChange={event => setApplication({ ...application, name: event.target.value })} /></label>
    <label>Student roll / ID<input required maxLength={64} value={application.roll} onChange={event => setApplication({ ...application, roll: event.target.value })} /></label>
    <label>Email<input type="email" required maxLength={254} autoComplete="email" value={application.email} onChange={event => setApplication({ ...application, email: event.target.value })} /></label>
    <label>Username<input required minLength={3} maxLength={64} pattern="[A-Za-z0-9._-]+" autoComplete="username" value={application.username} onChange={event => setApplication({ ...application, username: event.target.value })} /></label>
    <label>Department (optional)<input maxLength={120} value={application.department} onChange={event => setApplication({ ...application, department: event.target.value })} /></label>
    <label>Batch (optional)<input maxLength={80} value={application.batch} onChange={event => setApplication({ ...application, batch: event.target.value })} /></label>
    <label>Password<input type="password" required minLength={12} maxLength={128} autoComplete="new-password" value={application.password} onChange={event => setApplication({ ...application, password: event.target.value })} /></label>
    <label>Confirm password<input type="password" required minLength={12} maxLength={128} autoComplete="new-password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} /></label>
  </>;

  return <main className="login">
    <section className="card student-registration">
      <span className="brand">◉ Attend</span>
      <h1>Student registration</h1>
      <p>Registration requires administrator approval. Biometric consent is not part of account registration.</p>
      {status?.status === 'PENDING_APPROVAL' && <div role="status" className="notice">
        <strong>Approval pending.</strong> Save both values below to privately check the application status.
        <p>Reference: <code>{reference}</code></p>
        <p>Status access token: <code>{token}</code></p>
      </div>}
      {status && <div role="status" className="card">
        <strong>Status: {status.status}</strong>
        {status.rejectionReason && <p>Reason: {status.rejectionReason}</p>}
        {status.status === 'REJECTED' && <form onSubmit={resubmit}>
          <h2>Resubmit application</h2>{fields}
          <button type="submit" disabled={loading}>{loading ? 'Submitting…' : 'Resubmit'}</button>
        </form>}
      </div>}
      {!status && <form onSubmit={submit}>{fields}
        <button type="submit" disabled={loading}>{loading ? 'Submitting…' : 'Submit for approval'}</button>
      </form>}
      <details>
        <summary>Already submitted? Check application status</summary>
        <form className="status-lookup" onSubmit={checkStatus}>
          <label>Reference<input required value={reference} onChange={event => setReference(event.target.value)} /></label>
          <label>Status access token<input required value={token} onChange={event => setToken(event.target.value)} /></label>
          <button type="submit" className="secondary" disabled={loading}>Check status</button>
        </form>
      </details>
      {error && <p role="alert" className="error">{error}</p>}
      <button type="button" className="secondary" onClick={onBack}>Back to login</button>
    </section>
  </main>;
}
