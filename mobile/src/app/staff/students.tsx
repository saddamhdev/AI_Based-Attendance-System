import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import React, { useState } from 'react';

import { admin } from '../../api/endpoints';
import { enrollmentLabel } from '../../features/biometric';
import { Button, Card, Empty, Field, ListItem, Pill, QueryView, Screen, Select } from '../../ui/components';

export default function AdminStudents() {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('ACTIVE');
  const students = useQuery({ queryKey: ['admin', 'students'], queryFn: admin.students });
  return (
    <Screen refreshing={students.isRefetching} onRefresh={() => void students.refetch()}>
      <Button title="Add student" onPress={() => router.push('/admin/student/new')} />
      <Field label="Search" value={search} onChangeText={setSearch} placeholder="Name, roll, email, or username" autoCapitalize="none" />
      <Select label="Show" value={filter} onChange={setFilter} options={[
        { value: 'ACTIVE', label: 'Active students' }, { value: 'NO_ACCOUNT', label: 'Profile only (no account)' },
        { value: 'PENDING_FACE', label: 'Face pending review' }, { value: 'ARCHIVED', label: 'Archived' }, { value: 'ALL', label: 'All' },
      ]} />
      <Card>
        <QueryView query={students} loadingLabel="Loading students…">
          {data => {
            const term = search.trim().toLowerCase();
            const rows = data.filter(student => {
              if (filter === 'ACTIVE' && student.archived) return false;
              if (filter === 'ARCHIVED' && !student.archived) return false;
              if (filter === 'NO_ACCOUNT' && (student.account_username || student.archived)) return false;
              if (filter === 'PENDING_FACE' && student.enrollment_status !== 'PENDING_REVIEW') return false;
              return !term || [student.name, student.roll, student.email, student.account_username]
                .some(value => String(value ?? '').toLowerCase().includes(term));
            });
            return rows.length === 0 ? <Empty title="No matching students" /> : (
              <>
                {rows.map(student => {
                  const face = enrollmentLabel(student);
                  return (
                    <ListItem key={student.id} title={`${student.name} (${student.roll})`}
                      subtitle={student.archived ? 'Archived' : student.account_username
                        ? `Account ${student.account_username} · ${student.account_active ? 'active' : 'inactive'}` : 'Profile only — no account'}
                      right={<Pill label={face.label} tone={face.tone} />}
                      onPress={() => router.push(`/admin/student/${student.id}`)} />
                  );
                })}
              </>
            );
          }}
        </QueryView>
      </Card>
    </Screen>
  );
}
