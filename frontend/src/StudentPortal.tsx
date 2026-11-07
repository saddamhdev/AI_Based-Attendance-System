import { useEffect, useMemo, useState } from 'react';

type Row = Record<string, any>;
type Api = (path: string, method?: string, body?: any) => Promise<any>;
type Filters = { offeringId: string; fromDate: string; toDate: string; status: string };

const emptyFilters: Filters = { offeringId: '', fromDate: '', toDate: '', status: 'ALL' };
const dhakaDate = (value: string) => value
  ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', dateStyle: 'medium' }).format(new Date(`${value.slice(0, 10)}T12:00:00+06:00`))
  : 'Time not recorded';
const time = (value: unknown) => value ? String(value).slice(0, 5) : 'Time not recorded';

type GalleryProps = { enrollmentId: string; auth: string; api: Api };

function StudentPhotoGallery({ enrollmentId, auth, api }: GalleryProps) {
  const [images, setImages] = useState<Array<{ id: string; url: string; index: number }>>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const urls: string[] = [];
    api(`/student/faces/${enrollmentId}/photos`).then(async (metadata: Row[]) => {
      const loaded = await Promise.all(metadata.map(async photo => {
        const response = await fetch(`/api/student/faces/${enrollmentId}/photos/${photo.id}/thumbnail`, {
          headers: { Authorization: `Basic ${auth}` },
        });
        if (!response.ok) throw new Error(`Could not load photo ${photo.photo_index + 1}`);
        const url = URL.createObjectURL(await response.blob());
        urls.push(url);
        return { id: photo.id, index: photo.photo_index, url };
      }));
      if (active) setImages(loaded);
    }).catch(reason => {
      if (active) setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => {
      active = false;
      urls.forEach(URL.revokeObjectURL);
    };
  }, [enrollmentId, auth, api]);

  return <div className="preview-strip">
    {error && <p role="alert" className="error">{error}</p>}
    {images.map(image => <figure key={image.id}><img src={image.url} alt={`Saved face photo ${image.index + 1}`} />
      <figcaption>Photo {image.index + 1}</figcaption></figure>)}
  </div>;
}

type Props = {
  api: Api;
  auth: string;
  me: Row;
  onLogout: () => void;
  onPasswordChanged: () => Promise<void>;
};

export default function StudentPortal({ api, auth, me, onLogout, onPasswordChanged }: Props) {
  const [page, setPage] = useState('Dashboard');
  const [applied, setApplied] = useState(emptyFilters);
  const [draftFilters, setDraftFilters] = useState(emptyFilters);
  const [dashboard, setDashboard] = useState<Row | null>(null);
  const [history, setHistory] = useState<Row[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyPage, setHistoryPage] = useState(0);
  const [faces, setFaces] = useState<Row[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [consent, setConsent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [savingPhotos, setSavingPhotos] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [password, setPassword] = useState({ current: '', next: '', confirm: '' });
  const [offerings, setOfferings] = useState<Row[]>([]);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (applied.offeringId) params.set('offeringId', applied.offeringId);
    if (applied.fromDate) params.set('fromDate', applied.fromDate);
    if (applied.toDate) params.set('toDate', applied.toDate);
    return params.toString();
  }, [applied.offeringId, applied.fromDate, applied.toDate]);

  useEffect(() => {
    const urls = selectedFiles.map(file => URL.createObjectURL(file));
    setPreviews(urls);
    return () => urls.forEach(URL.revokeObjectURL);
  }, [selectedFiles]);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [courseRows, summary] = await Promise.all([
        api('/student/courses'),
        api(`/student/dashboard${query ? `?${query}` : ''}`),
      ]);
      setOfferings(courseRows);
      setDashboard(summary);
      if (page === 'Attendance History') {
        const params = new URLSearchParams(query);
        params.set('status', applied.status);
        params.set('page', String(historyPage));
        params.set('size', '25');
        const data = await api(`/student/attendance?${params}`);
        setHistory(data.rows);
        setHistoryTotal(data.total);
      }
      if (page === 'My Face Photos') setFaces(await api('/student/faces'));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!me.mustChangePassword) void load();
  }, [page, query, applied.status, historyPage, me.mustChangePassword]);

  async function submitPhotos(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedFiles.length < 5 || selectedFiles.length > 10) {
      setError('Select between five and ten photos.');
      return;
    }
    if (!consent) {
      setError('Read the biometric-use explanation and give explicit consent before submitting photos.');
      return;
    }
    const body = new FormData();
    selectedFiles.forEach(file => body.append('images', file));
    body.append('consent', 'true');
    setSavingPhotos(true);
    setError('');
    setNotice('');
    try {
      await api('/student/faces', 'POST', body);
      setSelectedFiles([]);
      setConsent(false);
      setNotice('Photos were processed and submitted for administrator review. They are not active for recognition yet.');
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSavingPhotos(false);
    }
  }

  async function withdrawConsent() {
    if (!confirm('Withdraw biometric consent? Recognition will be blocked immediately and any active embedding will be removed.')) return;
    setLoading(true);
    setError('');
    try {
      await api('/student/consent', 'DELETE');
      setNotice('Consent withdrawn. Face matching is disabled for your account.');
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }

  async function cancelSubmission(enrollmentId: string) {
    if (!confirm('Cancel this pending photo submission? The photos will be retained for up to 90 days for review and then purged.')) return;
    setLoading(true);
    setError('');
    try {
      const result = await api(`/student/faces/${enrollmentId}`, 'DELETE');
      setNotice(result.cleanupPending
        ? 'Submission cancelled. Biometric cleanup is queued for retry.'
        : 'Submission cancelled.');
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }

  async function exportHistory() {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/student/attendance.csv${query ? `?${query}` : ''}`, {
        headers: { Authorization: `Basic ${auth}` },
      });
      if (!response.ok) throw new Error(await response.text() || 'Could not export attendance.');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = 'student-attendance.csv';
      link.click();
      URL.revokeObjectURL(url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }

  async function changePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    try {
      await api('/account/password', 'PUT', {
        currentPassword: password.current,
        newPassword: password.next,
        confirmPassword: password.confirm,
      });
      setPassword({ current: '', next: '', confirm: '' });
      await onPasswordChanged();
      setNotice('Password changed.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  if (me.mustChangePassword) {
    return <main className="login"><form className="card" onSubmit={changePassword}>
      <span className="brand">◉ Attend</span><h1>Change temporary password</h1>
      <p>Set a new password before using the student portal.</p>
      <label>Temporary password<input type="password" autoComplete="current-password" required
        value={password.current} onChange={event => setPassword({ ...password, current: event.target.value })} /></label>
      <label>New password<input type="password" minLength={12} maxLength={128} autoComplete="new-password" required
        value={password.next} onChange={event => setPassword({ ...password, next: event.target.value })} /></label>
      <label>Confirm new password<input type="password" minLength={12} maxLength={128} autoComplete="new-password" required
        value={password.confirm} onChange={event => setPassword({ ...password, confirm: event.target.value })} /></label>
      <button type="submit">Update password</button>
      {error && <p role="alert" className="error">{error}</p>}
      <button type="button" className="secondary" onClick={onLogout}>Sign out</button>
    </form></main>;
  }

  const stats = dashboard?.totals || {};
  const total = Number(stats.eligible_records || 0);
  const currentPageCount = Math.max(1, Math.ceil(historyTotal / 25));

  return <div className="shell">
    <aside><div className="brand">◉ Attend</div><small>STUDENT PORTAL</small>
      {['Dashboard', 'My Courses', 'Attendance History', 'My Face Photos', 'Profile'].map(tab =>
        <button key={tab} className={page === tab ? 'active' : 'nav'} onClick={() => setPage(tab)}>{tab}</button>)}
      <footer>{me.username}<br /><button className="nav" onClick={onLogout}>Sign out</button></footer>
    </aside>
    <main>
      <header><div><small>STUDENT WORKSPACE</small><h1>{page}</h1></div><span className="pill">{me.roll}</span></header>
      {error && <p role="alert" className="error">{error}</p>}
      {notice && <p role="status" className="notice">{notice}</p>}
      {loading && <p role="status" className="notice">Loading your information…</p>}
      <form className="card inline" onSubmit={event => {
        event.preventDefault();
        if (draftFilters.fromDate && draftFilters.toDate && draftFilters.fromDate > draftFilters.toDate) {
          setError('From date must not be after To date.');
          return;
        }
        setError('');
        setHistoryPage(0);
        setApplied({ ...draftFilters });
      }}>
        <select aria-label="Filter by course offering" value={draftFilters.offeringId}
          onChange={event => setDraftFilters({ ...draftFilters, offeringId: event.target.value })}>
          <option value="">All offerings</option>
          {offerings.map(offering => <option key={offering.offering_id} value={offering.offering_id}>{offering.offering_label}</option>)}
        </select>
        <label>From<input type="date" value={draftFilters.fromDate} onChange={event => setDraftFilters({ ...draftFilters, fromDate: event.target.value })} /></label>
        <label>To<input type="date" value={draftFilters.toDate} onChange={event => setDraftFilters({ ...draftFilters, toDate: event.target.value })} /></label>
        {page === 'Attendance History' && <select aria-label="Filter attendance status" value={draftFilters.status}
          onChange={event => setDraftFilters({ ...draftFilters, status: event.target.value })}>
          <option value="ALL">All statuses</option><option value="PRESENT">Present</option><option value="ABSENT">Absent</option>
        </select>}
        <button type="submit" disabled={loading}>Apply filters</button>
        <button type="button" className="secondary" onClick={() => {
          setDraftFilters(emptyFilters); setApplied(emptyFilters); setHistoryPage(0); setError('');
        }}>Reset</button>
      </form>

      {page === 'Dashboard' && <>
        <div className="stats">
          {[['Finalized classes', stats.finalized_sessions ?? 0], ['Present', stats.present_count ?? 0],
            ['Absent', stats.absent_count ?? 0], ['Attendance', total ? `${dashboard?.attendancePercentage?.toFixed?.(1) ?? '0.0'}%` : '—']]
            .map(([label, value]) => <div className="card" key={label}><small>{label}</small><h2>{value}</h2></div>)}
        </div>
        {dashboard?.noFinalizedClasses && <p className="empty">No finalized classes yet.</p>}
        <section className="card"><h2>Attendance by offering</h2>
          {(dashboard?.attendanceByOffering || []).length === 0 ? <p className="empty">No finalized attendance in this filter.</p> :
            <div className="table-scroll"><table><thead><tr><th>Offering</th><th>Classes</th><th>Present</th><th>Absent</th><th>Attendance</th></tr></thead>
              <tbody>{dashboard?.attendanceByOffering?.map((row: Row) => <tr key={row.offering_id}>
                <td>{row.offering_label}</td><td>{row.finalized_sessions}</td><td>{row.present_count}</td><td>{row.absent_count}</td>
                <td>{row.attendance_percentage == null ? '—' : `${Number(row.attendance_percentage).toFixed(1)}%`}</td>
              </tr>)}</tbody></table></div>}
        </section>
        <section className="card"><h2>Recent attendance</h2>{(dashboard?.recentAttendance || []).length === 0
          ? <p className="empty">No finalized attendance records in this filter.</p>
          : <AttendanceTable rows={dashboard?.recentAttendance || []} />}
        </section>
      </>}

      {page === 'My Courses' && <section className="card"><h2>Current course offerings</h2>
        {offerings.length === 0 ? <p className="empty">You are not currently enrolled in any active offerings.</p> :
          offerings.map(offering => {
            const result = (dashboard?.attendanceByOffering || []).find((row: Row) => row.offering_id === offering.offering_id);
            return <article className="session" key={offering.offering_id}><div><strong>{offering.offering_label}</strong>
              <small>Teacher(s): {offering.teachers || 'Not assigned'}</small></div>
              <span>{result ? `${result.present_count}/${result.eligible_records} present · ${result.attendance_percentage == null ? '—' : `${Number(result.attendance_percentage).toFixed(1)}%`}` : 'No finalized classes yet'}</span>
            </article>;
          })}
      </section>}

      {page === 'Attendance History' && <section className="card">
        <div className="inline"><h2>Finalized attendance history</h2><button type="button" className="secondary" disabled={loading} onClick={() => void exportHistory()}>Export CSV</button></div>
        {history.length === 0 ? <p className="empty">No attendance records match these filters.</p> : <AttendanceTable rows={history} />}
        <div className="inline"><button className="secondary" disabled={historyPage === 0 || loading} onClick={() => setHistoryPage(value => value - 1)}>Previous</button>
          <span>Page {historyPage + 1} of {currentPageCount} · {historyTotal} records</span>
          <button className="secondary" disabled={historyPage + 1 >= currentPageCount || loading} onClick={() => setHistoryPage(value => value + 1)}>Next</button></div>
      </section>}

      {page === 'My Face Photos' && <>
        <section className="card">
          <h2>Biometric photo submissions</h2>
          <p>Face photos are optional. If you choose to use them, the service validates one detectable face per photo. Submitted photos and embeddings are not used for attendance until an administrator verifies your identity and approves them. Consent can be withdrawn at any time.</p>
          <form onSubmit={submitPhotos}>
            <label className="upload">Choose 5–10 JPEG or PNG photos
              <input type="file" accept="image/jpeg,image/png" multiple disabled={savingPhotos}
                onChange={event => {
                  const files = Array.from(event.currentTarget.files || []);
                  event.currentTarget.value = '';
                  if (files.length > 10) { setError('Choose no more than ten photos.'); return; }
                  setError(''); setSelectedFiles(files);
                }} />
            </label>
            {selectedFiles.length > 0 && <p>{selectedFiles.length} photo(s) selected</p>}
            <div className="preview-strip">{previews.map((url, index) => <figure key={url}>
              <img src={url} alt={`Selected photo ${index + 1}`} />
              <button type="button" className="secondary" disabled={savingPhotos}
                onClick={() => setSelectedFiles(current => current.filter((_, fileIndex) => index !== fileIndex))}>Remove</button>
            </figure>)}</div>
            <label className="consent-text"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} />
              I consent to processing of these face photos to create a biometric template for attendance matching. I understand this is optional and I can withdraw consent.</label>
            <button type="submit" disabled={savingPhotos || selectedFiles.length < 5 || selectedFiles.length > 10}>
              {savingPhotos ? 'Processing photos…' : 'Submit for admin review'}
            </button>
          </form>
          {dashboard?.profile?.consent && <button className="danger" type="button" disabled={loading} onClick={() => void withdrawConsent()}>Withdraw biometric consent</button>}
        </section>
        <section className="card"><h2>My submissions</h2>
          {faces.length === 0 ? <p className="empty">No face-photo submissions.</p> : faces.map(face => <article className="student-request" key={face.id}>
            <div className="inline"><strong>{face.status.replaceAll('_', ' ')}</strong><span>{face.accepted_photo_count || 0} photos · {new Date(face.created_at).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' })} Asia/Dhaka</span></div>
            {face.rejection_reason && <p>Review note: {face.rejection_reason}</p>}
            {['ACTIVE', 'PENDING_REVIEW'].includes(face.status) &&
              <StudentPhotoGallery key={face.id} enrollmentId={face.id} auth={auth} api={api} />}
            {face.status === 'PENDING_REVIEW' && <button type="button" className="danger" disabled={loading}
              onClick={() => void cancelSubmission(face.id)}>Cancel pending submission</button>}
          </article>)}
        </section>
      </>}

      {page === 'Profile' && <section className="card"><h2>My profile</h2>
        <dl><dt>Name</dt><dd>{dashboard?.profile?.name || me.name}</dd>
          <dt>Roll</dt><dd>{dashboard?.profile?.roll || me.roll}</dd>
          <dt>Email</dt><dd>{dashboard?.profile?.email || 'Not recorded'}</dd>
          <dt>Department</dt><dd>{dashboard?.profile?.department || 'Not recorded'}</dd>
          <dt>Batch</dt><dd>{dashboard?.profile?.batch || 'Not recorded'}</dd>
          <dt>Account status</dt><dd>{dashboard?.profile?.account_status || 'APPROVED'}</dd></dl>
      </section>}
    </main>
  </div>;
}

function AttendanceTable({ rows }: { rows: Row[] }) {
  return <div className="table-scroll"><table><thead><tr>
    <th>Offering</th><th>Class date</th><th>Time</th><th>Teacher</th><th>Status</th>
  </tr></thead><tbody>{rows.map(row => <tr key={row.session_id}>
    <td>{row.offering_label}</td><td>{dhakaDate(row.class_date)}</td>
    <td>{time(row.class_start_time)}–{time(row.class_end_time)}</td>
    <td>{row.teacher_name || 'Teacher unknown'}</td><td>{row.attendance_status}</td>
  </tr>)}</tbody></table></div>;
}
