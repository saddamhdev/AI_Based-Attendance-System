import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';

import { ApiError } from '../../api/client';
import { admin, staff } from '../../api/endpoints';
import { useMe } from '../../auth/AuthProvider';
import { Banner, Button, Card, Checkbox, ErrorBanner, Muted, QueryView, Row, Screen, Select } from '../../ui/components';
import { DateField } from '../../ui/DateField';
import { isoDate } from '../../ui/format';

export default function NewSession() {
  const me = useMe();
  const isAdmin = me.role === 'ADMIN';
  const params = useLocalSearchParams<{ offeringId?: string }>();
  const queryClient = useQueryClient();
  const offerings = useQuery({ queryKey: ['staff', 'offerings'], queryFn: () => staff.offerings() });
  const teachers = useQuery({ queryKey: ['admin', 'teachers'], queryFn: admin.teachers, enabled: isAdmin });
  const [offeringId, setOfferingId] = useState(params.offeringId ?? '');
  const [date, setDate] = useState(isoDate(new Date()));
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [teacherId, setTeacherId] = useState('');
  const [substitute, setSubstitute] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [problem, setProblem] = useState('');

  async function create() {
    setProblem('');
    if (!offeringId) return setProblem('Choose an offering.');
    if (!date || !startTime || !endTime) return setProblem('Class date, start time, and end time are required.');
    if (endTime <= startTime) return setProblem('The end time must be later than the start time.');
    setBusy(true);
    setError(null);
    try {
      const result = await staff.createSession({
        offeringId, date, startTime, endTime,
        teacherId: isAdmin && teacherId ? teacherId : undefined,
        authorizeSubstitute: isAdmin ? substitute : undefined,
      });
      await queryClient.invalidateQueries({ queryKey: ['staff'] });
      router.replace({ pathname: '/session/[id]', params: { id: result.id, overlap: result.overlapWarning ? '1' : '' } });
    } catch (failure) {
      setError(failure);
      if (failure instanceof ApiError && failure.uncertain) void queryClient.invalidateQueries({ queryKey: ['staff', 'sessions'] });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <QueryView query={offerings}>
        {data => {
          const allowed = data.filter(offering => offering.can_create_session);
          return (
            <Card>
              {allowed.length === 0 ? <Banner tone="warning">You have no active offering assignment that allows creating sessions.</Banner> : null}
              <Select label="Offering" value={offeringId} onChange={setOfferingId}
                options={allowed.map(o => ({ value: o.id, label: o.offering_label, detail: `${o.enrolled_count} enrolled · ${o.primary_teacher ?? 'No primary teacher'}` }))} />
              <DateField label="Class date" value={date} onChange={setDate} />
              <Row>
                <DateField label="Start time" value={startTime} onChange={setStartTime} mode="time" />
                <DateField label="End time" value={endTime} onChange={setEndTime} mode="time" />
              </Row>
              {isAdmin ? (
                <>
                  <Select label="Teacher (optional — defaults to the primary teacher)" value={teacherId} onChange={setTeacherId}
                    options={[{ value: '', label: 'Primary teacher' }, ...(teachers.data ?? []).filter(t => t.active).map(t => ({ value: t.id, label: t.display_name, detail: t.username }))]} />
                  <Checkbox checked={substitute} onChange={setSubstitute}
                    label="Authorize the selected teacher as a substitute for this session only (required when they are not assigned)." />
                </>
              ) : <Muted>The session is recorded under your account. The roster is the offering’s active enrollment.</Muted>}
              {problem ? <Banner tone="error">{problem}</Banner> : null}
              <ErrorBanner error={error} title="Session not created" />
              {error instanceof ApiError && error.uncertain ? (
                <Muted>Check the Sessions list before retrying — an identical session is rejected by the server, so a retry cannot create a duplicate.</Muted>
              ) : null}
              <Button title="Create session" onPress={() => void create()} loading={busy} disabled={!allowed.length} />
            </Card>
          );
        }}
      </QueryView>
    </Screen>
  );
}
