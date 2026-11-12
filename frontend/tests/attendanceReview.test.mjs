import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = await readFile(new URL('../src/attendanceReview.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module = { exports: {} };
vm.runInNewContext(compiled, { exports: module.exports, module });
const {
  deriveRoster,
  detectionKey,
  draftAttendancePayload,
  eligibleAutoSelections,
  formatSimilarity,
  isCurrentAnalysisResponse,
  logicalFaceKey,
} = module.exports;

const sessionId = 'session-1';
const rosterIds = new Set(['student-a', 'student-b']);
const file = { name: 'class.jpg', size: 1024, lastModified: 1 };
const makePhoto = (photoId, results) => ({ photoId, results });
const makeDetection = (faceId, studentId, score, status = 'MATCHED', extras = {}) => ({
  faceId,
  faceNumber: Number(faceId.replace('face-', '')),
  studentId,
  score,
  status,
  ...extras,
});
const select = (photos, overrides = {}, previous = {}, files = [file, file, file]) => eligibleAutoSelections(
  { photos, thresholdPercentage: 70 },
  sessionId,
  rosterIds,
  files,
  overrides,
  previous,
);

test('uses an inclusive threshold and finite MATCHED roster IDs only', () => {
  const selections = select([makePhoto('photo-a', [
    makeDetection('face-1', 'student-a', 0.70),
    makeDetection('face-2', 'student-b', 0.70001),
    makeDetection('face-3', 'outside-roster', Number.NaN),
    makeDetection('face-4', 'outside-roster', 0.99),
    makeDetection('face-5', 'outside-roster', 0.99, 'UNCERTAIN'),
    makeDetection('face-6', 'outside-roster', 0.99, 'DUPLICATE'),
    makeDetection('face-7', 'outside-roster', 0.99, 'UNKNOWN'),
    makeDetection('face-8', 'outside-roster', 0.99, 'LOW_QUALITY'),
    makeDetection('face-9', 'outside-roster', 0.99, 'PROCESSING_FAILED'),
  ])]);
  assert.equal(Object.keys(selections).length, 2);
  assert.equal(selections[detectionKey(sessionId, 'photo-a', 'face-1')].studentId, 'student-a');
  assert.equal(selections[detectionKey(sessionId, 'photo-a', 'face-2')].studentId, 'student-b');
});

test('uses raw scores before display rounding and rejects invalid response thresholds', () => {
  const response = {
    thresholdPercentage: 70.005,
    photos: [makePhoto('photo-a', [makeDetection('face-1', 'student-a', 0.70004)])],
  };
  assert.equal(formatSimilarity(response.photos[0].results[0].score), 'Similarity 70.00%');
  assert.equal(Object.keys(eligibleAutoSelections(response, sessionId, rosterIds, [file], {}, {})).length, 0);
  assert.throws(
    () => eligibleAutoSelections({ ...response, thresholdPercentage: Number.NaN }, sessionId, rosterIds, [file], {}, {}),
    /invalid threshold/i,
  );
});

test('blocks explicit ambiguity and duplicate same-photo identity conflicts', () => {
  const selections = select([
    makePhoto('photo-a', [
      makeDetection('face-1', 'student-a', 0.99),
      makeDetection('face-2', 'student-a', 0.98),
      makeDetection('face-3', 'student-b', 0.99, 'MATCHED', { identityConflict: true }),
    ]),
    makePhoto('photo-b', [makeDetection('face-4', 'student-a', 0.95)]),
  ]);
  assert.deepEqual(Object.keys(selections), [detectionKey(sessionId, 'photo-b', 'face-4')]);
});

test('merges valid matches across photos into one present decision', () => {
  const selections = select([
    makePhoto('photo-a', [makeDetection('face-1', 'student-a', 0.91)]),
    makePhoto('photo-b', [makeDetection('face-1', 'student-a', 0.92)]),
  ]);
  const roster = deriveRoster([
    { student_id: 'student-a', state: 'UNCONFIRMED', decision_source: 'NONE' },
    { student_id: 'student-b', state: 'UNCONFIRMED', decision_source: 'NONE' },
  ], {}, selections, sessionId);
  assert.equal(roster.filter(row => row.student_id === 'student-a' && row.state === 'PRESENT').length, 1);
  assert.equal(roster.find(row => row.student_id === 'student-a').decision_source, 'AI');
  assert.equal(roster.find(row => row.student_id === 'student-b').state, 'UNCONFIRMED');
});

test('re-analysis drops stale AI-only detections but keeps teacher face overrides', () => {
  const manualKey = detectionKey(sessionId, 'old-photo', 'face-manual');
  const selections = select(
    [makePhoto('new-photo', [makeDetection('face-1', 'student-a', 0.91)])],
    {},
    {
      [detectionKey(sessionId, 'old-photo', 'face-ai')]: { studentId: 'student-b', source: 'AI' },
      [manualKey]: { studentId: 'student-b', source: 'MANUAL' },
    },
  );
  assert.equal(Object.hasOwn(selections, detectionKey(sessionId, 'old-photo', 'face-ai')), false);
  assert.equal(selections[manualKey].studentId, 'student-b');
  assert.equal(selections[detectionKey(sessionId, 'new-photo', 'face-1')].source, 'AI');
});

test('manual face and roster decisions survive AI recomputation and clearing', () => {
  const keyA = detectionKey(sessionId, 'photo-a', 'face-1');
  const keyB = detectionKey(sessionId, 'photo-b', 'face-2');
  const fileB = { name: 'other.jpg', size: 2048, lastModified: 2 };
  const files = [file, fileB];
  const overrideKey = logicalFaceKey(sessionId, fileB, 2, 1);
  const selected = select([
    makePhoto('photo-a', [makeDetection('face-1', 'student-a', 0.99)]),
    makePhoto('photo-b', [makeDetection('face-2', 'student-a', 0.99)]),
  ], { [overrideKey]: 'student-b' }, { [detectionKey(sessionId, 'photo-old', 'face-3')]: { studentId: 'student-a', source: 'MANUAL' } }, files);
  assert.equal(selected[detectionKey(sessionId, 'photo-old', 'face-3')].source, 'MANUAL');
  assert.equal(selected[keyB].studentId, 'student-b');
  const manualStates = { 'student-a': 'ABSENT' };
  const baseRoster = [
    { student_id: 'student-a', state: 'UNCONFIRMED', decision_source: 'NONE' },
    { student_id: 'student-b', state: 'UNCONFIRMED', decision_source: 'NONE' },
  ];
  let roster = deriveRoster(baseRoster, manualStates, selected, sessionId);
  assert.equal(roster.find(row => row.student_id === 'student-a').state, 'ABSENT');
  assert.equal(roster.find(row => row.student_id === 'student-b').state, 'PRESENT');
  roster = deriveRoster(baseRoster, manualStates, { [detectionKey(sessionId, 'photo-old', 'face-3')]: selected[detectionKey(sessionId, 'photo-old', 'face-3')] }, sessionId);
  assert.equal(roster.find(row => row.student_id === 'student-b').state, 'UNCONFIRMED');
});

test('manual decision sources persist in draft payload and stale requests are rejected', () => {
  const payload = draftAttendancePayload([
    { student_id: 'student-a', state: 'PRESENT', decision_source: 'AI' },
    { student_id: 'student-b', state: 'ABSENT', decision_source: 'MANUAL' },
  ]);
  assert.equal(JSON.stringify(payload.states), JSON.stringify({ 'student-a': 'PRESENT', 'student-b': 'ABSENT' }));
  assert.equal(JSON.stringify(payload.sources), JSON.stringify({ 'student-a': 'AI', 'student-b': 'MANUAL' }));
  assert.equal(isCurrentAnalysisResponse('session-b', 'session-a', 3, 3), false);
  assert.equal(isCurrentAnalysisResponse('session-a', 'session-a', 4, 3), false);
  assert.equal(isCurrentAnalysisResponse('session-a', 'session-a', 4, 4), true);
  assert.equal(formatSimilarity(0.9085), 'Similarity 90.85%');
});
