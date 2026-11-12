import { useEffect, useState } from 'react';
import './attendance-ai-settings.css';

type Settings = {
  threshold: number;
  saved: boolean;
};

type Props = {
  api: (path: string, method?: string, body?: any) => Promise<any>;
  onSaved: (threshold: number) => void;
};

const DEFAULT_THRESHOLD = 70;

export default function AttendanceAiSettings({ api, onSaved }: Props) {
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    let active = true;
    api('/me/recognition-settings').then((settings: Settings) => {
      if (!active) return;
      setThreshold(settings.threshold);
      setSaved(settings.saved);
      onSaved(settings.threshold);
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => { active = false; };
  }, [api, onSaved]);

  async function persist(body: { threshold: number } | { reset: true }) {
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const settings: Settings = await api('/me/recognition-settings', 'PUT', body);
      setThreshold(settings.threshold);
      setSaved(settings.saved);
      onSaved(settings.threshold);
      setStatus(settings.saved ? 'Threshold saved for your account.' : 'Reset to the default threshold.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card ai-settings" aria-labelledby="ai-settings-title">
      <h2 id="ai-settings-title">Attendance AI Settings</h2>
      <p>These settings apply to your future classroom photo analyses only.</p>
      <p className="notice">
        A higher threshold requires stronger similarity and may leave more faces for manual review.
        Similarity is not an accuracy probability.
      </p>
      <label htmlFor="recognition-threshold-number">
        Minimum similarity for automatic selection
        <div className="threshold-controls">
          <input
            id="recognition-threshold-range"
            aria-label="Minimum similarity percentage slider"
            type="range"
            min="1"
            max="100"
            step="0.1"
            value={threshold}
            disabled={busy}
            onChange={event => setThreshold(Number(event.target.value))}
          />
          <input
            id="recognition-threshold-number"
            aria-label="Minimum similarity percentage"
            type="number"
            min="1"
            max="100"
            step="0.1"
            value={threshold}
            disabled={busy}
            onChange={event => setThreshold(Number(event.target.value))}
          />
          <span>%</span>
        </div>
      </label>
      <p className="threshold-saved">
        {saved ? 'Your personal threshold is saved.' : `Using the default threshold of ${DEFAULT_THRESHOLD}%.`}
      </p>
      {error && <p role="alert" className="error">{error}</p>}
      {status && <p role="status" className="notice">{status}</p>}
      <div className="inline">
        <button disabled={busy || !Number.isFinite(threshold) || threshold < 1 || threshold > 100}
          onClick={() => persist({ threshold })}>Save</button>
        <button className="secondary" disabled={busy}
          onClick={() => persist({ reset: true })}>Reset to default</button>
      </div>
    </section>
  );
}
