import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { admin, staff } from '../../../api/endpoints';
import type { AdminStudent } from '../../../api/types';
import { enrollmentLabel } from '../../../features/biometric';
import { FaceEnrollmentForm } from '../../../features/FaceEnrollmentForm';
import { Banner, Button, Card, Checkbox, Empty, ErrorBanner, Field, H1, H2, KeyValue, Loading, Muted, Pill, Row, Screen, SecureImage, Select } from '../../../ui/components';

function ActiveGallery({ student }: { student: AdminStudent }) {
  const photos = useQuery({
    queryKey: ['admin', 'students', student.id, 'photos', student.enrollment_id],
    queryFn: () => admin.activePhotos(student.id, student.enrollment_id!),
    enabled: Boolean(student.enrollment_id),
  });
  if (!student.enrollment_id) return null;
  if (photos.isPending) return <Loading label="Loading enrollment photos…" />;
  if (photos.error) return <ErrorBanner error={photos.error} onRetry={() => void photos.refetch()} />;
  return (
    <View style={styles.grid}>
      {(photos.data ?? []).map(photo => (
        <SecureImage key={photo.id} path={admin.activePhotoPath(student.id, student.enrollment_id!, photo.id)} style={styles.thumb}
          accessibilityLabel={`Enrollment photo ${photo.photo_index + 1} of ${student.name}`} />
      ))}
    </View>
  );
}

export default function AdminStudentDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const students = useQuery({ queryKey: ['admin', 'students'], queryFn: admin.students });
  const offerings = useQuery({ queryKey: ['staff', 'offerings'], queryFn: () => staff.offerings() });
  const [enrolling, setEnrolling] = useState(false);
  const [profile, setProfile] = useState<{ name: string; email: string; department: string; batch: string } | null>(null);
  const [account, setAccount] = useState({ username: '', email: '', temporaryPassword: '' });
  const [resetPassword, setResetPassword] = useState('');
  const [offeringId, setOfferingId] = useState('');
  const [consentVerified, setConsentVerified] = useState(false);
  const [notice, setNotice] = useState('');
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin'] });

  const mutation = useMutation({
    mutationFn: async (task: () => Promise<unknown>) => task(),
    onSuccess: () => { void refresh(); void queryClient.invalidateQueries({ queryKey: ['staff', 'offerings'] }); },
  });
  const run = (task: () => Promise<unknown>, message: string) => {
    setNotice('');
    mutation.mutate(task, { onSuccess: () => setNotice(message) });
  };

  if (students.isPending) return <Screen><Loading /></Screen>;
  const student = students.data?.find(row => row.id === id);
  if (!student) return <Screen><ErrorBanner error={students.error ?? new Error('Student not found')} onRetry={() => void students.refetch()} /></Screen>;
  const face = enrollmentLabel(student);

  const confirm = (title: string, message: string, label: string, action: () => void) =>
    Alert.alert(title, message, [{ text: 'Cancel', style: 'cancel' }, { text: label, style: 'destructive', onPress: action }]);

  return (
    <Screen refreshing={students.isRefetching} onRefresh={() => {
      void students.refetch();
      void queryClient.invalidateQueries({ queryKey: ['private-image'] });
    }}>
      <H1>{student.name}</H1>
      <Row><Pill label={`Roll ${student.roll}`} /><Pill label={face.label} tone={face.tone} />{student.archived ? <Pill label="Archived" tone="neutral" /> : null}</Row>
      {notice ? <Banner tone="success">{notice}</Banner> : null}
      <ErrorBanner error={mutation.error} title="Action failed" />

      <Card>
        <H2>Profile</H2>
        {profile ? (
          <>
            <Field label="Name" value={profile.name} onChangeText={name => setProfile({ ...profile, name })} />
            <Field label="Email" value={profile.email} onChangeText={email => setProfile({ ...profile, email })} autoCapitalize="none" />
            <Field label="Department" value={profile.department} onChangeText={department => setProfile({ ...profile, department })} />
            <Field label="Batch" value={profile.batch} onChangeText={batch => setProfile({ ...profile, batch })} />
            <Button title="Save profile" loading={mutation.isPending} onPress={() => run(async () => {
              await admin.updateProfile(student.id, { name: profile.name, email: profile.email || undefined, department: profile.department || undefined, batch: profile.batch || undefined });
              setProfile(null);
            }, 'Profile saved.')} />
            <Button title="Cancel" variant="secondary" onPress={() => setProfile(null)} />
          </>
        ) : (
          <>
            <KeyValue label="Email" value={student.email} />
            <KeyValue label="Department" value={student.department} />
            <KeyValue label="Batch" value={student.batch} />
            <KeyValue label="Biometric consent" value={student.consent ? 'Recorded' : 'Not recorded'} />
            <KeyValue label="Attendance records" value={student.attendance_count} />
            {!student.archived ? <Button title="Edit profile" variant="secondary" onPress={() => setProfile({
              name: student.name, email: student.email ?? '', department: student.department ?? '', batch: student.batch ?? '' })} /> : null}
          </>
        )}
      </Card>

      <Card>
        <H2>Account</H2>
        {student.account_username ? (
          <>
            <KeyValue label="Username" value={student.account_username} />
            <KeyValue label="Status" value={student.account_active ? 'Active' : 'Deactivated'} />
            <KeyValue label="Source" value={student.registration_source} />
            <KeyValue label="Must change password" value={student.must_change_password ? 'Yes' : 'No'} />
            <Button title={student.account_active ? 'Deactivate account' : 'Reactivate account'} variant="secondary" loading={mutation.isPending}
              onPress={() => run(() => admin.setAccountActive(student.id, !student.account_active), student.account_active ? 'Account deactivated and signed out.' : 'Account reactivated.')} />
            {student.account_active ? (
              <>
                <Field label="New temporary password" value={resetPassword} onChangeText={setResetPassword} secureTextEntry hint="12–128 characters; the student must change it." />
                <Button title="Reset password" variant="secondary" disabled={resetPassword.length < 12} loading={mutation.isPending}
                  onPress={() => run(async () => { await admin.resetPassword(student.id, resetPassword); setResetPassword(''); }, 'Password reset. The student was signed out on all devices.')} />
              </>
            ) : null}
          </>
        ) : student.archived ? <Muted>Archived students cannot get accounts.</Muted> : (
          <>
            <Muted>Profile only. Create an account (approved immediately) for the student to sign in.</Muted>
            <Field label="Username" value={account.username} onChangeText={username => setAccount({ ...account, username })} autoCapitalize="none" autoCorrect={false} />
            <Field label="Email" value={account.email || student.email || ''} onChangeText={email => setAccount({ ...account, email })} autoCapitalize="none" keyboardType="email-address" />
            <Field label="Temporary password" value={account.temporaryPassword} onChangeText={temporaryPassword => setAccount({ ...account, temporaryPassword })} secureTextEntry />
            <Button title="Create account" loading={mutation.isPending} disabled={!account.username || account.temporaryPassword.length < 12}
              onPress={() => run(async () => {
                await admin.addAccount(student.id, { username: account.username.trim(), email: (account.email || student.email || '').trim(), temporaryPassword: account.temporaryPassword });
                setAccount({ username: '', email: '', temporaryPassword: '' });
              }, 'Account created.')} />
          </>
        )}
      </Card>

      {!student.archived ? (
        <Card>
          <H2>Course enrollment</H2>
          <Select label="Offering" value={offeringId} onChange={setOfferingId}
            options={(offerings.data ?? []).map(o => ({ value: o.id, label: o.offering_label, detail: `${o.enrolled_count} enrolled` }))} />
          <Button title="Enroll in offering" variant="secondary" disabled={!offeringId} loading={mutation.isPending}
            onPress={() => run(() => admin.enrollStudent(offeringId, student.id), 'Student enrolled. New sessions include them in the roster.')} />
          <Muted>Withdraw a student from an offering on the offering’s page.</Muted>
        </Card>
      ) : null}

      {!student.archived ? (
        <Card>
          <H2>Face enrollment</H2>
          {student.enrollment_status === 'PENDING_REVIEW' && student.pending_enrollment_id ? (
            <Banner tone="warning" title="Submission waiting for review"
              action={{ label: 'Review it', onPress: () => router.push(`/admin/face-review/${student.pending_enrollment_id}`) }}>
              Review or reject the pending submission before enrolling new photos.
            </Banner>
          ) : null}
          {student.enrollment_id ? (
            <>
              <Muted>{student.accepted_photo_count} active photos. Visible only to administrators and the student.</Muted>
              <ActiveGallery student={student} />
            </>
          ) : <Muted>Not enrolled. Face enrollment is optional; manual attendance always works.</Muted>}
          {!student.consent ? (
            <>
              <Banner tone="warning">No biometric consent is recorded for this student. Record it before enrolling photos.</Banner>
              <Checkbox checked={consentVerified} onChange={setConsentVerified}
                label="I verified the student's identity and obtained their explicit biometric consent." />
              <Button title="Record consent" variant="secondary" disabled={!consentVerified} loading={mutation.isPending}
                onPress={() => run(() => admin.recordConsent(student.id), 'Consent recorded.')} />
            </>
          ) : enrolling ? (
            <FaceEnrollmentForm mode="admin" student={student} onCompleted={() => { setEnrolling(false); void refresh(); }} />
          ) : student.enrollment_status !== 'PENDING_REVIEW' ? (
            <Button title={student.enrollment_id ? 'Replace enrollment photos' : 'Enroll face photos'} onPress={() => setEnrolling(true)} />
          ) : null}
          {student.enrollment_id && enrolling ? <Muted>The current enrollment stays active if the replacement fails.</Muted> : null}
          {(student.enrollment_id || student.consent) && !enrolling ? (
            <Button title="Delete face data and withdraw consent" variant="danger" loading={mutation.isPending}
              onPress={() => confirm('Delete face data?', 'All face photos and templates are deleted and consent is withdrawn. Attendance history is kept.', 'Delete',
                () => run(() => admin.deleteFaces(student.id), 'Face data deleted.'))} />
          ) : null}
        </Card>
      ) : null}

      {!student.archived ? (
        <Card>
          <H2>Remove student</H2>
          <Muted>{student.attendance_count > 0
            ? 'This student has attendance history, so they will be archived: history is preserved, the account is deactivated, and biometric data is deleted.'
            : 'This student has no attendance history and will be permanently deleted.'}</Muted>
          <Button title={student.attendance_count > 0 ? 'Archive student' : 'Delete student'} variant="danger" loading={mutation.isPending}
            onPress={() => confirm(student.attendance_count > 0 ? 'Archive student?' : 'Delete student?', `${student.name} (${student.roll})`, 'Continue',
              () => mutation.mutate(() => admin.deleteStudent(student.id), { onSuccess: () => router.back() }))} />
        </Card>
      ) : <Empty title="Archived">Historical attendance is preserved.</Empty>}
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 8 },
  thumb: { width: 96, height: 96, borderRadius: 8 },
});
