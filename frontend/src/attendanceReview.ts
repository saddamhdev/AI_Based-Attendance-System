export type FaceSelection = {
  studentId: string;
  source: 'AI' | 'MANUAL';
};

type Detection = Record<string, any>;
type RecognitionPhoto = {
  photoId: string;
  results: Detection[];
};
type RecognitionResponse = {
  photos: RecognitionPhoto[];
};
type ReviewPhotoFile = Pick<File, 'name' | 'size' | 'lastModified'>;

export function detectionKey(sessionId: string, photoId: string, faceId: string): string {
  return `${sessionId}:${photoId}:${faceId}`;
}

export function onlyManualFaceSelections(selections: Record<string, FaceSelection>): Record<string, FaceSelection> {
  return Object.fromEntries(
    Object.entries(selections).filter(([, selection]) => selection.source === 'MANUAL'),
  );
}

export function logicalFaceKey(sessionId: string, file: ReviewPhotoFile | undefined, faceNumber: number, photoIndex: number): string {
  const fingerprint = file ? `${file.name}:${file.size}:${file.lastModified}` : 'unknown';
  return `${sessionId}:${photoIndex}:${fingerprint}:${faceNumber}`;
}

export function eligibleAutoSelections(
  recognition: RecognitionResponse,
  sessionId: string,
  rosterStudentIds: Set<string>,
  threshold: number,
  files: ReviewPhotoFile[],
  manualFaceOverrides: Record<string, string | null>,
  previousManualSelections: Record<string, FaceSelection>,
): Record<string, FaceSelection> {
  const selections: Record<string, FaceSelection> = {};

  for (const [key, selection] of Object.entries(previousManualSelections)) {
    if (selection.source === 'MANUAL' && key.startsWith(`${sessionId}:`)) {
      selections[key] = selection;
    }
  }

  recognition.photos.forEach((photo, photoIndex) => {
    const assignedStudentCounts = new Map<string, number>();
    for (const result of photo.results) {
      if (typeof result.studentId === 'string' && result.studentId) {
        assignedStudentCounts.set(result.studentId, (assignedStudentCounts.get(result.studentId) || 0) + 1);
      }
    }

    for (const result of photo.results) {
      const key = detectionKey(sessionId, photo.photoId, String(result.faceId ?? ''));
      const overrideKey = logicalFaceKey(sessionId, files[photoIndex], Number(result.faceNumber), photoIndex);
      if (Object.prototype.hasOwnProperty.call(manualFaceOverrides, overrideKey)) {
        const studentId = manualFaceOverrides[overrideKey];
        if (studentId && rosterStudentIds.has(studentId)) {
          selections[key] = { studentId, source: 'MANUAL' };
        }
        continue;
      }

      const score = result.score;
      const hasConflict = Boolean(
        result.ambiguous
        || result.ambiguity
        || result.identityConflict
        || result.identity_conflict
        || result.hasConflict
        || result.hasAmbiguity
        || result.isAmbiguous
        || result.conflict
        || (typeof result.studentId === 'string' && (assignedStudentCounts.get(result.studentId) || 0) > 1),
      );
      if (
        result.status === 'MATCHED'
        && typeof photo.photoId === 'string'
        && photo.photoId.length > 0
        && typeof result.faceId === 'string'
        && result.faceId.length > 0
        && typeof result.studentId === 'string'
        && rosterStudentIds.has(result.studentId)
        && typeof score === 'number'
        && Number.isFinite(score)
        && score > threshold
        && !hasConflict
      ) {
        selections[key] = { studentId: result.studentId, source: 'AI' };
      }
    }
  });

  return selections;
}

export function deriveRoster(
  baseRoster: Record<string, any>[],
  manualStates: Record<string, string>,
  faceSelections: Record<string, FaceSelection>,
  sessionId: string,
): Record<string, any>[] {
  const selectedByStudent = new Map<string, Set<FaceSelection['source']>>();
  for (const [key, selection] of Object.entries(faceSelections)) {
    if (!key.startsWith(`${sessionId}:`)) continue;
    const sources = selectedByStudent.get(selection.studentId) || new Set<FaceSelection['source']>();
    sources.add(selection.source);
    selectedByStudent.set(selection.studentId, sources);
  }

  return baseRoster.map(student => {
    const id = String(student.student_id);
    if (Object.prototype.hasOwnProperty.call(manualStates, id)) {
      return { ...student, state: manualStates[id], decision_source: 'MANUAL' };
    }
    if (student.decision_source === 'MANUAL') {
      return { ...student, decision_source: 'MANUAL' };
    }
    if (student.decision_source !== 'AI' && student.state !== 'UNCONFIRMED') {
      return { ...student, decision_source: 'MANUAL' };
    }
    const sources = selectedByStudent.get(id);
    if (sources?.has('MANUAL')) {
      return { ...student, state: 'PRESENT', decision_source: 'MANUAL' };
    }
    if (sources?.has('AI')) {
      return { ...student, state: 'PRESENT', decision_source: 'AI' };
    }
    if (student.decision_source === 'AI') {
      return { ...student, state: 'UNCONFIRMED', decision_source: 'NONE' };
    }
    return { ...student, decision_source: student.decision_source || 'NONE' };
  });
}

export function formatSimilarity(score: unknown): string {
  return typeof score === 'number' && Number.isFinite(score)
    ? `Similarity ${(score * 100).toFixed(2)}%`
    : 'Similarity unavailable';
}

export function isCurrentAnalysisResponse(
  activeSessionId: string,
  responseSessionId: string,
  currentRequestId: number,
  responseRequestId: number,
): boolean {
  return activeSessionId === responseSessionId && currentRequestId === responseRequestId;
}

export function draftAttendancePayload(roster: Record<string, any>[]): {
  states: Record<string, string>;
  sources: Record<string, string>;
} {
  return {
    states: Object.fromEntries(roster.map(student => [student.student_id, student.state])),
    sources: Object.fromEntries(roster.map(student => [student.student_id, student.decision_source || 'NONE'])),
  };
}
