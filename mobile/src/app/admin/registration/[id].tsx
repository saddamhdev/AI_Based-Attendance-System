import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';

import { admin } from '../../../api/endpoints';
import type { RegistrationStatus } from '../../../api/types';
import { Banner, Button, Card, Checkbox, ErrorBanner, Field, H1, H2, KeyValue, Loading, Muted, Pill, Screen } from '../../../ui/components';
import { dateTime } from '../../../ui/format';

export default function RegistrationReview() {
  const { id, status } = useLocalSearchParams<{ id: string; status?: RegistrationStatus }>();
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: ['admin', 'registrations', status ?? 'PENDING_APPROVAL'], queryFn: () => admin.registrations(status ?? 'PENDING_APPROVAL') });
  const [reason, setReason] = useState('');
  const [linkConfirmed, setLinkConfirmed] = useState(false);
  const done = () => { void queryClient.invalidateQueries({ queryKey: ['admin'] }); router.back(); };
  const approve = useMutation({ mutationFn: (existing: string | null) => admin.approveRegistration(String(id), existing), onSuccess: done });
  const reject = useMutation({ mutationFn: () => admin.rejectRegistration(String(id), reason.trim()), onSuccess: done });

  if (list.isPending) return <Screen><Loading /></Screen>;
  const request = list.data?.find(row => row.id === id);
  if (!request) return <Screen><ErrorBanner error={list.error ?? new Error('Request not found')} onRetry={() => void list.refetch()} /></Screen>;
  const pending = request.status === 'PENDING_APPROVAL';
  const busy = approve.isPending || reject.isPending;

  return (
    <Screen>
      <H1>{request.full_name}</H1>
      <Pill label={request.status.replace('_', ' ')} tone={pending ? 'warning' : request.status === 'APPROVED' ? 'success' : 'error'} />
      <Card style={{ marginTop: 12 }}>
        <KeyValue label="Roll" value={request.roll} />
        <KeyValue label="Email" value={request.email} />
        <KeyValue label="Username" value={request.username} />
        <KeyValue label="Department" value={request.department} />
        <KeyValue label="Batch" value={request.batch} />
        <KeyValue label="Submitted" value={dateTime(request.submitted_at)} />
        {request.rejection_reason ? <KeyValue label="Rejection reason" value={request.rejection_reason} /> : null}
      </Card>
      {request.candidate_student_id ? (
        <Card>
          <H2>Existing profile with this roll</H2>
          <KeyValue label="Profile" value={`${request.candidate_name} (${request.candidate_roll})`} />
          <KeyValue label="Already has account" value={request.candidate_has_account ? 'Yes' : 'No'} />
          <Banner tone="warning">
            A matching roll number is not proof of identity. Approve only after verifying that the applicant is this student; the profile is then linked explicitly.
          </Banner>
          {pending && !request.candidate_has_account ? (
            <Checkbox checked={linkConfirmed} onChange={setLinkConfirmed} label={`I verified the applicant is ${request.candidate_name} (${request.candidate_roll}).`} />
          ) : null}
        </Card>
      ) : null}
      <ErrorBanner error={approve.error ?? reject.error} title="Decision not saved" />
      {pending ? (
        <>
          <Button title={request.candidate_student_id ? 'Approve and link profile' : 'Approve (creates profile and account)'} loading={approve.isPending}
            disabled={busy || (Boolean(request.candidate_student_id) && (!linkConfirmed || request.candidate_has_account))}
            onPress={() => approve.mutate(request.candidate_student_id)} />
          <Card>
            <H2>Reject</H2>
            <Field label="Reason (shown to the applicant)" value={reason} onChangeText={setReason} multiline
              hint="5–1000 characters." style={{ minHeight: 80, textAlignVertical: 'top' }} />
            <Button title="Reject request" variant="danger" loading={reject.isPending}
              disabled={busy || reason.trim().length < 5 || reason.trim().length > 1000} onPress={() => reject.mutate()} />
          </Card>
        </>
      ) : <Muted>This request has already been decided.</Muted>}
    </Screen>
  );
}
