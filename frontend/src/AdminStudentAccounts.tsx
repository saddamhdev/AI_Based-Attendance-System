import { useState } from 'react';

type Row = Record<string, any>;
type Api = (path: string, method?: string, body?: any) => Promise<any>;

export default function AdminStudentAccounts({ students, api, onChanged }: {
  students: Row[];
  api: Api;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function submit(event: React.FormEvent<HTMLFormElement>, action: (form: FormData, formElement: HTMLFormElement) => Promise<void>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action(new FormData(formElement), formElement);
      await onChanged();
      setNotice('Student information saved.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function updateAccount(student: Row, active: boolean) {
    if (!active && !confirm(`Deactivate ${student.name}'s student account? They will lose portal access immediately.`)) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api(`/students/${student.id}/account`, 'PUT', { active });
      await onChanged();
      setNotice(active ? 'Student account activated.' : 'Student account deactivated.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword(student: Row) {
    const temporaryPassword = prompt(`Enter a new temporary password for ${student.name} (at least 12 characters):`);
    if (!temporaryPassword) return;
    if (temporaryPassword.length < 12) {
      setError('Temporary password must contain at least 12 characters.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api(`/students/${student.id}/account/password-reset`, 'POST', { temporaryPassword });
      await onChanged();
      setNotice('Password reset. The student must change it at next login.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  return <section className="student-admin-workspace">
    {error && <p role="alert" className="error">{error}</p>}
    {notice && <p role="status" className="notice">{notice}</p>}
    <form className="card inline" onSubmit={event => submit(event, async (form, formElement) => {
      const username = String(form.get('username') || '').trim();
      const password = String(form.get('temporaryPassword') || '');
      await api('/admin/students', 'POST', {
        name: form.get('name'), roll: form.get('roll'), email: form.get('email') || null,
        department: form.get('department') || null, batch: form.get('batch') || null,
        username: username || null, temporaryPassword: password || null,
        consent: form.get('consent') === 'on',
      });
      formElement.reset();
    })}>
      <h2>Create student profile</h2>
      <input name="name" placeholder="Full name" required maxLength={160} />
      <input name="roll" placeholder="Student roll / ID" required maxLength={64} />
      <input name="email" type="email" placeholder="Email (required for account)" maxLength={254} />
      <input name="department" placeholder="Department (optional)" maxLength={120} />
      <input name="batch" placeholder="Batch (optional)" maxLength={80} />
      <input name="username" placeholder="Account username (optional)" minLength={3} maxLength={64} pattern="[A-Za-z0-9._-]+" />
      <input name="temporaryPassword" type="password" placeholder="Temporary password (optional, 12+)" minLength={12} maxLength={128} autoComplete="new-password" />
      <label><input type="checkbox" name="consent" /> Verified identity and explicit biometric consent</label>
      <button disabled={busy}>{busy ? 'Saving…' : 'Create student'}</button>
      <small>When account credentials are supplied, the approved account requires a password change at first login.</small>
    </form>

    <section className="card">
      <h2>Student profiles and accounts</h2>
      {students.length === 0 && <p className="empty">No student profiles.</p>}
      {students.map(student => <article className="student-request" key={student.id}>
        <h3>{student.name} · {student.roll} {student.archived && <span className="pill">Archived</span>}</h3>
        <p>{student.email || 'No email'} · {student.department || 'No department'} · {student.batch || 'No batch'}</p>
        {student.account_username
          ? <div className="inline">
            <span>Account: {student.account_username} · {student.account_status} · {student.registration_source}
              {student.must_change_password ? ' · Password change required' : ''}</span>
            <button type="button" className={student.account_active ? 'danger' : 'secondary'} disabled={busy || student.archived}
              onClick={() => void updateAccount(student, !student.account_active)}>
              {student.account_active ? 'Deactivate account' : 'Reactivate account'}
            </button>
            {student.account_active && !student.archived &&
              <button type="button" className="secondary" disabled={busy} onClick={() => void resetPassword(student)}>Reset password</button>}
          </div>
          : !student.archived && <form className="inline" onSubmit={event => submit(event, async (form, formElement) => {
            await api(`/students/${student.id}/account`, 'POST', {
              username: form.get('username'), email: form.get('email'),
              temporaryPassword: form.get('temporaryPassword'),
            });
            formElement.reset();
          })}>
            <input name="username" placeholder="Username" required minLength={3} maxLength={64} pattern="[A-Za-z0-9._-]+" />
            <input name="email" type="email" placeholder="Email" defaultValue={student.email || ''} required />
            <input name="temporaryPassword" type="password" placeholder="Temporary password (12+)" required minLength={12} maxLength={128} autoComplete="new-password" />
            <button disabled={busy}>Add account</button>
          </form>}
        {!student.archived && <details><summary>Edit safe profile fields</summary>
          <form className="inline" onSubmit={event => submit(event, async form => {
            await api(`/students/${student.id}/profile`, 'PUT', {
              name: form.get('name'), email: form.get('email') || null,
              department: form.get('department') || null, batch: form.get('batch') || null,
            });
          })}>
            <input name="name" aria-label="Student name" defaultValue={student.name} required maxLength={160} />
            <input name="email" aria-label="Student email" type="email" defaultValue={student.email || ''} maxLength={254} />
            <input name="department" aria-label="Department" defaultValue={student.department || ''} maxLength={120} />
            <input name="batch" aria-label="Batch" defaultValue={student.batch || ''} maxLength={80} />
            <button disabled={busy}>Save profile</button>
          </form>
        </details>}
      </article>)}
    </section>
  </section>;
}
