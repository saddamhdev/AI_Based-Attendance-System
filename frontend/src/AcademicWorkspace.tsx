import { useEffect, useMemo, useState } from 'react';

type Row = Record<string, any>;
type Api = (path: string, method?: string, body?: any) => Promise<any>;

type Props = {
  admin: boolean;
  api: Api;
  onSessionCreated?: (id: string, overlapWarning: boolean) => void;
};

const dhakaToday = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Dhaka',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

export default function AcademicWorkspace({ admin, api, onSessionCreated }: Props) {
  const [tab, setTab] = useState<'catalog' | 'offerings' | 'assignments'>('offerings');
  const [courses, setCourses] = useState<Row[]>([]);
  const [offerings, setOfferings] = useState<Row[]>([]);
  const [teachers, setTeachers] = useState<Row[]>([]);
  const [students, setStudents] = useState<Row[]>([]);
  const [assignments, setAssignments] = useState<Row[]>([]);
  const [roster, setRoster] = useState<Row[]>([]);
  const [selectedOffering, setSelectedOffering] = useState('');
  const [filters, setFilters] = useState({ courseId: '', term: '', section: '', teacherId: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  const offeringQuery = useMemo(() => {
    const query = new URLSearchParams();
    if (filters.courseId) query.set('courseId', filters.courseId);
    if (filters.term) query.set('term', filters.term);
    if (filters.section) query.set('section', filters.section);
    if (admin && filters.teacherId) query.set('teacherId', filters.teacherId);
    return query.size ? `?${query}` : '';
  }, [admin, filters]);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [offeringRows, courseRows, teacherRows, studentRows, assignmentRows] = await Promise.all([
        api(`/offerings${offeringQuery}${offeringQuery ? '&' : '?'}${admin ? 'includeArchived=true' : ''}`.replace(/[?&]$/, '')),
        admin ? api('/academic/courses') : Promise.resolve([]),
        admin ? api('/teacher-profiles') : Promise.resolve([]),
        admin ? api('/students') : Promise.resolve([]),
        admin ? api('/teacher-assignments') : Promise.resolve([]),
      ]);
      setOfferings(offeringRows);
      setCourses(courseRows);
      setTeachers(teacherRows);
      setStudents(studentRows.filter((student: Row) => !student.archived));
      setAssignments(assignmentRows);
      const activeOfferings = offeringRows.filter((offering: Row) => !offering.archived);
      setSelectedOffering(current => activeOfferings.some((offering: Row) => offering.id === current)
        ? current : activeOfferings[0]?.id || '');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [offeringQuery, admin]);

  useEffect(() => {
    if (!selectedOffering) {
      setRoster([]);
      return;
    }
    let active = true;
    setError('');
    api(`/offerings/${selectedOffering}/students`).then(rows => {
      if (active) setRoster(rows);
    }).catch(reason => {
      if (active) setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => { active = false; };
  }, [selectedOffering, api]);

  async function submit(event: React.FormEvent<HTMLFormElement>, action: (form: FormData) => Promise<void>) {
    event.preventDefault();
    setError('');
    setSaved('');
    const form = new FormData(event.currentTarget);
    setLoading(true);
    try {
      await action(form);
      setSaved('Saved successfully.');
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }

  const selectOffering = (event: React.ChangeEvent<HTMLSelectElement>) => setSelectedOffering(event.target.value);
  const offeringLabel = (offering: Row) => offering.offering_label
    || `${offering.course_code} — ${offering.academic_term}${offering.academic_year ? ` ${offering.academic_year}` : ''} — Batch ${offering.batch} — Section ${offering.section}`;

  return <section className="academic-workspace">
    <div className="inline academic-tabs" role="tablist" aria-label="Academic setup">
      {([
        ['offerings', 'Offerings'],
        ['catalog', 'Course catalog'],
        ...(admin ? [['assignments', 'Teacher assignments'] as const] : []),
      ] as const).map(([key, label]) => <button
        key={key}
        type="button"
        role="tab"
        aria-selected={tab === key}
        className={tab === key ? 'active' : 'secondary'}
        onClick={() => setTab(key)}
      >{label}</button>)}
      <button className="secondary" type="button" onClick={() => void load()} disabled={loading}>Refresh</button>
    </div>

    {error && <p role="alert" className="error">{error} <button type="button" className="secondary" onClick={() => void load()}>Retry</button></p>}
    {saved && <p role="status" className="notice">{saved}</p>}
    {loading && <p role="status" className="notice">Loading academic data…</p>}

    {tab === 'catalog' && <>
      {admin && <form className="card inline" onSubmit={event => submit(event, async form => {
        await api('/academic/courses', 'POST', {
          courseCode: form.get('courseCode'),
          title: form.get('title'),
        });
      })}>
        <input name="courseCode" placeholder="Course code (e.g. CSE101)" required maxLength={32} />
        <input name="title" placeholder="Course title" required maxLength={160} />
        <button disabled={loading}>Add course</button>
      </form>}
      <div className="card">
        <h2>Reusable course catalog</h2>
        {!admin && <p>Catalog details are shown through your assigned offerings.</p>}
        {courses.length === 0 && admin ? <p className="empty">No catalog courses yet.</p> : null}
        {courses.map(course => <div className="session" key={course.id}>
          <strong>{course.course_code} — {course.title}</strong>
          <span>{course.offering_count} offerings · {course.active ? 'Active' : 'Archived'}</span>
          {admin && course.active && <button className="danger" type="button" disabled={loading}
            onClick={() => {
              if (!confirm(`Archive ${course.course_code} — ${course.title}? Its historical sessions and attendance will be preserved.`)) return;
              setLoading(true);
              api(`/academic/courses/${course.id}/archive`, 'POST').then(load)
                .catch(reason => setError(reason instanceof Error ? reason.message : String(reason)))
                .finally(() => setLoading(false));
            }}>Archive</button>}
          {admin && !course.active && <button type="button" className="secondary" disabled={loading}
            onClick={() => {
              setLoading(true);
              api(`/academic/courses/${course.id}/activate`, 'POST').then(load)
                .catch(reason => setError(reason instanceof Error ? reason.message : String(reason)))
                .finally(() => setLoading(false));
            }}>Reactivate</button>}
        </div>)}
      </div>
    </>}

    {tab === 'offerings' && <>
      {admin && <form className="card inline" onSubmit={event => submit(event, async form => {
        await api('/offerings', 'POST', {
          courseId: form.get('courseId'),
          academicTerm: form.get('academicTerm'),
          academicYear: form.get('academicYear') ? Number(form.get('academicYear')) : null,
          batch: form.get('batch'),
          section: form.get('section'),
        });
      })}>
        <select name="courseId" required defaultValue=""><option value="" disabled>Select catalog course</option>
          {courses.filter(course => course.active).map(course => <option key={course.id} value={course.id}>{course.course_code} — {course.title}</option>)}
        </select>
        <input name="academicTerm" placeholder="Academic term (e.g. Fall)" required />
        <input name="academicYear" type="number" min="1900" max="2200" placeholder="Year" required />
        <input name="batch" placeholder="Batch (e.g. 2024)" required />
        <input name="section" placeholder="Section (e.g. A)" required />
        <button disabled={loading}>Create offering</button>
      </form>}
      <div className="card inline academic-filters">
        <select aria-label="Filter by course" value={filters.courseId} onChange={event => setFilters(current => ({ ...current, courseId: event.target.value }))}>
          <option value="">All courses</option>
          {courses.map(course => <option key={course.id} value={course.id}>{course.course_code} — {course.title}</option>)}
        </select>
        <input aria-label="Filter by term" placeholder="Filter term" value={filters.term}
          onChange={event => setFilters(current => ({ ...current, term: event.target.value }))} />
        <input aria-label="Filter by section" placeholder="Filter section" value={filters.section}
          onChange={event => setFilters(current => ({ ...current, section: event.target.value }))} />
        {admin && <select aria-label="Filter by teacher" value={filters.teacherId}
          onChange={event => setFilters(current => ({ ...current, teacherId: event.target.value }))}>
          <option value="">All teachers</option>
          {teachers.map(teacher => <option key={teacher.id} value={teacher.id}>{teacher.display_name}</option>)}
        </select>}
      </div>
      {offerings.length === 0 && !loading ? <p className="empty">No matching offerings.</p> : offerings.map(offering => <article className="card offering-card" key={offering.id}>
        <div className="course-heading">
          <div><h2>{offeringLabel(offering)}</h2>
            <p>Primary teacher: {offering.primary_teacher || 'Not assigned'} · Additional teachers: {offering.teachers || 'None'}</p>
          </div>
          <div className="inline"><span className="pill">{offering.enrolled_count} enrolled</span><span className="pill">{offering.session_count} sessions</span>
            <span className="pill">{offering.archived ? 'Archived' : 'Active'}</span>
            {admin && !offering.archived && <button className="danger" type="button" disabled={loading} onClick={() => {
              if (!confirm(`Archive ${offeringLabel(offering)}? Existing session rosters and attendance will be preserved.`)) return;
              setLoading(true);
              api(`/offerings/${offering.id}/archive`, 'POST').then(load)
                .catch(reason => setError(reason instanceof Error ? reason.message : String(reason)))
                .finally(() => setLoading(false));
            }}>Archive offering</button>}
            {admin && offering.archived && <button type="button" className="secondary" disabled={loading} onClick={() => {
              setLoading(true);
              api(`/offerings/${offering.id}/activate`, 'POST').then(load)
                .catch(reason => setError(reason instanceof Error ? reason.message : String(reason)))
                .finally(() => setLoading(false));
            }}>Reactivate offering</button>}
          </div>
        </div>
            {(admin || offering.can_create_session) && !offering.archived && <form className="inline session-create-form" onSubmit={event => submit(event, async form => {
              const created = await api('/sessions', 'POST', {
                offeringId: offering.id,
                teacherId: admin ? (form.get('teacherId') || null) : null,
                authorizeSubstitute: admin && form.get('authorizeSubstitute') === 'on',
                date: form.get('date'),
                startTime: form.get('startTime'),
                endTime: form.get('endTime'),
              });
              if (created.overlapWarning) alert('Warning: this teacher has an overlapping class session.');
              onSessionCreated?.(created.id, created.overlapWarning);
            })}>
              <label>Class date<input name="date" type="date" required defaultValue={dhakaToday()} /></label>
              <label>Starts<input name="startTime" type="time" required /></label>
              <label>Ends<input name="endTime" type="time" required /></label>
              {admin && <>
                <select name="teacherId" defaultValue="" aria-label="Actual session teacher">
                  <option value="">Use applicable primary teacher</option>
                  {teachers.filter(teacher => teacher.active).map(teacher =>
                    <option key={teacher.id} value={teacher.id}>{teacher.display_name}</option>)}
                </select>
                <label className="inline"><input name="authorizeSubstitute" type="checkbox" />
                  Authorize selected teacher as a substitute for this session only</label>
              </>}
              <button disabled={loading}>Create session</button>
            </form>}
            {!offering.archived && <button type="button" className="secondary" onClick={() => setSelectedOffering(offering.id)}>View offering roster</button>}
        {selectedOffering === offering.id && <div className="roster-panel">
          {admin && <form className="inline" onSubmit={event => submit(event, async form => {
            const studentId = String(form.get('studentId'));
            await api(`/offerings/${offering.id}/students/${studentId}`, 'POST');
            setRoster(await api(`/offerings/${offering.id}/students`));
          })}>
            <select name="studentId" required defaultValue=""><option value="" disabled>Select student to enroll</option>
              {students.filter(student => !roster.some(enrolled => enrolled.id === student.id)).map(student =>
                <option key={student.id} value={student.id}>{student.roll} — {student.name}</option>)}
            </select>
            <button disabled={loading || students.every(student => roster.some(enrolled => enrolled.id === student.id))}>Enroll student</button>
            {students.length > 0 && students.every(student => roster.some(enrolled => enrolled.id === student.id))
              && <span>All students are enrolled.</span>}
          </form>}
          {roster.length === 0 ? <p className="empty">No students are enrolled in this offering.</p> : <ul>
            {roster.map(student => <li key={student.id} className="inline"><span>{student.roll} — {student.name}</span>
              {admin && <button className="danger" type="button" disabled={loading}
                onClick={() => {
                  if (!confirm(`Withdraw ${student.name} from ${offeringLabel(offering)}? Saved session rosters will not change.`)) return;
                  setLoading(true);
                  api(`/offerings/${offering.id}/students/${student.id}`, 'DELETE')
                    .then(async () => { setRoster(await api(`/offerings/${offering.id}/students`)); await load(); })
                    .catch(reason => setError(reason instanceof Error ? reason.message : String(reason)))
                    .finally(() => setLoading(false));
                }}>Withdraw</button>}
            </li>)}
          </ul>}
        </div>}
      </article>)}
    </>}

    {tab === 'assignments' && <>
      {admin && <form className="card inline" onSubmit={event => {
        const formElement = event.currentTarget;
        return submit(event, async form => {
          await api('/teacher-profiles', 'POST', {
            username: form.get('username'),
            displayName: form.get('displayName'),
            password: form.get('password'),
          });
          formElement.reset();
        });
      }}>
        <input name="username" placeholder="Teacher username" required minLength={3} maxLength={64}
          pattern="[A-Za-z0-9._-]+" />
        <input name="displayName" placeholder="Teacher name" required maxLength={120} />
        <input name="password" type="password" placeholder="Initial password (12+ characters)"
          required minLength={12} maxLength={128} autoComplete="new-password" />
        <button disabled={loading}>Create teacher account</button>
      </form>}
      {admin && <form className="card inline" onSubmit={event => submit(event, async form => {
        await api('/teacher-assignments', 'POST', {
          offeringId: form.get('offeringId'),
          teacherId: form.get('teacherId'),
          role: form.get('role'),
          effectiveFrom: form.get('effectiveFrom'),
          effectiveTo: form.get('effectiveTo') || null,
        });
      })}>
        <select name="offeringId" required defaultValue=""><option value="" disabled>Select offering</option>
        {offerings.filter(offering => !offering.archived).map(offering => <option key={offering.id} value={offering.id}>{offeringLabel(offering)}</option>)}
        </select>
        <select name="teacherId" required defaultValue=""><option value="" disabled>Select teacher account</option>
          {teachers.filter(teacher => teacher.active).map(teacher => <option key={teacher.id} value={teacher.id}>{teacher.display_name}</option>)}
        </select>
        <select name="role" defaultValue="PRIMARY"><option value="PRIMARY">Primary</option><option value="CO_TEACHER">Co-teacher</option></select>
        <label>Effective from<input name="effectiveFrom" type="date" required defaultValue={dhakaToday()} /></label>
        <label>Effective to (optional)<input name="effectiveTo" type="date" /></label>
        <button disabled={loading}>Assign teacher</button>
      </form>}
      <div className="card"><h2>Assignment history</h2>
        {assignments.length === 0 ? <p className="empty">No teacher assignments found.</p> : assignments.map(assignment => <div className="session" key={assignment.id}>
          <span><strong>{assignment.display_name}</strong> · {assignment.assignment_role === 'PRIMARY' ? 'Primary' : 'Co-teacher'} · {assignment.course_code} — {assignment.academic_term}{assignment.academic_year ? ` ${assignment.academic_year}` : ''} — Batch {assignment.batch} — Section {assignment.section}</span>
          <span>{assignment.legacy ? 'Legacy dates unknown' : `${assignment.effective_from} → ${assignment.effective_to || 'No end date'}`} · {assignment.status}</span>
          {admin && !assignment.legacy && !assignment.effective_to && <form className="inline" onSubmit={event => submit(event, async form => {
            await api(`/teacher-assignments/${assignment.id}/end`, 'POST', { effectiveTo: form.get('effectiveTo') });
          })}>
            <label>End assignment<input name="effectiveTo" type="date" min={assignment.effective_from}
              defaultValue={assignment.effective_from > dhakaToday() ? assignment.effective_from : dhakaToday()} required /></label>
            <button className="secondary" disabled={loading}>Set end date</button>
          </form>}
        </div>)}
      </div>
    </>}
  </section>;
}
