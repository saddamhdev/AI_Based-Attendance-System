import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { student } from '../../api/endpoints';
import type { FaceSubmission } from '../../api/types';
import { FaceEnrollmentForm } from '../../features/FaceEnrollmentForm';
import { Banner, Body, Button, Card, ErrorBanner, H2, Loading, Muted, Pill, QueryView, Row, Screen, SecureImage } from '../../ui/components';
import { dateTime } from '../../ui/format';
import { useMe } from '../../auth/AuthProvider';

const tone = { ACTIVE: 'success', PENDING_REVIEW: 'warning', REJECTED: 'error', CANCELLED: 'neutral', RETIRED: 'neutral' } as const;
const label = { ACTIVE: 'Active', PENDING_REVIEW: 'Pending review', REJECTED: 'Action required', CANCELLED: 'Cancelled', RETIRED: 'Replaced' };

function Gallery({ submission }: { submission: FaceSubmission }) {
  const photos = useQuery({
    queryKey: ['student', 'faces', submission.id, 'photos'],
    queryFn: () => student.facePhotos(submission.id),
  });
  if (photos.isPending) return <Loading label="Loading photos…" />;
  if (photos.error) return <ErrorBanner error={photos.error} onRetry={() => void photos.refetch()} />;
  if (!photos.data?.length) return <Muted>Photos are no longer stored for this submission.</Muted>;
  return (
    <View style={styles.grid}>
      {photos.data.map(photo => (
        <SecureImage key={photo.id} path={student.facePhotoPath(submission.id, photo.id)} style={styles.thumb}
          accessibilityLabel={`Your enrollment photo ${photo.photo_index + 1}`} />
      ))}
    </View>
  );
}

export default function StudentPhotos() {
  const me = useMe();
  const queryClient = useQueryClient();
  const submissions = useQuery({ queryKey: ['student', 'faces'], queryFn: student.faceSubmissions });
  const [showForm, setShowForm] = useState(false);
  const cancel = useMutation({
    mutationFn: student.cancelSubmission,
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['student'] }),
  });

  const confirmCancel = (id: string) => Alert.alert('Cancel this submission?', 'The pending photos will be discarded. Your active enrollment, if any, is unchanged.', [
    { text: 'Keep it', style: 'cancel' },
    { text: 'Cancel submission', style: 'destructive', onPress: () => cancel.mutate(id) },
  ]);

  return (
    <Screen refreshing={submissions.isRefetching} onRefresh={() => {
      void submissions.refetch();
      void queryClient.invalidateQueries({ queryKey: ['student', 'faces'] });
      void queryClient.invalidateQueries({ queryKey: ['private-image'] });
    }}>
      <Banner tone="info" title="Optional">
        Face enrollment is optional. Without it your teacher marks your attendance manually. Approving your account
        and approving your face photos are separate steps.
      </Banner>
      <QueryView query={submissions} loadingLabel="Loading your submissions…">
        {data => {
          const pending = data.find(item => item.status === 'PENDING_REVIEW');
          const active = data.find(item => item.status === 'ACTIVE');
          const history = data.filter(item => item !== pending && item !== active);
          return (
            <>
              {active ? (
                <Card>
                  <Row><H2>Active enrollment</H2><Pill label="Active" tone="success" /></Row>
                  <Muted>Approved {dateTime(active.reviewed_at)} · {active.accepted_photo_count} photos</Muted>
                  <Gallery submission={active} />
                </Card>
              ) : null}
              {pending ? (
                <Card>
                  <Row><H2>Pending submission</H2><Pill label="Pending review" tone="warning" /></Row>
                  <Muted>Submitted {dateTime(pending.created_at)}. Not used for recognition until an administrator approves it.</Muted>
                  <Gallery submission={pending} />
                  <ErrorBanner error={cancel.error} title="Could not cancel" />
                  <Button title="Cancel submission" variant="danger" loading={cancel.isPending} onPress={() => confirmCancel(pending.id)} />
                </Card>
              ) : null}
              {history.length ? (
                <Card>
                  <H2>Earlier submissions</H2>
                  {history.map(item => (
                    <View key={item.id} style={{ marginBottom: 10 }}>
                      <Row><Pill label={label[item.status]} tone={tone[item.status]} /><Muted>{dateTime(item.created_at)}</Muted></Row>
                      {item.rejection_reason ? <Body>Reason: {item.rejection_reason}</Body> : null}
                    </View>
                  ))}
                </Card>
              ) : null}
              {!pending ? (
                showForm ? (
                  <FaceEnrollmentForm mode="student" student={{ id: me.studentId ?? me.username, name: me.name ?? me.username, roll: me.roll ?? '' }}
                    onCompleted={() => setShowForm(false)} />
                ) : (
                  <Button title={active ? 'Submit replacement photos' : data.length ? 'Submit new photos' : 'Submit face photos'}
                    onPress={() => setShowForm(true)} />
                )
              ) : <Muted>You can submit new photos after the pending submission is reviewed or cancelled.</Muted>}
              {active && showForm ? <Muted>Your current active enrollment stays in use until replacement photos are approved.</Muted> : null}
            </>
          );
        }}
      </QueryView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  thumb: { width: 96, height: 96, borderRadius: 8 },
});
