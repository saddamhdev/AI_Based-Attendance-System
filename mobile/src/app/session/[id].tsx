import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams, usePreventRemove } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { ApiError, describeError } from '../../api/client';
import { admin, staff } from '../../api/endpoints';
import type { AttendanceState } from '../../api/types';
import { useMe } from '../../auth/AuthProvider';
import { PhotoViewer } from '../../features/session/PhotoViewer';
import { useSessionReview } from '../../features/session/useSessionReview';
import { PhotoTray, SubmitBlockers, UploadStages } from '../../photos/PhotoTray';
import { usePhotoSet } from '../../photos/usePhotoSet';
import { detectionKey, formatSimilarity } from '../../review/attendanceReview';
import { identityConflicts, rosterTotals } from '../../review/sessionReview';
import { Banner, Button, Card, ErrorBanner, H2, Loading, Muted, Pill, Row, Screen, Select } from '../../ui/components';
import { classTime, dateTime } from '../../ui/format';
import { colors, radius, space, touch } from '../../ui/theme';

const STATES: AttendanceState[] = ['PRESENT', 'ABSENT', 'UNCONFIRMED'];

export default function SessionReviewScreen() {
  const { id, overlap } = useLocalSearchParams<{ id: string; overlap?: string }>();
  const sessionId = String(id);
  const me = useMe();
  const queryClient = useQueryClient();
  // Loaded once per visit; refreshing would discard unsaved review edits, so it is explicit only.
  const query = useQuery({
    queryKey: ['staff', 'session', sessionId], queryFn: () => staff.session(sessionId),
    staleTime: Infinity, refetchOnWindowFocus: false, refetchOnReconnect: false,
  });
  const settings = useQuery({ queryKey: ['staff', 'recognition-settings'], queryFn: staff.recognitionSettings });
  const reviewer = useSessionReview(sessionId, query.data);
  const photos = usePhotoSet('classroom', `session:${sessionId}`);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [selectedFace, setSelectedFace] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState('');
  const { review, finalized, dirty, action } = reviewer;
  const busy = action !== 'idle';

  // Warn before leaving with unsaved review changes.
  usePreventRemove(dirty && !busy, ({ repeat }) => {
    Alert.alert('Discard unsaved changes?', 'Your attendance changes have not been saved as a draft.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: repeat },
    ]);
  });

  const conflicts = useMemo(
    () => identityConflicts(review?.analysis ?? null, review?.faceSelections ?? {}, sessionId),
    [review?.analysis, review?.faceSelections, sessionId],
  );

  if (query.isPending) return <Screen><Loading label="Loading session…" /></Screen>;
  if (!review) return <Screen><ErrorBanner error={query.error ?? new Error('Session unavailable')} onRetry={() => void query.refetch()} /></Screen>;

  const session = review.detail.session;
  const totals = rosterTotals(review.roster);
  const analysis = review.analysis;
  const analyzedPhoto = analysis?.photos[photoIndex] ?? null;
  const localPhoto = review.analyzedPhotos[photoIndex] ?? (analysis ? undefined : photos.ready[photoIndex]);
  const photoCount = analysis ? analysis.photos.length : photos.ready.length;
  const check = photos.check({ busy });
  const rosterOptions = [{ value: '', label: 'No student / not in roster' },
    ...review.roster.map(student => ({ value: String(student.student_id), label: `${student.roll} — ${student.student_name}` }))];
  const studentName = (studentId: string | null | undefined) =>
    review.roster.find(student => String(student.student_id) === studentId)?.student_name ?? 'Not in roster';

  async function run(task: () => Promise<unknown>, success?: string) {
    setError(null);
    setNotice('');
    try {
      await task();
      if (success) setNotice(success);
    } catch (failure) {
      setError(failure);
    }
  }

  async function analyze() {
    await run(async () => {
      setPhotoIndex(0);
      setSelectedFace(null);
      try {
        await reviewer.analyze(photos.ready);
      } catch (failure) {
        if (failure instanceof ApiError && typeof failure.photoIndex === 'number') {
          const target = photos.ready[failure.photoIndex - 1];
          if (target) photos.flag({ [target.clientId]: { code: failure.code ?? 'INVALID_IMAGE', message: failure.message, advice: 'Replace this photo and analyze again.' } });
        }
        throw failure;
      }
    });
  }

  function reload() {
    const go = () => {
      void queryClient.invalidateQueries({ queryKey: ['staff', 'session', sessionId] });
    };
    if (dirty) Alert.alert('Reload session?', 'Unsaved changes will be discarded.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Reload', onPress: go }]);
    else go();
  }

  const confirmAttendance = () => Alert.alert('Confirm and finalize attendance?',
    `${totals.present} present, ${totals.absent} absent. Finalized attendance cannot be edited in the app.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm', onPress: () => void run(() => reviewer.confirm(), 'Attendance confirmed and finalized.') },
    ]);

  const deleteSession = () => Alert.alert('Delete this session?', 'Only draft sessions can be deleted. This cannot be undone.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: () => void run(async () => {
      await admin.deleteSession(sessionId);
      await queryClient.invalidateQueries({ queryKey: ['staff'] });
      router.back();
    }) },
  ]);

  const isConflictMessage = error instanceof ApiError && error.status === 409;

  return (
    <Screen>
      <Card>
        <Row><Pill label={session.status} tone={finalized ? 'success' : 'warning'} />{dirty ? <Pill label="Unsaved changes" tone="error" /> : <Pill label={finalized ? 'Saved' : 'Draft saved'} tone="neutral" />}</Row>
        <H2>{session.offering_label}</H2>
        <Muted>{classTime(session)} · {session.teacher_name ?? 'Teacher unknown'}</Muted>
        {overlap ? <Banner tone="warning">This session overlaps another of your sessions for this offering on the same date.</Banner> : null}
      </Card>

      <Banner tone="info">
        {`AI suggestions are drafts and never finalize attendance. Similarity is a comparison score, not an accuracy probability. Your saved threshold is ${settings.data ? `${settings.data.threshold}%` : '…'}; faces at or above it are suggested.`}
      </Banner>
      {analysis ? (
        <Banner tone="info" title={`Analyzed using a ${analysis.thresholdPercentage}% threshold`}>
          {`Initiated by ${analysis.initiatingUser} (${analysis.initiatingRole}) at ${dateTime(analysis.analyzedAt)}.`}
        </Banner>
      ) : null}

      {notice ? <Banner tone="success">{notice}</Banner> : null}
      <ErrorBanner error={error} title="Action failed" />
      {isConflictMessage ? <Button title="Reload latest saved draft" variant="secondary" onPress={reload} /> : null}

      {!finalized ? (
        <Card>
          <H2>Classroom photos</H2>
          <PhotoTray set={photos} profile="classroom" disabled={busy} />
          <UploadStages stage={reviewer.uploadStage ?? (action === 'analyzing' ? 'uploading' : 'idle')} serverStepLabel="Detecting and matching faces on the server" />
          <SubmitBlockers reasons={check.reasons.filter(reason => reason !== 'A submission is in progress.')} />
          <Button title={analysis ? 'Re-analyze photos' : 'Analyze photos'} onPress={() => void analyze()} disabled={!check.canSubmit} loading={action === 'analyzing'}
            accessibilityHint="Your corrections are kept when photos are re-analyzed." />
        </Card>
      ) : null}

      {photoCount > 0 ? (
        <Card>
          <Row>
            {Array.from({ length: photoCount }, (_, index) => (
              <Button key={index} title={`Photo ${index + 1}`} variant={index === photoIndex ? 'primary' : 'secondary'}
                onPress={() => { setPhotoIndex(index); setSelectedFace(null); }} />
            ))}
          </Row>
          <PhotoViewer uri={localPhoto?.uri ?? null} localSize={localPhoto} photo={analyzedPhoto} sessionId={sessionId}
            selections={review.faceSelections} conflicts={conflicts} selectedKey={selectedFace} onSelectFace={setSelectedFace} />
          {analyzedPhoto ? (
            <View style={{ marginTop: space.md }}>
              <Muted>{analyzedPhoto.results.length} face{analyzedPhoto.results.length === 1 ? '' : 's'} detected in this photo.</Muted>
              {analyzedPhoto.results.map(face => {
                const key = detectionKey(sessionId, analyzedPhoto.photoId, String(face.faceId));
                const selection = review.faceSelections[key];
                const conflicted = conflicts.has(key);
                return (
                  <Pressable key={key} onPress={() => setSelectedFace(key)} accessibilityRole="button"
                    style={[styles.face, key === selectedFace && styles.faceSelected, conflicted && styles.faceConflict]}>
                    <Row>
                      <Text style={styles.faceTitle}>Face {face.faceNumber}</Text>
                      <Pill label={face.status} tone={face.status === 'MATCHED' ? 'success' : face.status === 'UNKNOWN' ? 'neutral' : 'warning'} />
                      {selection?.source === 'AI' ? <Pill label="AI suggested" tone="info" /> : null}
                      {selection?.source === 'MANUAL' ? <Pill label="Teacher decision" tone="info" /> : null}
                      {conflicted ? <Pill label="Conflict — review" tone="error" /> : null}
                    </Row>
                    <Muted>{formatSimilarity(face.score)} · Detection confidence {(face.detectionConfidence * 100).toFixed(0)}%{face.studentId ? ` · Best match: ${studentName(face.studentId)}` : ''}</Muted>
                    {!finalized ? (
                      <Select label="Assigned student" value={selection?.studentId ?? ''} options={rosterOptions} disabled={busy}
                        onChange={value => reviewer.selectFace(photoIndex, String(face.faceId), Number(face.faceNumber), value)} />
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </Card>
      ) : null}

      <Card>
        <H2>Roster</H2>
        <Text style={styles.totals} accessibilityLiveRegion="polite">
          {totals.present} present · {totals.absent} absent · {totals.unconfirmed} unconfirmed · {totals.total} total
        </Text>
        {review.roster.length === 0 ? <Muted>No students are enrolled in this offering.</Muted> : null}
        {review.roster.map(student => {
          const highlighted = selectedFace ? review.faceSelections[selectedFace]?.studentId === String(student.student_id) : false;
          return (
            <View key={student.student_id} style={[styles.student, highlighted && styles.studentHighlighted]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.studentName}>{student.student_name}</Text>
                <Muted>{student.roll}{student.state === 'PRESENT' && student.decision_source === 'AI' ? ' · AI suggested' : student.decision_source === 'MANUAL' ? ' · Teacher decision' : ''}</Muted>
              </View>
              <View style={styles.segment} accessibilityRole="radiogroup">
                {STATES.map(state => (
                  <Pressable key={state} accessibilityRole="radio" accessibilityState={{ checked: student.state === state, disabled: finalized || busy }}
                    accessibilityLabel={`${student.student_name} ${state.toLowerCase()}`}
                    disabled={finalized || busy} onPress={() => reviewer.setStudentState(String(student.student_id), state)}
                    style={[styles.segmentItem, student.state === state && styles[`seg_${state}`]]}>
                    <Text style={[styles.segmentText, student.state === state && { color: '#fff' }]}>{state === 'UNCONFIRMED' ? '?' : state[0]}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          );
        })}
        {!finalized ? (
          <>
            <Button title="Mark remaining unconfirmed absent" variant="secondary" onPress={reviewer.markRemainingAbsent} disabled={busy || totals.unconfirmed === 0} />
            <Button title="Save draft" onPress={() => void run(() => reviewer.saveDraft(), 'Draft saved.')} loading={action === 'saving'} disabled={busy} />
            {totals.unconfirmed > 0 ? <Muted>Confirm is disabled until every student is marked present or absent.</Muted> : null}
            {conflicts.size > 0 ? <Muted>Resolve conflicting face assignments before confirming.</Muted> : null}
            <Button title="Confirm attendance" onPress={confirmAttendance} loading={action === 'confirming'}
              disabled={busy || totals.unconfirmed > 0 || totals.total === 0 || conflicts.size > 0} />
          </>
        ) : <Banner tone="success">Attendance is finalized.</Banner>}
      </Card>

      <Card>
        <H2>Audit history</H2>
        {review.detail.audit.map(entry => <Muted key={entry.id}>{entry.actor} · {entry.action.split(' ')[0]} · {dateTime(entry.created_at)}</Muted>)}
      </Card>
      <Button title="Reload from server" variant="secondary" onPress={reload} disabled={busy} />
      {me.role === 'ADMIN' && !finalized ? <Button title="Delete session" variant="danger" onPress={deleteSession} disabled={busy} /> : null}
      {error && !(error instanceof ApiError) ? <Muted>{describeError(error)}</Muted> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  face: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: space.md, marginTop: space.sm, gap: 4 },
  faceSelected: { borderColor: colors.primary, borderWidth: 2 },
  faceConflict: { backgroundColor: colors.dangerSoft },
  faceTitle: { fontWeight: '700', color: colors.text },
  totals: { fontWeight: '700', color: colors.text, marginBottom: space.sm },
  student: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: colors.divider },
  studentHighlighted: { backgroundColor: colors.primarySoft },
  studentName: { fontWeight: '600', color: colors.text },
  segment: { flexDirection: 'row', borderRadius: radius.sm, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
  segmentItem: { minWidth: touch, minHeight: touch, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  segmentText: { fontWeight: '800', color: colors.muted },
  seg_PRESENT: { backgroundColor: colors.success },
  seg_ABSENT: { backgroundColor: colors.danger },
  seg_UNCONFIRMED: { backgroundColor: colors.subtle },
});
