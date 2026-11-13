/** Percentages are computed by the backend from summed counts; null means no finalized classes. */
export function percent(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(1)}%` : '—';
}

export function time(value: string | null | undefined): string {
  return value ? String(value).slice(0, 5) : '—';
}

export function date(value: string | null | undefined): string {
  return value ? String(value).slice(0, 10) : '—';
}

export function dateTime(value: string | null | undefined): string {
  return value ? String(value).slice(0, 16).replace('T', ' ') : '—';
}

export function classTime(row: { class_date: string; class_start_time: string | null; class_end_time: string | null }) {
  return `${date(row.class_date)} · ${time(row.class_start_time)}–${time(row.class_end_time)}`;
}

/** Local calendar date as YYYY-MM-DD. */
export function isoDate(value: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

export function isoTime(value: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

export function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}
