import { readFileSync } from 'fs';
import { join } from 'path';

import type { RecognitionAnalysis } from '../src/api/types';
import {
  deriveRoster, detectionKey, eligibleAutoSelections, isCurrentAnalysisResponse, logicalFaceKey,
} from '../src/review/attendanceReview';
import {
  boxToView, dimensionsMatch, fitImage, hasUnsavedChanges, identityConflicts, photoFingerprint, rosterTotals,
} from '../src/review/sessionReview';

const S = 'session-1';
const roster = [
  { session_id: S, student_id: 'stu-a', student_name: 'A', roll: '1', state: 'UNCONFIRMED', decision_source: 'NONE' },
  { session_id: S, student_id: 'stu-b', student_name: 'B', roll: '2', state: 'UNCONFIRMED', decision_source: 'NONE' },
  { session_id: S, student_id: 'stu-c', student_name: 'C', roll: '3', state: 'UNCONFIRMED', decision_source: 'NONE' },
] as const;
const rosterIds = new Set(roster.map(s => s.student_id as string));

function face(n: number, studentId: string | null, score: number, extra: Record<string, unknown> = {}) {
  return { faceNumber: n, faceId: `f${n}`, boundingBox: { x: 10 * n, y: 20, width: 40, height: 40 }, detectionConfidence: 0.95, status: 'MATCHED', studentId, score, ...extra };
}
function analysis(threshold: number, photos: { photoId: string; results: ReturnType<typeof face>[] }[]): RecognitionAnalysis {
  return {
    photos: photos.map(p => ({ ...p, imageWidth: 1000, imageHeight: 500 })), matchedStudentIds: [], attendanceStatus: 'PROPOSED',
    analysisId: 'an', thresholdPercentage: threshold, initiatingUser: 't', initiatingRole: 'TEACHER', analyzedAt: '',
  };
}

describe('shared review logic', () => {
  it('is byte-identical to the web application module, so web and mobile decide the same way', () => {
    const web = join(__dirname, '..', '..', 'frontend', 'src', 'attendanceReview.ts');
    const mobile = join(__dirname, '..', 'src', 'review', 'attendanceReview.ts');
    expect(readFileSync(mobile, 'utf8')).toBe(readFileSync(web, 'utf8'));
  });
});

describe('recognition review', () => {
  it('uses the analysis threshold inclusively (score >= threshold)', () => {
    const result = analysis(70, [{ photoId: 'p1', results: [face(1, 'stu-a', 0.70), face(2, 'stu-b', 0.6999)] }]);
    const selected = eligibleAutoSelections(result, S, rosterIds, [], {}, {});
    expect(Object.values(selected).map(s => s.studentId)).toEqual(['stu-a']);
  });

  it('isolates thresholds per analysis: the same scores differ only by the request threshold', () => {
    const faces = [{ photoId: 'p1', results: [face(1, 'stu-a', 0.75)] }];
    expect(Object.keys(eligibleAutoSelections(analysis(70, faces), S, rosterIds, [], {}, {}))).toHaveLength(1);
    expect(Object.keys(eligibleAutoSelections(analysis(80, faces), S, rosterIds, [], {}, {}))).toHaveLength(0);
  });

  it('does not auto-select ambiguous matches or students outside the session roster', () => {
    const result = analysis(50, [{ photoId: 'p1', results: [face(1, 'stu-a', 0.9, { ambiguous: true }), face(2, 'outsider', 0.95)] }]);
    expect(eligibleAutoSelections(result, S, rosterIds, [], {}, {})).toEqual({});
  });

  it('merges a student matched in several photos into one PRESENT record', () => {
    const result = analysis(60, [
      { photoId: 'p1', results: [face(1, 'stu-a', 0.8)] },
      { photoId: 'p2', results: [face(1, 'stu-a', 0.85)] },
    ]);
    const selections = eligibleAutoSelections(result, S, rosterIds, [], {}, {});
    expect(Object.keys(selections)).toHaveLength(2);
    const derived = deriveRoster([...roster], {}, selections, S);
    expect(derived).toHaveLength(3);
    expect(derived.filter(s => s.state === 'PRESENT')).toEqual([expect.objectContaining({ student_id: 'stu-a', decision_source: 'AI' })]);
  });

  it('keeps an explicit teacher correction when the same photos are re-analyzed', () => {
    const files = [photoFingerprint('client-1') as unknown as File];
    const overrideKey = logicalFaceKey(S, files[0], 1, 0);
    const reanalysis = analysis(60, [{ photoId: 'new-photo-id', results: [face(1, 'stu-a', 0.9)] }]);
    const selections = eligibleAutoSelections(reanalysis, S, rosterIds, files, { [overrideKey]: 'stu-b' }, {});
    expect(selections[detectionKey(S, 'new-photo-id', 'f1')]).toEqual({ studentId: 'stu-b', source: 'MANUAL' });
  });

  it('keeps manual attendance decisions over AI suggestions', () => {
    const derived = deriveRoster([...roster], { 'stu-a': 'ABSENT' }, { [`${S}:p1:f1`]: { studentId: 'stu-a', source: 'AI' } }, S);
    expect(derived[0]).toMatchObject({ state: 'ABSENT', decision_source: 'MANUAL' });
  });

  it('flags two faces in one photo assigned to the same student', () => {
    const result = analysis(60, [{ photoId: 'p1', results: [face(1, 'stu-a', 0.8), face(2, 'stu-b', 0.8)] }]);
    const selections = {
      [detectionKey(S, 'p1', 'f1')]: { studentId: 'stu-a', source: 'AI' as const },
      [detectionKey(S, 'p1', 'f2')]: { studentId: 'stu-a', source: 'MANUAL' as const },
    };
    expect([...identityConflicts(result, selections, S)].sort()).toEqual([detectionKey(S, 'p1', 'f1'), detectionKey(S, 'p1', 'f2')]);
  });

  it('ignores responses for an earlier request or another session', () => {
    expect(isCurrentAnalysisResponse(S, S, 3, 3)).toBe(true);
    expect(isCurrentAnalysisResponse(S, S, 4, 3)).toBe(false);
    expect(isCurrentAnalysisResponse('other', S, 3, 3)).toBe(false);
  });

  it('distinguishes unsaved changes from the saved draft and totals the roster', () => {
    const saved = [...roster];
    expect(hasUnsavedChanges(saved, saved)).toBe(false);
    const edited = saved.map(s => (s.student_id === 'stu-a' ? { ...s, state: 'PRESENT' as const, decision_source: 'MANUAL' as const } : s));
    expect(hasUnsavedChanges(saved, edited)).toBe(true);
    expect(rosterTotals(edited)).toEqual({ present: 1, absent: 0, unconfirmed: 2, total: 3 });
  });
});

describe('face box alignment', () => {
  it('scales boxes from analyzed pixels by the same fit as the image', () => {
    const fit = fitImage(2000, 1000, 400, 420);
    expect(fit).toEqual({ width: 400, height: 200, scale: 0.2 });
    expect(boxToView({ x: 1000, y: 500, width: 100, height: 50 }, fit)).toEqual({ left: 200, top: 100, width: 20, height: 10 });
  });
  it('limits tall images by height', () => {
    const fit = fitImage(1000, 3000, 400, 420);
    expect(fit.height).toBeCloseTo(420);
    expect(fit.width).toBeCloseTo(140);
  });
  it('detects an orientation mismatch between the preview and the analyzed image', () => {
    expect(dimensionsMatch({ width: 1600, height: 1200 }, { imageWidth: 1600, imageHeight: 1200 })).toBe(true);
    expect(dimensionsMatch({ width: 1200, height: 1600 }, { imageWidth: 1600, imageHeight: 1200 })).toBe(false);
  });
});
