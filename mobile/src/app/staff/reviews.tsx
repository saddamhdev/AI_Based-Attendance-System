import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import React, { useState } from 'react';

import { admin } from '../../api/endpoints';
import type { RegistrationStatus } from '../../api/types';
import { Card, Empty, H2, ListItem, Muted, Pill, QueryView, Screen, Select } from '../../ui/components';
import { dateTime } from '../../ui/format';

/** Registration approval and face-photo approval are separate queues. */
export default function AdminReviews() {
  const [status, setStatus] = useState<RegistrationStatus>('PENDING_APPROVAL');
  const registrations = useQuery({ queryKey: ['admin', 'registrations', status], queryFn: () => admin.registrations(status) });
  const faces = useQuery({ queryKey: ['admin', 'face-submissions'], queryFn: admin.faceSubmissions });
  return (
    <Screen refreshing={registrations.isRefetching || faces.isRefetching} onRefresh={() => { void registrations.refetch(); void faces.refetch(); }}>
      <Card>
        <H2>Student registration requests</H2>
        <Select label="Status" value={status} onChange={value => setStatus(value as RegistrationStatus)} options={[
          { value: 'PENDING_APPROVAL', label: 'Pending approval' }, { value: 'APPROVED', label: 'Approved' }, { value: 'REJECTED', label: 'Rejected' },
        ]} />
        <QueryView query={registrations}>
          {data => data.length === 0 ? <Empty title="No requests" /> : (
            <>
              {data.map(request => (
                <ListItem key={request.id} title={`${request.full_name} (${request.roll})`}
                  subtitle={`${request.username} · ${request.email} · ${dateTime(request.submitted_at)}`}
                  right={request.candidate_student_id ? <Pill label="Roll matches a profile" tone="warning" /> : undefined}
                  onPress={() => router.push(`/admin/registration/${request.id}?status=${status}`)} />
              ))}
            </>
          )}
        </QueryView>
      </Card>
      <Card>
        <H2>Face photo submissions</H2>
        <Muted>Pending photos are not used for recognition until approved.</Muted>
        <QueryView query={faces}>
          {data => data.length === 0 ? <Empty title="No submissions waiting" /> : (
            <>
              {data.map(item => (
                <ListItem key={item.enrollment_id} title={`${item.name} (${item.roll})`}
                  subtitle={`${item.accepted_photo_count} photos · ${dateTime(item.created_at)}`}
                  onPress={() => router.push(`/admin/face-review/${item.enrollment_id}`)} />
              ))}
            </>
          )}
        </QueryView>
      </Card>
    </Screen>
  );
}
