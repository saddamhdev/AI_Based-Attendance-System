#!/usr/bin/env node
/**
 * End-to-end contract check of the Spring Boot API used by the mobile app.
 * Runs real HTTP requests (token auth, multipart uploads to the Python service through Spring Boot)
 * against a running backend. It creates its own uniquely named test records; point it at a
 * disposable database/schema, never production.
 *
 *   API_URL=http://localhost:8080 ADMIN_PASSWORD=... TEACHER_PASSWORD=... node scripts/verify-backend.mjs
 */
import { deflateSync } from 'node:zlib';

const API = (process.env.API_URL ?? 'http://localhost:8080').replace(/\/$/, '') + '/api';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) {
  console.error('Set ADMIN_PASSWORD (and API_URL).');
  process.exit(2);
}
const run = Date.now().toString(36);
const today = new Date().toISOString().slice(0, 10);
let passed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failures.push(name); console.log(`  ✗ ${name}${detail ? ` — ${JSON.stringify(detail).slice(0, 300)}` : ''}`); }
}

async function call(method, path, { token, body, form, basic, accept = 'application/json' } = {}) {
  const headers = { Accept: accept };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (basic) headers.Authorization = `Basic ${Buffer.from(basic).toString('base64')}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(API + path, { method, headers, body: form ?? (body === undefined ? undefined : JSON.stringify(body)) });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data, text };
}

async function login(username, password) {
  const r = await call('POST', '/auth/token', { body: { username, password, clientName: 'verify-script' } });
  if (r.status !== 200) throw new Error(`login ${username} failed: ${r.status} ${r.text}`);
  return r.data;
}

/** Minimal valid PNG (solid colour, no faces). */
function png(width, height) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height, 0xee);
  for (let y = 0; y < height; y++) raw[y * (width * 3 + 1)] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function photos(count, fields = {}) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  for (let i = 0; i < count; i++) form.append('images', new Blob([png(64, 64)], { type: 'image/png' }), `p${i}.png`);
  return form;
}

async function main() {
  console.log(`Verifying ${API} (run ${run})`);

  console.log('\nAuthentication');
  const bad = await call('POST', '/auth/token', { body: { username: 'admin', password: 'wrong-password' } });
  check('wrong password → 401 INVALID_CREDENTIALS', bad.status === 401 && bad.data?.code === 'INVALID_CREDENTIALS', bad.data);
  const adminTok = (await login('admin', ADMIN_PASSWORD)).accessToken;
  const me = await call('GET', '/me', { token: adminTok });
  check('bearer token resolves to ADMIN', me.data?.role === 'ADMIN', me.data);
  const basic = await call('GET', '/me', { basic: `admin:${ADMIN_PASSWORD}` });
  check('HTTP Basic (web client) still works', basic.status === 200 && basic.data?.role === 'ADMIN', basic.status);
  const missing = await call('GET', '/sessions/00000000-0000-0000-0000-000000000000', { token: adminTok });
  check('missing record → 404 JSON, not a masked 403/500', missing.status === 404 && missing.data?.code === 'NOT_FOUND', missing.data);
  const conflict = await call('POST', '/student-registrations', { body: {} });
  check('validation error keeps its 400 and message', conflict.status === 400 && /valid name/.test(conflict.data?.message ?? ''), conflict.data);
  const wrongFormat = await call('GET', '/reporting/export.csv', { token: adminTok, accept: 'application/json' });
  check('unacceptable format → 406, not 500', wrongFormat.status === 406, wrongFormat.data);
  check('error bodies never contain stack traces', !/Exception|at com\.attendance/.test(missing.text + conflict.text));

  console.log('\nAcademic setup');
  const pw = `Verify-${run}-Passw0rd!`;
  const t1 = await call('POST', '/teacher-profiles', { token: adminTok, body: { username: `t1-${run}`, displayName: `Teacher One ${run}`, password: pw } });
  const t2 = await call('POST', '/teacher-profiles', { token: adminTok, body: { username: `t2-${run}`, displayName: `Teacher Two ${run}`, password: pw } });
  check('teachers created', t1.status === 200 && t2.status === 200, [t1.data, t2.data]);
  const course = await call('POST', '/academic/courses', { token: adminTok, body: { courseCode: `V${run}`.toUpperCase(), title: 'Verification' } });
  const offering = await call('POST', '/offerings', { token: adminTok, body: { courseId: course.data.id, academicTerm: 'Fall', academicYear: 2026, batch: 'B1', section: 'A' } });
  const assign = await call('POST', '/teacher-assignments', { token: adminTok, body: { offeringId: offering.data.id, teacherId: t1.data.id, role: 'PRIMARY', effectiveFrom: '2026-01-01' } });
  check('offering created and teacher assigned', offering.status === 200 && assign.status === 200, [offering.data, assign.data]);

  console.log('\nAdmin direct student creation');
  const temp = `Temp-${run}-Passw0rd!`;
  const s1 = await call('POST', '/admin/students', { token: adminTok, body: { name: `Student One ${run}`, roll: `R1-${run}`, email: `s1-${run}@example.test`, username: `s1-${run}`, temporaryPassword: temp, consent: true } });
  const s2 = await call('POST', '/admin/students', { token: adminTok, body: { name: `Student Two ${run}`, roll: `R2-${run}`, consent: false } });
  check('student with account and profile-only student created', s1.data?.accountCreated === true && s2.data?.accountCreated === false, [s1.data, s2.data]);
  await call('POST', `/offerings/${offering.data.id}/students/${s1.data.id}`, { token: adminTok });
  await call('POST', `/offerings/${offering.data.id}/students/${s2.data.id}`, { token: adminTok });
  const consent = await call('POST', `/students/${s2.data.id}/consent`, { token: adminTok, body: { consent: true } });
  check('admin records consent for an existing profile', consent.status === 200, consent.data);

  console.log('\nTemporary password must be changed');
  const s1a = (await login(`s1-${run}`, temp)).accessToken;
  const s1b = (await login(`s1-${run}`, temp)).accessToken;
  const blocked = await call('GET', '/student/dashboard', { token: s1a });
  check('dashboard blocked with PASSWORD_CHANGE_REQUIRED', blocked.status === 403 && blocked.data?.code === 'PASSWORD_CHANGE_REQUIRED', blocked.data);
  const newPw = `Mine-${run}-Passw0rd!`;
  const changed = await call('PUT', '/account/password', { token: s1a, body: { currentPassword: temp, newPassword: newPw, confirmPassword: newPw } });
  check('password changed', changed.status === 200, changed.data);
  check('other devices are signed out after a password change', (await call('GET', '/me', { token: s1b })).status === 401);
  const dash = await call('GET', '/student/dashboard', { token: s1a });
  check('student identity comes from the token', dash.status === 200 && dash.data.profile.roll === `R1-${run}`.toUpperCase(), dash.data?.profile);
  check('no finalized classes yet → null percentage', dash.data.noFinalizedClasses === true && dash.data.attendancePercentage === null, dash.data);

  console.log('\nSelf-registration and approval');
  const regPw = `Reg-${run}-Passw0rd!`;
  const reg = await call('POST', '/student-registrations', { body: { name: `Applicant ${run}`, roll: `R2-${run}`, email: `a-${run}@example.test`, username: `a-${run}`, password: regPw } });
  check('registration accepted as PENDING_APPROVAL', reg.data?.status === 'PENDING_APPROVAL', reg.data);
  const appTok = await login(`a-${run}`, regPw);
  check('pending applicant gets a restricted APPLICANT token', appTok.role === 'APPLICANT', appTok);
  const status = await call('GET', '/applicant/registration', { token: appTok.accessToken });
  check('applicant sees own registration status', status.data?.status === 'PENDING_APPROVAL' && status.data?.username === `a-${run}`, status.data);
  const deniedStudent = await call('GET', '/student/dashboard', { token: appTok.accessToken });
  const deniedStaff = await call('GET', '/students', { token: appTok.accessToken });
  check('applicant cannot reach student or staff APIs', deniedStudent.status === 403 && deniedStaff.status === 403, [deniedStudent.data, deniedStaff.data]);
  const queue = await call('GET', '/admin/student-registrations', { token: adminTok });
  const request = queue.data.find(r => r.username === `a-${run}`);
  check('matching roll is flagged, not auto-claimed', request?.candidate_student_id === s2.data.id, request);
  const autoLink = await call('POST', `/admin/student-registrations/${request.id}/approve`, { token: adminTok, body: {} });
  check('approval without explicit link is refused (409)', autoLink.status === 409, autoLink.data);
  const reject = await call('POST', `/admin/student-registrations/${request.id}/reject`, { token: adminTok, body: { reason: 'Please verify roll' } });
  check('admin rejects with reason', reject.data?.status === 'REJECTED', reject.data);
  const seen = await call('GET', '/applicant/registration', { token: appTok.accessToken });
  check('applicant sees the rejection reason', seen.data?.rejectionReason === 'Please verify roll', seen.data);
  const resub = await call('POST', '/applicant/registration/resubmit', { token: appTok.accessToken, body: { name: `Applicant ${run}`, roll: `R2-${run}`, email: `a-${run}@example.test` } });
  check('applicant resubmits', resub.data?.status === 'PENDING_APPROVAL', resub.data);
  const approve = await call('POST', `/admin/student-registrations/${request.id}/approve`, { token: adminTok, body: { existingStudentId: s2.data.id } });
  check('approval with explicit verified link', approve.data?.status === 'APPROVED' && approve.data.studentId === s2.data.id, approve.data);
  const s2Tok = (await login(`a-${run}`, regPw));
  check('approved applicant now signs in as STUDENT', s2Tok.role === 'STUDENT', s2Tok);

  console.log('\nFace photo submission (through Spring Boot → Python)');
  const noConsent = await call('POST', '/student/faces', { token: s1a, form: photos(5, { consent: 'false' }) });
  check('explicit consent required', noConsent.status === 400 && noConsent.data?.code === 'CONSENT_REQUIRED', noConsent.data);
  const four = await call('POST', '/student/faces', { token: s1a, form: photos(4, { consent: 'true' }) });
  check('fewer than 5 photos rejected', four.data?.code === 'PHOTO_COUNT_INVALID', four.data);
  const sub = crypto.randomUUID();
  const noFace = await call('POST', '/student/faces', { token: s1a, form: photos(5, { consent: 'true', submissionId: sub }) });
  check('photos without a face → 422 with per-photo errors', noFace.status === 422 && noFace.data.photoErrors?.length === 5
    && noFace.data.photoErrors.every(e => e.code === 'NO_DETECTABLE_FACE'), noFace.data);
  const after = await call('GET', '/student/faces', { token: s1a });
  check('failed submission leaves nothing pending', Array.isArray(after.data) && after.data.length === 0, after.data);
  const adminNoFace = await call('POST', `/students/${s2.data.id}/faces`, { token: adminTok, form: photos(5, { consent: 'true', submissionId: crypto.randomUUID() }) });
  check('admin enrollment also validated per photo', adminNoFace.status === 422 && adminNoFace.data.photoErrors?.length === 5, adminNoFace.data);

  console.log('\nOwnership and gallery access');
  const otherGallery = await call('GET', `/student/faces/${crypto.randomUUID()}/photos`, { token: s1a });
  check('student cannot list another enrollment', otherGallery.status === 200 && otherGallery.data.length === 0, otherGallery.data);
  check('student cannot use admin student list', (await call('GET', '/students', { token: s1a })).status === 403);
  const t1Tok = (await login(`t1-${run}`, pw)).accessToken;
  const t2Tok = (await login(`t2-${run}`, pw)).accessToken;
  check('teacher has no enrollment-gallery access', (await call('GET', '/admin/face-submissions', { token: t1Tok })).status === 403);
  check('teacher cannot review face submissions', (await call('GET', `/students/${s1.data.id}/faces?enrollmentId=${crypto.randomUUID()}`, { token: t1Tok })).status === 403);

  console.log('\nThreshold isolation and recognition');
  await call('PUT', '/me/recognition-settings', { token: t1Tok, body: { threshold: 85 } });
  await call('PUT', '/me/recognition-settings', { token: t2Tok, body: { threshold: 60 } });
  const sess1 = await call('POST', '/sessions', { token: t1Tok, body: { offeringId: offering.data.id, date: today, startTime: '09:00', endTime: '10:00' } });
  check('assigned teacher creates session', sess1.status === 200, sess1.data);
  const dup = await call('POST', '/sessions', { token: t1Tok, body: { offeringId: offering.data.id, date: today, startTime: '09:00', endTime: '10:00' } });
  check('identical session retry is rejected (no duplicate)', dup.status === 409, dup.data);
  const sess2 = await call('POST', '/sessions', { token: adminTok, body: { offeringId: offering.data.id, teacherId: t2.data.id, authorizeSubstitute: true, date: today, startTime: '11:00', endTime: '12:00' } });
  check('admin authorizes a session-only substitute', sess2.status === 200, sess2.data);
  check('substitute cannot open the other session', (await call('GET', `/sessions/${sess1.data.id}`, { token: t2Tok })).status === 403);
  const r1 = await call('POST', `/sessions/${sess1.data.id}/recognize`, { token: t1Tok, form: photos(1) });
  const r2 = await call('POST', `/sessions/${sess2.data.id}/recognize`, { token: t2Tok, form: photos(1) });
  check('analysis uses initiating teacher threshold (85%)', r1.data?.thresholdPercentage === 85 && r1.data.initiatingUser === `t1-${run}`, r1.data);
  check('concurrent teacher keeps own threshold (60%)', r2.data?.thresholdPercentage === 60, r2.data);
  check('analysis returns photo dimensions for box alignment', r1.data?.photos?.[0]?.imageWidth === 64 && r1.data.photos[0].imageHeight === 64, r1.data);
  const tooMany = await call('POST', `/sessions/${sess1.data.id}/recognize`, { token: t1Tok, form: photos(4) });
  check('more than 3 classroom photos rejected', tooMany.status === 409 || tooMany.status === 400, tooMany.data);
  const badImg = new FormData();
  badImg.append('images', new Blob([png(64, 64)], { type: 'image/png' }), 'ok.png');
  badImg.append('images', new Blob([Buffer.from('not an image')], { type: 'image/jpeg' }), 'bad.jpg');
  const bad2 = await call('POST', `/sessions/${sess1.data.id}/recognize`, { token: t1Tok, form: badImg });
  check('invalid classroom photo identified by index', bad2.status === 422 && bad2.data?.photoIndex === 2, bad2.data);
  const saved = await call('GET', `/sessions/${sess1.data.id}`, { token: t1Tok });
  check('saved analysis keeps its threshold', saved.data.recognitionAnalysis?.thresholdPercentage === 85, saved.data.recognitionAnalysis);

  console.log('\nDraft and confirmation');
  const roster = saved.data.roster;
  const states = Object.fromEntries(roster.map(r => [r.student_id, r.student_id === s1.data.id ? 'PRESENT' : 'ABSENT']));
  const sources = Object.fromEntries(roster.map(r => [r.student_id, 'MANUAL']));
  const draft = await call('PUT', `/sessions/${sess1.data.id}`, { token: t1Tok, body: { version: saved.data.session.version, states, sources } });
  check('draft saved and persisted', draft.status === 200 && draft.data.session.status === 'IN_REVIEW', draft.data?.session);
  const replayDraft = await call('PUT', `/sessions/${sess1.data.id}`, { token: t1Tok, body: { version: saved.data.session.version, states, sources } });
  check('stale draft replay → 409 (client re-reads instead)', replayDraft.status === 409, replayDraft.data);
  const reread = await call('GET', `/sessions/${sess1.data.id}`, { token: t1Tok });
  check('draft persisted on server', reread.data.roster.every(r => r.state === states[r.student_id]));
  const confirm = await call('POST', `/sessions/${sess1.data.id}/confirm`, { token: t1Tok, body: { version: reread.data.session.version } });
  check('teacher confirms attendance', confirm.data?.session?.status === 'FINALIZED', confirm.data);
  const confirmAgain = await call('POST', `/sessions/${sess1.data.id}/confirm`, { token: t1Tok, body: { version: reread.data.session.version } });
  check('confirmation retry is idempotent', confirmAgain.status === 200 && confirmAgain.data.session.status === 'FINALIZED', confirmAgain.data);

  console.log('\nStudent attendance and reports');
  const dash2 = await call('GET', '/student/dashboard', { token: s1a });
  check('student sees 1 finalized class, 100% present', dash2.data.totals.finalized_sessions === 1 && dash2.data.attendancePercentage === 100, dash2.data.totals);
  const dashS2 = await call('GET', '/student/dashboard', { token: s2Tok.accessToken });
  check('second student sees own absence only', dashS2.data.totals.absent_count === 1 && dashS2.data.attendancePercentage === 0, dashS2.data.totals);
  const csv = await call('GET', '/student/attendance.csv', { token: s1a, accept: 'text/csv, */*' });
  check('student CSV contains own record only', csv.status === 200 && csv.text.split('\n').filter(Boolean).length === 2, csv.text);
  const report = await call('GET', `/reporting?type=COURSE&courseId=${course.data.id}`, { token: t1Tok });
  check('report totals match (1 present, 1 absent, 50%)', report.data?.summary?.presentRecords === 1 && report.data.summary.absentRecords === 1
    && Number(report.data.summary.attendancePercentage) === 50, report.data?.summary);
  const reportCsv = await call('GET', `/reporting/export.csv?type=DETAIL&courseId=${course.data.id}`, { token: t1Tok, accept: 'text/csv, */*' });
  check('report CSV export through bearer auth', reportCsv.status === 200 && reportCsv.text.includes('Finalized sessions'), reportCsv.status);
  check('other teacher cannot report on this course', (await call('GET', `/reporting?type=COURSE&courseId=${course.data.id}`, { token: t2Tok })).status === 403);

  console.log('\nLogout and deactivation');
  const out = await call('DELETE', '/auth/token', { token: t2Tok });
  check('logout revokes the token', out.status === 204 && (await call('GET', '/me', { token: t2Tok })).data?.code === 'SESSION_EXPIRED');
  await call('PUT', `/students/${s1.data.id}/account`, { token: adminTok, body: { active: false } });
  check('deactivated account token stops working immediately', (await call('GET', '/student/dashboard', { token: s1a })).status === 401);
  const inactive = await call('POST', '/auth/token', { body: { username: `s1-${run}`, password: newPw } });
  check('inactive account sign-in → ACCOUNT_INACTIVE only with correct password', inactive.data?.code === 'ACCOUNT_INACTIVE', inactive.data);
  const guess = await call('POST', '/auth/token', { body: { username: `s1-${run}`, password: 'wrong-password-x' } });
  check('wrong password does not reveal inactive account', guess.data?.code === 'INVALID_CREDENTIALS', guess.data);

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) process.exit(1);
}

main().catch(error => { console.error(error); process.exit(1); });
