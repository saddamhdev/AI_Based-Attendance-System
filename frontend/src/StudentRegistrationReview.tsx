import { useEffect, useState } from 'react';

type Row = Record<string, any>;
type Api = (path: string, method?: string, body?: any) => Promise<any>;

export default function StudentRegistrationReview({ api }: { api: Api }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [status, setStatus] = useState('PENDING_APPROVAL');
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [verified, setVerified] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const query = new URLSearchParams({ status });
      if (appliedSearch.trim()) query.set('search', appliedSearch.trim());
      setRows(await api(`/admin/student-registrations?${query}`));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [status, appliedSearch]);

  async function approve(row: Row) {
    if (row.candidate_student_id && !verified[row.id]) {
      setError('Verify the applicant identity against the existing student record before linking.');
      return;
    }
    if (row.candidate_has_account) {
      setError('This student already has an account. Direct the verified applicant to account recovery.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await api(`/admin/student-registrations/${row.id}/approve`, 'POST',
        row.candidate_student_id ? { existingStudentId: row.candidate_student_id } : {});
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setLoading(false);
    }
  }

  async function reject(row: Row) {
    const reason = prompt(`Reason for rejecting ${row.full_name} (${row.roll}):`);
    if (reason === null) return;
    if (reason.trim().length < 5) {
      setError('Enter a rejection reason of at least five characters.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await api(`/admin/student-registrations/${row.id}/reject`, 'POST', { reason });
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setLoading(false);
    }
  }

  return <section className="card">
    <div className="inline">
      <label>Review status<select value={status} onChange={event => setStatus(event.target.value)}>
        <option value="PENDING_APPROVAL">Pending approval</option>
        <option value="APPROVED">Approved</option>
        <option value="REJECTED">Rejected</option>
      </select></label>
      <form className="inline" onSubmit={event => { event.preventDefault(); setAppliedSearch(search); }}>
        <input aria-label="Search registration requests" placeholder="Search name, roll, email, username"
          value={search} onChange={event => setSearch(event.target.value)} />
        <button type="submit" className="secondary">Search</button>
      </form>
      <button type="button" className="secondary" disabled={loading} onClick={() => void load()}>Refresh</button>
    </div>
    {error && <p role="alert" className="error">{error}</p>}
    {loading && <p role="status" className="notice">Loading student requests…</p>}
    {!loading && rows.length === 0 && <p className="empty">No requests match this filter.</p>}
    {rows.map(row => <article className="student-request" key={row.id}>
      <h2>{row.full_name} · {row.roll}</h2>
      <p>{row.email} · Username: {row.username}</p>
      <p>{[row.department, row.batch && `Batch ${row.batch}`].filter(Boolean).join(' · ') || 'No academic details provided'}</p>
      <small>Submitted {new Date(row.submitted_at).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' })} Asia/Dhaka · {row.status}</small>
      {row.candidate_student_id && <div className="notice">
        Existing roll match: {row.candidate_name} ({row.candidate_roll}).
        {row.candidate_has_account
          ? <p>This profile already has an account; approval is blocked. Use the account recovery process.</p>
          : <label><input type="checkbox" checked={Boolean(verified[row.id])}
            onChange={event => setVerified(current => ({ ...current, [row.id]: event.target.checked }))} />
            I verified this applicant’s identity and intend to link this exact existing profile.</label>}
      </div>}
      {row.rejection_reason && <p>Decision reason: {row.rejection_reason}</p>}
      {row.status === 'PENDING_APPROVAL' && <div className="inline">
        <button disabled={loading || Boolean(row.candidate_student_id && (row.candidate_has_account || !verified[row.id]))}
          onClick={() => void approve(row)}>Approve</button>
        <button className="danger" disabled={loading} onClick={() => void reject(row)}>Reject</button>
      </div>}
    </article>)}
  </section>;
}
