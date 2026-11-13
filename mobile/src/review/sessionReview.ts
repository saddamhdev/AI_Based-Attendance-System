import type { RecognitionAnalysis, SessionRosterEntry } from '../api/types';
import { detectionKey, type FaceSelection } from './attendanceReview';

/**
 * The shared review logic fingerprints a photo by name/size/lastModified (web File objects).
 * On mobile each selected photo has a stable client ID, which is a stronger fingerprint.
 */
export function photoFingerprint(clientId: string): { name: string; size: number; lastModified: number } {
  return { name: clientId, size: 0, lastModified: 0 };
}

/**
 * Within one photo, one student can be only one face. Flags every face whose selected student
 * is also selected for another face in the same photo, so the reviewer resolves it manually.
 * The same student appearing in different photos is a normal repeat and merges into one record.
 */
export function identityConflicts(
  analysis: RecognitionAnalysis | null,
  selections: Record<string, FaceSelection>,
  sessionId: string,
): Set<string> {
  const conflicted = new Set<string>();
  if (!analysis) return conflicted;
  for (const photo of analysis.photos) {
    const byStudent = new Map<string, string[]>();
    for (const face of photo.results) {
      const key = detectionKey(sessionId, photo.photoId, String(face.faceId ?? ''));
      const selection = selections[key];
      if (!selection) continue;
      byStudent.set(selection.studentId, [...(byStudent.get(selection.studentId) ?? []), key]);
    }
    for (const keys of byStudent.values()) if (keys.length > 1) keys.forEach(key => conflicted.add(key));
  }
  return conflicted;
}

export function rosterTotals(roster: Pick<SessionRosterEntry, 'state'>[]) {
  return {
    present: roster.filter(entry => entry.state === 'PRESENT').length,
    absent: roster.filter(entry => entry.state === 'ABSENT').length,
    unconfirmed: roster.filter(entry => entry.state === 'UNCONFIRMED').length,
    total: roster.length,
  };
}

/** True when the on-screen roster differs from what the server last saved. */
export function hasUnsavedChanges(
  saved: Pick<SessionRosterEntry, 'student_id' | 'state' | 'decision_source'>[],
  current: Pick<SessionRosterEntry, 'student_id' | 'state' | 'decision_source'>[],
): boolean {
  const byId = new Map(saved.map(entry => [String(entry.student_id), entry]));
  return current.some(entry => {
    const before = byId.get(String(entry.student_id));
    return !before || before.state !== entry.state
      || (before.decision_source || 'NONE') !== (entry.decision_source || 'NONE');
  });
}

export type Fit = { width: number; height: number; scale: number };

/** Contain-fits an image of the analyzed pixel size into a container width. */
export function fitImage(imageWidth: number, imageHeight: number, containerWidth: number, maxHeight: number): Fit {
  if (!(imageWidth > 0 && imageHeight > 0 && containerWidth > 0 && maxHeight > 0)) return { width: 0, height: 0, scale: 0 };
  const scale = Math.min(containerWidth / imageWidth, maxHeight / imageHeight);
  return { width: imageWidth * scale, height: imageHeight * scale, scale };
}

/**
 * Converts a bounding box in analyzed-image pixels to view coordinates. Boxes are rendered
 * inside the same transformed view as the image, so zoom/pan transforms apply to both.
 */
export function boxToView(box: { x: number; y: number; width: number; height: number }, fit: Fit) {
  return { left: box.x * fit.scale, top: box.y * fit.scale, width: box.width * fit.scale, height: box.height * fit.scale };
}

/** Detects a mismatch between the uploaded file and what the server decoded (e.g. a rotation). */
export function dimensionsMatch(local: { width?: number; height?: number }, server: { imageWidth: number; imageHeight: number }) {
  if (!local.width || !local.height) return true;
  return Math.abs(local.width / local.height - server.imageWidth / server.imageHeight) < 0.01;
}

/** The session version/status check that follows an uncertain confirmation response. */
export function confirmationOutcome(status: string | undefined): 'finalized' | 'notFinalized' {
  return status === 'FINALIZED' ? 'finalized' : 'notFinalized';
}
