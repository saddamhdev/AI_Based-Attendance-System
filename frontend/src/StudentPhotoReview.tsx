import { useEffect, useState } from 'react';

type Row = Record<string, any>;
type Api = (path: string, method?: string, body?: any) => Promise<any>;

type Preview = { id: string; url: string; index: number };

export default function StudentPhotoReview({ api, auth }: { api: Api; auth: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState('');
  const [photos, setPhotos] = useState<Preview[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const submissions = await api('/admin/face-submissions');
      setRows(submissions);
      setSelected(current => submissions.some((row: Row) => row.enrollment_id === current)
        ? current : submissions[0]?.enrollment_id || '');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  useEffect(() => {
    if (!selected) {
      setPhotos([]);
      return;
    }
    let active = true;
    const urls: string[] = [];
    setPhotos([]);
    api(`/admin/face-submissions/${selected}/photos`).then(async (metadata: Row[]) => {
      const previews = await Promise.all(metadata.map(async photo => {
        const response = await fetch(
          `/api/admin/face-submissions/${selected}/photos/${photo.id}/thumbnail`,
          { headers: { Authorization: `Basic ${auth}` } });
        if (!response.ok) throw new Error(`Could not load photo ${photo.photo_index + 1}`);
        const url = URL.createObjectURL(await response.blob());
        urls.push(url);
        return { id: photo.id, index: photo.photo_index, url };
      }));
      if (active) setPhotos(previews);
    }).catch(reason => {
      if (active) setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => {
      active = false;
      urls.forEach(URL.revokeObjectURL);
    };
  }, [selected, api, auth]);

  async function review(action: 'approve' | 'reject') {
    if (!selected) return;
    let reason: string | undefined;
    if (action === 'reject') {
      reason = prompt('Provide a reason for rejecting these face photos:') || undefined;
      if (!reason) return;
      if (reason.trim().length < 5) {
        setError('Enter a rejection reason of at least five characters.');
        return;
      }
    } else {
      const applicant = rows.find(row => row.enrollment_id === selected);
      if (!confirm(`Approve ${applicant?.name} (${applicant?.roll}) face photos for biometric recognition? Verify the identity first.`)) return;
    }
    setLoading(true);
    setError('');
    try {
      await api(`/admin/face-submissions/${selected}/${action}`, 'POST',
        action === 'reject' ? { reason } : {});
      setPhotos([]);
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setLoading(false);
    }
  }

  return <section className="card">
    <h2>Student face-photo review</h2>
    <p>Account approval and biometric approval are separate. Verify identity before activating an embedding.</p>
    {error && <p role="alert" className="error">{error}</p>}
    {loading && <p role="status" className="notice">Loading photo submissions…</p>}
    {!loading && rows.length === 0 && <p className="empty">No photo submissions are waiting for review.</p>}
    {rows.length > 0 && <>
      <label>Submission<select value={selected} onChange={event => setSelected(event.target.value)}>
        {rows.map(row => <option key={row.enrollment_id} value={row.enrollment_id}>
          {row.name} · {row.roll} · {row.accepted_photo_count} photos
        </option>)}
      </select></label>
      {rows.filter(row => row.enrollment_id === selected).map(row => <div key={row.enrollment_id}>
        <p>{row.email} · Submitted {new Date(row.created_at).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' })} Asia/Dhaka</p>
        <div className="preview-strip">{photos.map(photo => <figure key={photo.id}>
          <img src={photo.url} alt={`Submitted face photo ${photo.index + 1}`} />
          <figcaption>Photo {photo.index + 1}</figcaption>
        </figure>)}</div>
        <div className="inline">
          <button type="button" disabled={loading || photos.length !== row.accepted_photo_count}
            onClick={() => void review('approve')}>Verify identity and approve</button>
          <button type="button" className="danger" disabled={loading} onClick={() => void review('reject')}>Reject</button>
        </div>
      </div>)}
    </>}
  </section>;
}
