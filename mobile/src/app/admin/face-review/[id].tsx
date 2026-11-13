import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { admin } from '../../../api/endpoints';
import { Banner, Button, Card, Checkbox, ErrorBanner, Field, H1, H2, Loading, Muted, Screen, SecureImage } from '../../../ui/components';
import { dateTime } from '../../../ui/format';

/** Identity review of a student's pending face photos. Approval activates the embedding. */
export default function FaceReview() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const enrollmentId = String(id);
  const queryClient = useQueryClient();
  const { width } = useWindowDimensions();
  const queue = useQuery({ queryKey: ['admin', 'face-submissions'], queryFn: admin.faceSubmissions });
  const photos = useQuery({ queryKey: ['admin', 'face-submissions', enrollmentId], queryFn: () => admin.faceSubmissionPhotos(enrollmentId) });
  const [verified, setVerified] = useState(false);
  const [reason, setReason] = useState('');
  const [enlarged, setEnlarged] = useState<string | null>(null);
  const done = () => { void queryClient.invalidateQueries({ queryKey: ['admin'] }); router.back(); };
  const approve = useMutation({ mutationFn: () => admin.approveFaces(enrollmentId), onSuccess: done });
  const reject = useMutation({ mutationFn: () => admin.rejectFaces(enrollmentId, reason.trim()), onSuccess: done });
  const item = queue.data?.find(row => row.enrollment_id === enrollmentId);
  const busy = approve.isPending || reject.isPending;

  if (queue.isPending) return <Screen><Loading /></Screen>;
  if (!item) return <Screen><Banner tone="info">This submission is no longer pending.</Banner><Button title="Back" onPress={() => router.back()} /></Screen>;

  return (
    <Screen>
      <H1>{item.name}</H1>
      <Muted>Roll {item.roll} · {item.email ?? 'No email'} · submitted {dateTime(item.created_at)}</Muted>
      <Card style={{ marginTop: 12 }}>
        <H2>{item.accepted_photo_count} submitted photos</H2>
        <Muted>Tap a photo to enlarge it. Each was checked for exactly one detectable face.</Muted>
        {photos.isPending ? <Loading /> : <ErrorBanner error={photos.error} onRetry={() => void photos.refetch()} />}
        <View style={styles.grid}>
          {(photos.data ?? []).map(photo => (
            <Pressable key={photo.id} accessibilityRole="imagebutton" accessibilityLabel={`Enlarge photo ${photo.photo_index + 1}`} onPress={() => setEnlarged(photo.id)}>
              <SecureImage path={admin.faceSubmissionPhotoPath(enrollmentId, photo.id)} style={styles.thumb} accessibilityLabel={`Submitted photo ${photo.photo_index + 1}`} />
            </Pressable>
          ))}
        </View>
      </Card>
      <ErrorBanner error={approve.error ?? reject.error} title="Decision not saved" />
      <Card>
        <H2>Approve</H2>
        <Checkbox checked={verified} onChange={setVerified} label={`These photos show ${item.name} (${item.roll}) and only them.`} />
        <Button title="Approve and activate" disabled={!verified || busy} loading={approve.isPending} onPress={() => approve.mutate()} />
        <Muted>Any previous active enrollment is replaced only if activation succeeds.</Muted>
      </Card>
      <Card>
        <H2>Reject</H2>
        <Field label="Reason (shown to the student)" value={reason} onChangeText={setReason} multiline hint="5–1000 characters." />
        <Button title="Reject submission" variant="danger" disabled={busy || reason.trim().length < 5} loading={reject.isPending} onPress={() => reject.mutate()} />
      </Card>
      <Modal visible={Boolean(enlarged)} animationType="fade" onRequestClose={() => setEnlarged(null)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#000', justifyContent: 'center' }}>
          {enlarged ? <SecureImage path={admin.faceSubmissionPhotoPath(enrollmentId, enlarged, false)} style={{ width, height: width * 1.3, resizeMode: 'contain' }}
            accessibilityLabel="Enlarged submitted photo" /> : null}
          <Button title="Close" onPress={() => setEnlarged(null)} />
        </SafeAreaView>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  thumb: { width: 100, height: 100, borderRadius: 8 },
});
