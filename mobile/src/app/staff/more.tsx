import { router } from 'expo-router';
import React from 'react';

import { useAuth, useMe } from '../../auth/AuthProvider';
import { Button, Card, H2, ListItem, Muted, Screen } from '../../ui/components';

export default function More() {
  const me = useMe();
  const { signOut } = useAuth();
  const isAdmin = me.role === 'ADMIN';
  return (
    <Screen>
      <Card>
        <H2>Attendance</H2>
        <ListItem title="Reports" subtitle="Course, session, student, and detailed attendance; CSV and PDF" onPress={() => router.push('/reports')} />
        <ListItem title="Recognition settings" subtitle="Your personal matching threshold" onPress={() => router.push('/recognition-settings')} />
      </Card>
      {isAdmin ? (
        <Card>
          <H2>Administration</H2>
          <ListItem title="Courses & offerings" subtitle="Catalog, offerings, rosters, teacher assignments" onPress={() => router.push('/admin/courses')} />
          <ListItem title="Teachers" subtitle="Teacher accounts" onPress={() => router.push('/admin/teachers')} />
        </Card>
      ) : null}
      <Card>
        <H2>Account</H2>
        <Muted>Signed in as {me.username} ({isAdmin ? 'Administrator' : 'Teacher'})</Muted>
        <Button title="Sign out" variant="secondary" onPress={() => void signOut()} />
      </Card>
    </Screen>
  );
}
