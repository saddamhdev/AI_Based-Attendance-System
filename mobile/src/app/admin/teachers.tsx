import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useState } from 'react';

import { admin } from '../../api/endpoints';
import { Banner, Button, Card, Empty, ErrorBanner, Field, H2, ListItem, Pill, QueryView, Screen } from '../../ui/components';

export default function Teachers() {
  const queryClient = useQueryClient();
  const teachers = useQuery({ queryKey: ['admin', 'teachers'], queryFn: admin.teachers });
  const [form, setForm] = useState({ username: '', displayName: '', password: '' });
  const create = useMutation({
    mutationFn: () => admin.createTeacher(form.username.trim(), form.displayName.trim(), form.password),
    onSuccess: () => {
      setForm({ username: '', displayName: '', password: '' });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'teachers'] });
    },
  });
  const valid = /^[A-Za-z0-9._-]{3,64}$/.test(form.username.trim()) && form.displayName.trim() && form.password.length >= 12;
  return (
    <Screen refreshing={teachers.isRefetching} onRefresh={() => void teachers.refetch()}>
      <Card>
        <H2>Add teacher</H2>
        <Field label="Username" value={form.username} onChangeText={username => setForm({ ...form, username })} autoCapitalize="none" autoCorrect={false} />
        <Field label="Display name" value={form.displayName} onChangeText={displayName => setForm({ ...form, displayName })} />
        <Field label="Password" value={form.password} onChangeText={password => setForm({ ...form, password })} secureTextEntry hint="12–128 characters." />
        <ErrorBanner error={create.error} title="Teacher not created" />
        {create.isSuccess ? <Banner tone="success">Teacher created. Assign them to offerings under Courses & offerings.</Banner> : null}
        <Button title="Create teacher" disabled={!valid} loading={create.isPending} onPress={() => create.mutate()} />
      </Card>
      <Card>
        <H2>Teachers</H2>
        <QueryView query={teachers}>
          {data => data.length === 0 ? <Empty title="No teachers" /> : (
            <>{data.map(t => <ListItem key={t.id} title={t.display_name} subtitle={t.username}
              right={<Pill label={t.active ? 'Active' : 'Inactive'} tone={t.active ? 'success' : 'neutral'} />} />)}</>
          )}
        </QueryView>
      </Card>
    </Screen>
  );
}
