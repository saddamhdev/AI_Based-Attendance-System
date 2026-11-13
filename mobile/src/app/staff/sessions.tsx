import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import React, { useState } from 'react';

import { staff } from '../../api/endpoints';
import { Button, Card, Empty, ListItem, Pill, QueryView, Screen, Select } from '../../ui/components';
import { classTime } from '../../ui/format';

/** Sessions the backend authorizes for this account (own, assigned, substitute, or all for admins). */
export default function StaffSessions() {
  const [filter, setFilter] = useState<'ALL' | 'DRAFT' | 'FINALIZED'>('ALL');
  const sessions = useQuery({ queryKey: ['staff', 'sessions'], queryFn: staff.sessions });
  return (
    <Screen refreshing={sessions.isRefetching} onRefresh={() => void sessions.refetch()}>
      <Button title="Create a session" onPress={() => router.push('/session/new')} />
      <Select label="Show" value={filter} onChange={value => setFilter(value as typeof filter)} options={[
        { value: 'ALL', label: 'All sessions' }, { value: 'DRAFT', label: 'Drafts awaiting review' }, { value: 'FINALIZED', label: 'Finalized' },
      ]} />
      <Card>
        <QueryView query={sessions} loadingLabel="Loading sessions…">
          {data => {
            const rows = data.filter(s => filter === 'ALL' || (filter === 'FINALIZED') === (s.status === 'FINALIZED'));
            return rows.length === 0 ? <Empty title="No sessions">Create a session from an assigned offering.</Empty> : (
              <>
                {rows.map(session => (
                  <ListItem key={session.id} title={session.offering_label}
                    subtitle={`${classTime(session)} · ${session.teacher_name ?? 'Teacher unknown'}`}
                    right={<Pill label={session.status} tone={session.status === 'FINALIZED' ? 'success' : 'warning'} />}
                    onPress={() => router.push(`/session/${session.id}`)} />
                ))}
              </>
            );
          }}
        </QueryView>
      </Card>
    </Screen>
  );
}
