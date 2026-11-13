import { useQueryClient } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import React, { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ApiError, describeError } from '../api/client';
import { admin as adminApi, student as studentApi } from '../api/endpoints';
import type { SubmissionResult } from '../api/types';
import { PhotoTray, SubmitBlockers, UploadStages, type SubmissionStage } from '../photos/PhotoTray';
import { mapServerPhotoErrors } from '../photos/rules';
import { usePhotoSet } from '../photos/usePhotoSet';
import { Banner, Button, Card, Checkbox, H2, Muted } from '../ui/components';
import { colors, radius, space } from '../ui/theme';

type Props = {
  mode: 'student' | 'admin';
  student: { id: string; name: string; roll: string };
  onCompleted?: (result: SubmissionResult) => void;
};

type Outcome =
  | { kind: 'success'; result: SubmissionResult }
  | { kind: 'actionRequired'; message: string }
  | { kind: 'failed'; error: unknown };

/**
 * Face enrollment photo submission. Student submissions become PENDING_REVIEW and are not used
 * for recognition until an administrator approves them. Admin submissions follow the existing
 * direct-admin policy: the backend activates them only after processing and storage succeed.
 */
export function FaceEnrollmentForm({ mode, student, onCompleted }: Props) {
  const queryClient = useQueryClient();
  const photos = usePhotoSet('enrollment', `${mode}:${student.id}`);
  const [consent, setConsent] = useState(false);
  const [identityVerified, setIdentityVerified] = useState(false);
  const [stage, setStage] = useState<SubmissionStage>('idle');
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  // Reused only when retrying after an uncertain (lost) response, so the backend can replay it.
  const submissionId = useRef<string>(randomUUID());
  const [uncertain, setUncertain] = useState(false);
  const busy = stage === 'uploading' || stage === 'processing';
  const consentGiven = mode === 'student' ? consent : consent && identityVerified;
  const check = photos.check({ consent: consentGiven, busy });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: mode === 'student' ? ['student'] : ['admin'] });
  };

  async function submit() {
    if (!check.canSubmit) return;
    if (!uncertain) submissionId.current = randomUUID();
    const sent = photos.ready;
    setOutcome(null);
    try {
      const files = sent.map((item, index) => ({
        field: 'images', uri: item.uri!, name: `face-${index + 1}.jpg`, type: 'image/jpeg' as const,
      }));
      const result = mode === 'student'
        ? await studentApi.submitFaces(files, submissionId.current, setStage)
        : await adminApi.enrollFaces(student.id, files, submissionId.current, setStage);
      setUncertain(false);
      setStage('done');
      setOutcome({ kind: 'success', result });
      photos.clear();
      setConsent(false);
      setIdentityVerified(false);
      refresh();
      onCompleted?.(result);
    } catch (error) {
      setStage('failed');
      if (error instanceof ApiError && error.uncertain) {
        setUncertain(true); // Retry with the same submission ID; the server replays a completed one.
        refresh();
      } else {
        setUncertain(false);
      }
      if (error instanceof ApiError && error.photoErrors.length) {
        photos.flag(mapServerPhotoErrors(sent.map(item => item.clientId), error.photoErrors, 'enrollment'));
        setOutcome({
          kind: 'actionRequired',
          message: `${error.photoErrors.length} photo${error.photoErrors.length === 1 ? '' : 's'} need replacing. `
            + 'Your other photos are kept. Replace the highlighted photos and submit again.'
            + (error.previousEnrollmentPreserved ? ' The previous active enrollment is unchanged.' : ''),
        });
      } else {
        setOutcome({ kind: 'failed', error });
      }
    }
  }

  return (
    <View>
      <Card style={styles.identity}>
        <Muted>{mode === 'admin' ? 'Submitting enrollment photos for' : 'Submitting your face photos'}</Muted>
        <Text style={styles.name} accessibilityRole="header">{student.name}</Text>
        <Text style={styles.roll}>Roll {student.roll}</Text>
      </Card>

      {mode === 'student' ? (
        <Card>
          <H2>Biometric consent</H2>
          <Muted>
            Face photos are optional. You can always be marked manually by your teacher instead. If you continue,
            a face template is created from these photos and, after an administrator approves it, used only to
            suggest attendance in your enrolled classes. You can withdraw consent at any time from your profile,
            which deletes your face templates. Historical attendance is kept.
          </Muted>
          <Checkbox checked={consent} onChange={setConsent} disabled={busy}
            label="I consent to the processing of my face photos for attendance recognition." />
        </Card>
      ) : (
        <Card>
          <H2>Identity and consent</H2>
          <Muted>The enrollment becomes active only after processing and secure storage succeed.</Muted>
          <Checkbox checked={identityVerified} onChange={setIdentityVerified} disabled={busy}
            label={`I verified that the person photographed is ${student.name} (${student.roll}).`} />
          <Checkbox checked={consent} onChange={setConsent} disabled={busy}
            label="The student's explicit biometric consent is recorded." />
        </Card>
      )}

      <Card>
        <H2>Photos</H2>
        <PhotoTray set={photos} profile="enrollment" disabled={busy} />
      </Card>

      <UploadStages stage={stage} serverStepLabel="Validating faces and processing on the server" />

      {outcome?.kind === 'success' ? (
        <Banner tone="success" title={statusTitle(outcome.result.status, mode)}>
          {statusDetail(outcome.result, mode, student)}
        </Banner>
      ) : null}
      {outcome?.kind === 'actionRequired' ? <Banner tone="warning" title="Action required">{outcome.message}</Banner> : null}
      {outcome?.kind === 'failed' ? (
        <Banner tone="error" title="Submission failed">
          {describeError(outcome.error)}
          {outcome.error instanceof ApiError && outcome.error.uncertain
            ? ' Retrying is safe: the same submission is reused and will not be duplicated.' : ''}
        </Banner>
      ) : null}

      <SubmitBlockers reasons={check.reasons.filter(reason => reason !== 'A submission is in progress.')} />
      <Button
        title={busy ? 'Submitting…' : uncertain ? 'Retry submission' : mode === 'student' ? 'Submit for review' : 'Enroll student'}
        onPress={() => void submit()}
        disabled={!check.canSubmit}
        loading={busy}
      />
    </View>
  );
}

function statusTitle(status: string, mode: 'student' | 'admin') {
  if (status === 'PENDING_REVIEW') return 'Pending review';
  if (status === 'ACTIVE') return mode === 'admin' ? 'Enrollment active' : 'Active';
  return `Status: ${status.replace('_', ' ').toLowerCase()}`;
}

function statusDetail(result: SubmissionResult, mode: 'student' | 'admin', student: { name: string; roll: string }) {
  const who = `${student.name} (${student.roll})`;
  if (result.status === 'PENDING_REVIEW') {
    return `${result.acceptedPhotoCount} photos for ${who} are waiting for administrator review. They are not used for recognition yet.`;
  }
  if (result.status === 'ACTIVE') {
    return mode === 'admin'
      ? `${who} is enrolled with ${result.acceptedPhotoCount} photos and can now be recognized.`
      : 'Your enrollment is active.';
  }
  return 'This submission was already processed earlier. Check its current status in the list.';
}

const styles = StyleSheet.create({
  identity: { backgroundColor: colors.primarySoft, borderColor: colors.primarySoft, borderRadius: radius.lg, gap: 2, marginBottom: space.lg },
  name: { fontSize: 24, fontWeight: '800', color: colors.text },
  roll: { fontSize: 18, fontWeight: '700', color: colors.primaryDark },
});
