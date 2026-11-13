import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { Alert } from 'react-native';

import { admin, staff } from '../../../api/endpoints';
import { Banner, Button, Card, Empty, ErrorBanner, H1, H2, ListItem, Loading, Muted, Pill, QueryView, Row, Screen, Select } from '../../../ui/components';
import { DateField } from '../../../ui/DateField';
import { isoDate } from '../../../ui/format';

export default function OfferingDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const offeringId = String(id);
  const queryClient = useQueryClient();
  const offerings = useQuery({ queryKey: ['staff', 'offerings', true], queryFn: () => staff.offerings(true) });
  const roster = useQuery({ queryKey: ['staff', 'offerings', offeringId, 'roster'], queryFn: () => staff.offeringRoster(offeringId) });
  const assignments = useQuery({ queryKey: ['admin', 'assignments', offeringId], queryFn: () => admin.assignments({ offeringId }) });
  const teachers = useQuery({ queryKey: ['admin', 'teachers'], queryFn: admin.teachers });
  const students = useQuery({ queryKey: ['admin', 'students'], queryFn: admin.students });
  const [assign, setAssign] = useState({ teacherId: '', role: 'PRIMARY' as 'PRIMARY' | 'CO_TEACHER', from: isoDate(new Date()), to: '' });
  const [studentId, setStudentId] = useState('');
  const mutation = useMutation({
    mutationFn: (task: () => Promise<unknown>) => task(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['staff', 'offerings'] });
      void queryClient.invalidateQueries({ queryKey: ['admin'] });
    },
  });

  if (offerings.isPending) return <Screen><Loading /></Screen>;
  const offering = offerings.data?.find(row => row.id === offeringId);
  if (!offering) return <Screen><ErrorBanner error={offerings.error ?? new Error('Offering not found')} /></Screen>;
  const enrolledIds = new Set((roster.data ?? []).map(s => s.id));

  return (
    <Screen>
      <H1>{offering.course_code}</H1>
      <Muted>{offering.offering_label}</Muted>
      <Row style={{ marginVertical: 8 }}>
        {offering.archived ? <Pill label="Archived" tone="neutral" /> : <Pill label="Active" tone="success" />}
        <Pill label={`${offering.enrolled_count} enrolled`} />
      </Row>
      <ErrorBanner error={mutation.error} title="Change not saved" />
      {!offering.archived ? <Button title="Create a session" onPress={() => router.push({ pathname: '/session/new', params: { offeringId } })} /> : null}

      <Card>
        <H2>Teacher assignments</H2>
        <QueryView query={assignments}>
          {data => data.length === 0 ? <Muted>No teachers assigned.</Muted> : (
            <>
              {data.map(a => (
                <ListItem key={a.id} title={`${a.display_name} · ${a.assignment_role === 'PRIMARY' ? 'Primary' : 'Co-teacher'}`}
                  subtitle={`${a.status} · ${a.effective_from ?? '—'} → ${a.effective_to ?? 'open'}`}
                  right={!a.legacy && a.status !== 'ENDED' ? <Button title="End" variant="ghost" onPress={() => Alert.alert('End assignment today?', a.display_name, [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'End', onPress: () => mutation.mutate(() => admin.endAssignment(a.id, isoDate(new Date()))) },
                  ])} /> : undefined} />
              ))}
            </>
          )}
        </QueryView>
        {!offering.archived ? (
          <>
            <Select label="Teacher" value={assign.teacherId} onChange={teacherId => setAssign({ ...assign, teacherId })}
              options={(teachers.data ?? []).filter(t => t.active).map(t => ({ value: t.id, label: t.display_name, detail: t.username }))} />
            <Select label="Role" value={assign.role} onChange={role => setAssign({ ...assign, role: role as typeof assign.role })}
              options={[{ value: 'PRIMARY', label: 'Primary teacher' }, { value: 'CO_TEACHER', label: 'Co-teacher' }]} />
            <Row>
              <DateField label="Effective from" value={assign.from} onChange={from => setAssign({ ...assign, from })} />
              <DateField label="Effective to (optional)" value={assign.to} onChange={to => setAssign({ ...assign, to })} clearable />
            </Row>
            <Button title="Assign teacher" disabled={!assign.teacherId || !assign.from} loading={mutation.isPending}
              onPress={() => mutation.mutate(() => admin.assignTeacher({ offeringId, teacherId: assign.teacherId, role: assign.role, effectiveFrom: assign.from, effectiveTo: assign.to || null }))} />
          </>
        ) : null}
      </Card>

      <Card>
        <H2>Enrolled students</H2>
        {!offering.archived ? (
          <>
            <Select label="Add student" value={studentId} onChange={setStudentId}
              options={(students.data ?? []).filter(s => !s.archived && !enrolledIds.has(s.id)).map(s => ({ value: s.id, label: `${s.roll} — ${s.name}` }))} />
            <Button title="Enroll" variant="secondary" disabled={!studentId} loading={mutation.isPending}
              onPress={() => mutation.mutate(async () => { await admin.enrollStudent(offeringId, studentId); setStudentId(''); })} />
            <Banner tone="info">Existing sessions keep their recorded roster; new sessions use the current enrollment.</Banner>
          </>
        ) : null}
        <QueryView query={roster}>
          {data => data.length === 0 ? <Empty title="No students enrolled" /> : (
            <>
              {data.map(s => (
                <ListItem key={s.id} title={s.name} subtitle={s.roll}
                  right={!offering.archived ? <Button title="Withdraw" variant="ghost" onPress={() => Alert.alert('Withdraw student?', `${s.name} (${s.roll})`, [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Withdraw', style: 'destructive', onPress: () => mutation.mutate(() => admin.withdrawStudent(offeringId, s.id)) },
                  ])} /> : undefined} />
              ))}
            </>
          )}
        </QueryView>
      </Card>

      <Button title={offering.archived ? 'Reactivate offering' : 'Archive offering'} variant={offering.archived ? 'secondary' : 'danger'} loading={mutation.isPending}
        onPress={() => mutation.mutate(() => (offering.archived ? admin.activateOffering(offeringId) : admin.archiveOffering(offeringId)))} />
    </Screen>
  );
}
