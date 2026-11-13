import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError } from '../../api/client';
import { staff } from '../../api/endpoints';
import type { RecognitionAnalysis, SessionDetail, SessionRosterEntry } from '../../api/types';
import type { UploadStage } from '../../api/client';
import {
  deriveRoster, detectionKey, draftAttendancePayload, eligibleAutoSelections, isCurrentAnalysisResponse,
  logicalFaceKey, onlyManualFaceSelections, type FaceSelection,
} from '../../review/attendanceReview';
import { hasUnsavedChanges, photoFingerprint } from '../../review/sessionReview';
import type { PhotoItem } from '../../photos/rules';

export type AnalyzedPhoto = { clientId: string; uri: string; width?: number; height?: number };

export type ReviewState = {
  detail: SessionDetail;
  baseRoster: SessionRosterEntry[];
  roster: SessionRosterEntry[];
  manualStates: Record<string, string>;
  faceSelections: Record<string, FaceSelection>;
  manualFaceOverrides: Record<string, string | null>;
  analysis: RecognitionAnalysis | null;
  /** Photos (by stable client ID) that produced `analysis`, in upload order. */
  analyzedPhotos: AnalyzedPhoto[];
};

export function initialReview(detail: SessionDetail): ReviewState {
  const id = String(detail.session.id);
  const analysis = detail.recognitionAnalysis;
  const rosterIds = new Set(detail.roster.map(student => String(student.student_id)));
  const faceSelections = analysis ? eligibleAutoSelections(analysis, id, rosterIds, [], {}, {}) : {};
  const roster = detail.session.status === 'FINALIZED'
    ? detail.roster
    : deriveRoster(detail.roster, {}, faceSelections, id) as SessionRosterEntry[];
  return { detail, baseRoster: detail.roster, roster, manualStates: {}, faceSelections, manualFaceOverrides: {}, analysis, analyzedPhotos: [] };
}

export type ReviewAction = 'idle' | 'analyzing' | 'saving' | 'confirming';

/**
 * Review state for one session. All updates check the session ID, and analysis responses
 * carry a request number, so a slow response for an earlier request or another session is ignored.
 */
export function useSessionReview(sessionId: string, initial: SessionDetail | undefined) {
  const queryClient = useQueryClient();
  const [review, setReview] = useState<ReviewState | null>(initial ? initialReview(initial) : null);
  const [source, setSource] = useState({ sessionId, initial });
  const [action, setAction] = useState<ReviewAction>('idle');
  const [uploadStage, setUploadStage] = useState<UploadStage | null>(null);
  const activeSession = useRef(sessionId);
  const analysisRequest = useRef(0);

  // Re-initialize only when the session changes or fresh server data is explicitly loaded.
  if (source.sessionId !== sessionId || source.initial !== initial) {
    setSource({ sessionId, initial });
    setReview(initial && String(initial.session.id) === sessionId ? initialReview(initial) : null);
  }
  useEffect(() => {
    activeSession.current = sessionId;
    analysisRequest.current += 1;
  }, [sessionId, initial]);

  const update = useCallback((fn: (current: ReviewState) => ReviewState) => {
    setReview(current => (current && String(current.detail.session.id) === activeSession.current ? fn(current) : current));
  }, []);

  const finalized = review?.detail.session.status === 'FINALIZED';
  const dirty = Boolean(review && !finalized && hasUnsavedChanges(review.baseRoster, review.roster));

  const setStudentState = (studentId: string, value: string) => update(current => {
    const manualStates = { ...current.manualStates, [studentId]: value };
    return { ...current, manualStates, roster: deriveRoster(current.baseRoster, manualStates, current.faceSelections, sessionId) as SessionRosterEntry[] };
  });

  const markRemainingAbsent = () => update(current => {
    const manualStates = { ...current.manualStates };
    for (const student of current.roster) if (student.state === 'UNCONFIRMED') manualStates[String(student.student_id)] = 'ABSENT';
    return { ...current, manualStates, roster: deriveRoster(current.baseRoster, manualStates, current.faceSelections, sessionId) as SessionRosterEntry[] };
  });

  /** A teacher's explicit face assignment; remembered per logical face so re-analysis keeps it. */
  const selectFace = (photoIndex: number, faceId: string, faceNumber: number, studentId: string) => update(current => {
    if (!current.analysis) return current;
    const photo = current.analysis.photos[photoIndex];
    const key = detectionKey(sessionId, String(photo.photoId), faceId);
    const analyzed = current.analyzedPhotos[photoIndex];
    const overrideKey = logicalFaceKey(sessionId, analyzed ? photoFingerprint(analyzed.clientId) as unknown as File : undefined, faceNumber, photoIndex);
    const faceSelections = { ...current.faceSelections };
    const manualFaceOverrides = { ...current.manualFaceOverrides };
    if (studentId) {
      faceSelections[key] = { studentId, source: 'MANUAL' };
      manualFaceOverrides[overrideKey] = studentId;
    } else {
      delete faceSelections[key];
      manualFaceOverrides[overrideKey] = null;
    }
    return { ...current, faceSelections, manualFaceOverrides,
      roster: deriveRoster(current.baseRoster, current.manualStates, faceSelections, sessionId) as SessionRosterEntry[] };
  });

  /** Uploads 1–3 classroom photos; the backend applies the initiating user's saved threshold. */
  const analyze = async (photos: PhotoItem[]) => {
    if (!review || finalized) return;
    const requestId = ++analysisRequest.current;
    const sent: AnalyzedPhoto[] = photos.map(photo => ({ clientId: photo.clientId, uri: photo.uri!, width: photo.width, height: photo.height }));
    setAction('analyzing');
    update(current => {
      const faceSelections = onlyManualFaceSelections(current.faceSelections);
      return { ...current, analysis: null, faceSelections,
        roster: deriveRoster(current.baseRoster, current.manualStates, faceSelections, sessionId) as SessionRosterEntry[] };
    });
    try {
      const result = await staff.recognize(sessionId, sent.map((photo, index) => ({
        field: 'images', uri: photo.uri, name: `classroom-${index + 1}.jpg`, type: 'image/jpeg' as const,
      })), setUploadStage);
      if (!isCurrentAnalysisResponse(activeSession.current, sessionId, analysisRequest.current, requestId)) return null;
      update(current => {
        const rosterIds = new Set(current.baseRoster.map(student => String(student.student_id)));
        const files = sent.map(photo => photoFingerprint(photo.clientId) as unknown as File);
        const faceSelections = eligibleAutoSelections(result, sessionId, rosterIds, files, current.manualFaceOverrides, current.faceSelections);
        return { ...current, analysis: result, analyzedPhotos: sent, faceSelections,
          roster: deriveRoster(current.baseRoster, current.manualStates, faceSelections, sessionId) as SessionRosterEntry[] };
      });
      return result;
    } catch (error) {
      if (!isCurrentAnalysisResponse(activeSession.current, sessionId, analysisRequest.current, requestId)) return null;
      throw error;
    } finally {
      if (requestId === analysisRequest.current) {
        setAction('idle');
        setUploadStage(null);
      }
    }
  };

  const applyServerDetail = (data: SessionDetail) => update(current => ({
    ...current,
    detail: data,
    baseRoster: data.roster,
    roster: data.session.status === 'FINALIZED'
      ? data.roster
      : deriveRoster(data.roster, current.manualStates, current.faceSelections, sessionId) as SessionRosterEntry[],
  }));

  /**
   * Saves the draft. If the response is lost, re-reads the session: a version change whose
   * states match what was sent means the save landed, so it is not repeated.
   */
  const saveDraft = async (): Promise<SessionDetail> => {
    if (!review) throw new Error('Session not loaded');
    const payload = draftAttendancePayload(review.roster);
    setAction('saving');
    try {
      const data = await staff.saveDraft(sessionId, review.detail.session.version, payload.states, payload.sources);
      applyServerDetail(data);
      return data;
    } catch (error) {
      if (error instanceof ApiError && error.uncertain) {
        const latest = await staff.session(sessionId).catch(() => null);
        if (latest && latest.session.version > review.detail.session.version
          && latest.roster.every(entry => payload.states[entry.student_id] === entry.state)) {
          applyServerDetail(latest);
          return latest;
        }
      }
      throw error;
    } finally {
      setAction('idle');
      void queryClient.invalidateQueries({ queryKey: ['staff', 'sessions'] });
    }
  };

  /** Saves then finalizes. Never automatic. After an uncertain result the session status is checked first. */
  const confirm = async (): Promise<SessionDetail> => {
    const saved = await saveDraft();
    setAction('confirming');
    try {
      const data = await staff.confirm(sessionId, saved.session.version);
      applyServerDetail(data);
      return data;
    } catch (error) {
      if (error instanceof ApiError && error.uncertain) {
        const latest = await staff.session(sessionId).catch(() => null);
        if (latest?.session.status === 'FINALIZED') {
          applyServerDetail(latest);
          return latest;
        }
      }
      throw error;
    } finally {
      setAction('idle');
      void queryClient.invalidateQueries({ queryKey: ['staff'] });
      void queryClient.invalidateQueries({ queryKey: ['reports'] });
    }
  };

  return { review, action, uploadStage, finalized, dirty, setStudentState, markRemainingAbsent, selectFace, analyze, saveDraft, confirm };
}
