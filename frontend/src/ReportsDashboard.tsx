import React, { useEffect, useMemo, useRef, useState } from 'react';
import './reports.css';

type Props = { auth: string };
type Filters = {
  courseId: string;
  offeringId: string;
  term: string;
  batch: string;
  section: string;
  teacherId: string;
  sessionId: string;
  fromDate: string;
  toDate: string;
  fromTime: string;
  toTime: string;
  student: string;
  status: string;
};
type Option = Record<string, any>;

const timezone = 'Asia/Dhaka';
const reportTypes = [
  ['COURSE', 'Course summary'],
  ['SESSION', 'Session summary'],
  ['STUDENT', 'Student attendance summary'],
  ['DETAIL', 'Detailed attendance records'],
] as const;
const sortFields: Record<string, string[]> = {
  COURSE: ['course', 'finalizedSessions', 'records', 'present', 'absent', 'percentage'],
  SESSION: ['course', 'date', 'time', 'roster', 'present', 'absent', 'percentage'],
  STUDENT: ['roll', 'name', 'course', 'sessions', 'present', 'absent', 'percentage'],
  DETAIL: ['course', 'date', 'time', 'roll', 'name', 'status'],
};

async function fetchReportApi(auth: string, path: string): Promise<any> {
  const response = await fetch(`/api${path}`, { headers: { Authorization: `Basic ${auth}` } });
  if (!response.ok) {
    let message = await response.text();
    try { message = JSON.parse(message).message || message; } catch { /* Keep the response text. */ }
    throw new Error(message || response.statusText);
  }
  return response.json();
}

function dhakaDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  return Object.fromEntries(parts.map(part => [part.type, part.value]));
}

function monthDefaults(): Pick<Filters, 'fromDate' | 'toDate'> {
  const { year, month, day } = dhakaDateParts();
  return {
    fromDate: `${year}-${month}-01`,
    toDate: `${year}-${month}-${day}`,
  };
}

function buildQuery(filters: Filters, type: string, page = 0, size = 50, sort = 'course', direction = 'asc') {
  const query = new URLSearchParams({ type, page: String(page), size: String(size), sort, direction });
  for (const [key, value] of Object.entries(filters)) {
    if (value && !(key === 'status' && value === 'ALL')) query.set(key, value);
  }
  return query.toString();
}

function sessionLabel(session: Option): string {
  const date = String(session.class_date || '');
  const time = session.class_start_time
    ? `${String(session.class_start_time).slice(0, 5)}${session.class_end_time ? `–${String(session.class_end_time).slice(0, 5)}` : ''}`
    : 'Time not recorded';
  const offering = `${session.course_code || session.course_name} — ${session.academic_term || ''}${session.academic_year ? ` ${session.academic_year}` : ''} — Batch ${session.batch || '—'} — Section ${session.section || '—'}`;
  return `${offering} · ${date} · ${time}${session.teacher_name ? ` · ${session.teacher_name}` : ''} · #${String(session.id).slice(0, 8)}`;
}

function displayValue(value: unknown, key: string): string {
  if (value === null || value === undefined || value === '') {
    return key.includes('time') ? 'Time not recorded' : '—';
  }
  if (key === 'session_id') return `#${String(value).slice(0, 8)}`;
  if (key === 'attendance_percentage') return `${value}%`;
  if (key === 'class_start_time' || key === 'class_end_time') return String(value).slice(0, 5);
  return String(value);
}

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[character] || character));
}

export default function ReportsDashboard({ auth }: Props) {
  const initial: Filters = { courseId: '', offeringId: '', term: '', batch: '', section: '', teacherId: '', sessionId: '', ...monthDefaults(), fromTime: '', toTime: '', student: '', status: 'ALL' };
  const [draft, setDraft] = useState<Filters>(initial);
  const [applied, setApplied] = useState<Filters>(initial);
  const [type, setType] = useState<string>('COURSE');
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState('course');
  const [direction, setDirection] = useState('asc');
  const [options, setOptions] = useState<{ courses: Option[]; offerings: Option[]; teachers: Option[]; sessions: Option[] }>({ courses: [], offerings: [], teachers: [], sessions: [] });
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [optionsError, setOptionsError] = useState('');
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const requestId = useRef(0);
  const exportRequestId = useRef(0);

  const optionsQuery = useMemo(() => {
    const query = new URLSearchParams();
    if (draft.courseId) query.set('courseId', draft.courseId);
    if (draft.offeringId) query.set('offeringId', draft.offeringId);
    if (draft.term) query.set('term', draft.term);
    if (draft.batch) query.set('batch', draft.batch);
    if (draft.section) query.set('section', draft.section);
    if (draft.teacherId) query.set('teacherId', draft.teacherId);
    if (draft.fromDate) query.set('fromDate', draft.fromDate);
    if (draft.toDate) query.set('toDate', draft.toDate);
    if (draft.fromTime) query.set('fromTime', draft.fromTime);
    if (draft.toTime) query.set('toTime', draft.toTime);
    return query.toString();
  }, [draft.courseId, draft.offeringId, draft.term, draft.batch, draft.section, draft.teacherId, draft.fromDate, draft.toDate, draft.fromTime, draft.toTime]);

  useEffect(() => {
    let active = true;
    setOptionsLoading(true);
    setOptionsError('');
    fetchReportApi(auth, `/reporting/options?${optionsQuery}`).then(result => {
      if (!active) return;
      setOptions(result);
      setDraft(current => ({
        ...current,
        sessionId: result.sessions.some((session: Option) => session.id === current.sessionId)
          ? current.sessionId
          : '',
      }));
    }).catch(reason => {
      if (active) setOptionsError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => {
      if (active) setOptionsLoading(false);
    });
    return () => { active = false; };
  }, [auth, optionsQuery, reload]);

  const query = useMemo(
    () => buildQuery(applied, type, page, 50, sort, direction),
    [applied, type, page, sort, direction],
  );

  useEffect(() => {
    let active = true;
    const id = ++requestId.current;
    setLoading(true);
    setError('');
    setReport(null);
    fetchReportApi(auth, `/reporting?${query}`).then(result => {
      if (active && id === requestId.current) setReport(result);
    }).catch(reason => {
      if (active && id === requestId.current) setError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => {
      if (active && id === requestId.current) setLoading(false);
    });
    return () => { active = false; };
  }, [auth, query, reload]);

  function changeParent(key: 'courseId' | 'offeringId' | 'term' | 'batch' | 'section' | 'teacherId' | 'fromDate' | 'toDate' | 'fromTime' | 'toTime', value: string) {
    setDraft(current => ({ ...current, [key]: value, sessionId: '' }));
  }

  function applyFilters(event: React.FormEvent) {
    event.preventDefault();
    if (draft.fromDate && draft.toDate && draft.fromDate > draft.toDate) {
      setError('From date must not be after To date.');
      return;
    }
    if ((!draft.fromDate || !draft.toDate || draft.fromDate === draft.toDate)
      && draft.fromTime && draft.toTime && draft.fromTime > draft.toTime) {
      setError('From date/time must not be after To date/time.');
      return;
    }
    setPage(0);
    setApplied({ ...draft });
  }

  function resetFilters() {
    const reset: Filters = { courseId: '', offeringId: '', term: '', batch: '', section: '', teacherId: '', sessionId: '', ...monthDefaults(), fromTime: '', toTime: '', student: '', status: 'ALL' };
    setDraft(reset);
    setApplied(reset);
    setPage(0);
    setSort('course');
    setDirection('asc');
  }

  function sortBy(field: string) {
    if (sort === field) setDirection(current => current === 'asc' ? 'desc' : 'asc');
    else {
      setSort(field);
      setDirection('asc');
    }
    setPage(0);
  }

  async function downloadCsv() {
    const id = ++exportRequestId.current;
    setError('');
    try {
      const response = await fetch(`/api/reporting/export.csv?${buildQuery(applied, type, 0, 50, sort, direction)}`, {
        headers: { Authorization: `Basic ${auth}` },
      });
      if (!response.ok) throw new Error(await response.text() || 'CSV export failed.');
      const blob = await response.blob();
      if (id !== exportRequestId.current) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'attendance-report.csv';
      link.click();
      URL.revokeObjectURL(url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function printAll() {
    const popup = window.open('', '_blank');
    if (!popup) {
      setError('Allow pop-ups to print or save this report as PDF.');
      return;
    }
    setError('');
    try {
      const response = await fetch(`/api/reporting/export-data?${buildQuery(applied, type, 0, 50, sort, direction)}`, {
        headers: { Authorization: `Basic ${auth}` },
      });
      if (!response.ok) throw new Error(await response.text() || 'Report export failed.');
      const data = await response.json();
      const columns = Object.keys(data.rows[0] || {});
      const summary = Object.entries(data.summary || {}).map(([key, value]) => `<li><strong>${escapeHtml(key)}:</strong> ${escapeHtml(value ?? '—')}</li>`).join('');
      const filterText = Object.entries(data.filters || {}).filter(([, value]) => value !== null && value !== '').map(([key, value]) => `${key}: ${value}`).join(' · ') || 'All permitted records';
      const table = `<table><thead><tr>${columns.map(column => `<th>${escapeHtml(column.replaceAll('_', ' '))}</th>`).join('')}</tr></thead><tbody>${data.rows.map((row: Option) => `<tr>${columns.map(column => `<td>${escapeHtml(displayValue(row[column], column))}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
      popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(data.title)}</title><style>body{font:12px Arial,sans-serif;color:#17233e;padding:24px}h1{font-size:20px}table{width:100%;border-collapse:collapse;margin-top:18px}th,td{border:1px solid #ccd3df;padding:6px;text-align:left}th{background:#edf0f7}ul{columns:2} @media print{body{padding:0}tr{break-inside:avoid}thead{display:table-header-group}}</style></head><body><h1>${escapeHtml(data.title)}</h1><p>${escapeHtml(filterText)}<br>Timezone: ${escapeHtml(data.timezone)} · Generated: ${escapeHtml(data.generatedAt)}</p><ul>${summary}</ul>${table}<script>window.onload=()=>window.print()</script></body></html>`);
      popup.document.close();
    } catch (reason) {
      popup.close();
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  const rows: Option[] = report?.rows || [];
  const summary = report?.summary || {};
  const headers: Record<string, string> = {
    course_code: 'Course code',
    course_name: 'Course',
    academic_term: 'Term',
    academic_year: 'Year',
    batch: 'Batch',
    section: 'Section',
    teacher_name: 'Actual session teacher',
    offering_id: 'Offering',
    finalized_sessions: 'Finalized sessions',
    student_session_records: 'Student-session records',
    session_id: 'Session',
    class_date: 'Class date',
    class_start_time: 'Class start',
    class_end_time: 'Class end',
    roster_count: 'Roster count',
    eligible_sessions: 'Eligible finalized sessions',
    student_name: 'Student name',
    roll: 'Student roll',
    present_count: 'Present',
    absent_count: 'Absent',
    attendance_percentage: 'Attendance %',
    state: 'Status',
  };
  const visibleColumns: string[] = type === 'COURSE'
    ? ['course_code', 'course_name', 'finalized_sessions', 'student_session_records', 'present_count', 'absent_count', 'attendance_percentage']
    : type === 'SESSION'
      ? ['course_code', 'course_name', 'academic_term', 'academic_year', 'batch', 'section', 'teacher_name', 'session_id', 'class_date', 'class_start_time', 'class_end_time', 'roster_count', 'present_count', 'absent_count', 'attendance_percentage']
      : type === 'STUDENT'
        ? ['roll', 'student_name', 'course_code', 'course_name', 'academic_term', 'academic_year', 'batch', 'section', 'eligible_sessions', 'present_count', 'absent_count', 'attendance_percentage']
        : ['course_code', 'course_name', 'academic_term', 'academic_year', 'batch', 'section', 'teacher_name', 'session_id', 'class_date', 'class_start_time', 'class_end_time', 'roll', 'student_name', 'state'];
  const totalPages = report ? Math.ceil(report.totalRows / report.size) : 0;
  const selectedSession = options.sessions.find(session => session.id === draft.sessionId);
  const appliedSession = options.sessions.find(session => session.id === applied.sessionId);
  const appliedOffering = options.offerings.find(offering => offering.id === applied.offeringId);

  return (
    <section className="reports-dashboard">
      <div className="card">
        <h2>Attendance reports</h2>
        <p>Reports use saved historical session rosters and FINALIZED sessions only. Dates and times use Asia/Dhaka. Time filters use recorded class start times and exclude sessions where time was not recorded.</p>
        <div className="report-tabs" role="tablist" aria-label="Report type">
          {reportTypes.map(([key, label]) => (
            <button type="button" className={type === key ? 'active' : 'secondary'} role="tab" aria-selected={type === key} key={key} onClick={() => { setType(key); setPage(0); }}>
              {label}
            </button>
          ))}
        </div>
        <form className="report-filters" onSubmit={applyFilters}>
          <label>Course
            <select value={draft.courseId} onChange={event => changeParent('courseId', event.target.value)}>
              <option value="">All permitted courses</option>
              {options.courses.map(course => <option key={course.id} value={course.id}>{course.course_code ? `${course.course_code} — ` : ''}{course.name}</option>)}
            </select>
          </label>
          <label>Academic term<input value={draft.term} onChange={event => changeParent('term', event.target.value)} placeholder="e.g. Fall"/></label>
          <label>Offering
            <select value={draft.offeringId} onChange={event => changeParent('offeringId', event.target.value)} disabled={optionsLoading}>
              <option value="">All matching offerings</option>
              {options.offerings.map(offering => <option key={offering.id} value={offering.id}>
                {offering.course_code} — {offering.academic_term}{offering.academic_year ? ` ${offering.academic_year}` : ''} — Batch {offering.batch} — Section {offering.section}
              </option>)}
            </select>
          </label>
          <label>Batch<input value={draft.batch} onChange={event => changeParent('batch', event.target.value)} placeholder="All batches"/></label>
          <label>Section<input value={draft.section} onChange={event => changeParent('section', event.target.value)} placeholder="All sections"/></label>
          <label>Actual session teacher
            <select value={draft.teacherId} onChange={event => changeParent('teacherId', event.target.value)} disabled={optionsLoading}>
              <option value="">All session teachers</option>
              {options.teachers.map(teacher => <option key={teacher.id} value={teacher.id}>{teacher.display_name}</option>)}
            </select>
          </label>
          <label>Session
            <select value={draft.sessionId} onChange={event => setDraft(current => ({ ...current, sessionId: event.target.value }))} disabled={optionsLoading}>
              <option value="">All matching sessions</option>
              {options.sessions.map(session => <option key={session.id} value={session.id}>{sessionLabel(session)}</option>)}
            </select>
          </label>
          <label>From date<input type="date" value={draft.fromDate} onChange={event => changeParent('fromDate', event.target.value)}/></label>
          <label>To date<input type="date" value={draft.toDate} onChange={event => changeParent('toDate', event.target.value)}/></label>
          <label>Class start from<input type="time" value={draft.fromTime} onChange={event => changeParent('fromTime', event.target.value)}/></label>
          <label>Class start to<input type="time" value={draft.toTime} onChange={event => changeParent('toTime', event.target.value)}/></label>
          <label>Student name or roll<input value={draft.student} maxLength={120} onChange={event => setDraft(current => ({ ...current, student: event.target.value }))} placeholder="Search students"/></label>
          <label>Attendance status
            <select value={draft.status} onChange={event => setDraft(current => ({ ...current, status: event.target.value }))}>
              <option value="ALL">All</option><option value="PRESENT">Present</option><option value="ABSENT">Absent</option>
            </select>
          </label>
          <div className="inline filter-actions">
            <button type="submit" disabled={loading}>Apply filters</button>
            <button type="button" className="secondary" onClick={resetFilters}>Reset</button>
          </div>
        </form>
        {optionsError && <p role="alert" className="error">{optionsError} <button type="button" className="secondary" onClick={() => setReload(value => value + 1)}>Retry options</button></p>}
      </div>

      <div className="card applied-filters">
        <strong>Applied filters</strong>
        <span>Course: {options.courses.find(course => course.id === applied.courseId)?.name || 'All permitted courses'}</span>
        <span>Term: {applied.term || 'All terms'}</span>
        <span>Offering: {appliedOffering
          ? `${appliedOffering.course_code} — ${appliedOffering.academic_term}${appliedOffering.academic_year ? ` ${appliedOffering.academic_year}` : ''} — Batch ${appliedOffering.batch} — Section ${appliedOffering.section}`
          : (applied.offeringId ? `#${applied.offeringId.slice(0, 8)}` : 'All matching offerings')}</span>
        <span>Batch: {applied.batch || 'All batches'}</span>
        <span>Section: {applied.section || 'All sections'}</span>
        <span>Actual teacher: {options.teachers.find(teacher => teacher.id === applied.teacherId)?.display_name
          || (applied.teacherId ? `#${applied.teacherId.slice(0, 8)}` : 'All session teachers')}</span>
        <span>Session: {appliedSession ? sessionLabel(appliedSession) : applied.sessionId ? `#${applied.sessionId.slice(0, 8)}` : 'All matching sessions'}</span>
        <span>Dates: {applied.fromDate || 'Any'} – {applied.toDate || 'Any'}</span>
        <span>Start time: {applied.fromTime || 'Any'} – {applied.toTime || 'Any'}</span>
        <span>Student: {applied.student || 'All'}</span>
        <span>Status: {type === 'DETAIL' ? applied.status : 'All (status does not change summary denominators)'}</span>
      </div>

      {error && <div role="alert" className="error">{error} <button type="button" className="secondary" onClick={() => setReload(value => value + 1)}>Retry</button></div>}
      {loading ? <div role="status" className="notice">Loading report…</div> : report && (
        <>
          <div className="stats report-stats">
            {[
              ['Finalized sessions', summary.finalizedSessions],
              ['Distinct students', summary.distinctStudents],
              ['Present student-session records', summary.presentRecords],
              ['Absent student-session records', summary.absentRecords],
              ['Attendance percentage', summary.attendancePercentage == null ? '—' : `${summary.attendancePercentage}%`],
            ].map(([label, value]) => <div className="card" key={label}><small>{label}</small><h2>{value ?? 0}</h2></div>)}
          </div>
          <div className="inline report-actions">
            <button type="button" onClick={downloadCsv}>Export CSV</button>
            <button type="button" className="secondary" onClick={printAll}>Export PDF</button>
            <button type="button" className="secondary" onClick={printAll}>Print</button>
            <span className="timezone-note">{timezone} · Generated {report.generatedAt}</span>
          </div>
          {rows.length === 0 ? <div className="card empty">No finalized attendance records match the applied filters.</div> : (
            <div className="card report-table-card">
              <div className="report-table-wrap"><table>
                <thead><tr>{visibleColumns.map(column => <th key={column}><button type="button" className="sort-button" onClick={() => sortBy(sortFields[type].find(field => {
                  const keyMap: Record<string, string> = { course: 'course_name', finalizedSessions: 'finalized_sessions', records: 'student_session_records', present: 'present_count', absent: 'absent_count', percentage: 'attendance_percentage', date: 'class_date', time: 'class_start_time', roster: 'roster_count', roll: 'roll', name: 'student_name', sessions: 'eligible_sessions', status: 'state' };
                  return keyMap[field] === column;
                }) || 'course')}>{headers[column] || column}{sortFields[type].some(field => {
                  const keyMap: Record<string, string> = { course: 'course_name', finalizedSessions: 'finalized_sessions', records: 'student_session_records', present: 'present_count', absent: 'absent_count', percentage: 'attendance_percentage', date: 'class_date', time: 'class_start_time', roster: 'roster_count', roll: 'roll', name: 'student_name', sessions: 'eligible_sessions', status: 'state' };
                  return keyMap[field] === column && sort === field;
                }) ? direction === 'asc' ? ' ↑' : ' ↓' : ''}</button></th>)}</tr></thead>
                <tbody>{rows.map((row, index) => <tr key={`${row.session_id || row.course_id || row.student_id}-${row.student_id || index}`}>{visibleColumns.map(column => <td key={column}>{displayValue(row[column], column)}</td>)}</tr>)}</tbody>
              </table></div>
              <div className="inline pagination">
                <span>{report.totalRows} matching rows · Page {page + 1} of {Math.max(totalPages, 1)}</span>
                <button type="button" className="secondary" disabled={page === 0} onClick={() => setPage(current => current - 1)}>Previous</button>
                <button type="button" className="secondary" disabled={page + 1 >= totalPages} onClick={() => setPage(current => current + 1)}>Next</button>
              </div>
            </div>
          )}
        </>
      )}
      {selectedSession && !optionsLoading && <span className="sr-only">Selected {sessionLabel(selectedSession)}</span>}
    </section>
  );
}
