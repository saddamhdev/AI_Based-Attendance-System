import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import React from 'react';
import { View } from 'react-native';

import { student } from '../../api/endpoints';
import { biometricStatus } from '../../features/biometric';
import { Body, Button, Card, Empty, H1, H2, KeyValue, ListItem, Muted, Pill, QueryView, Row, Screen, Stat } from '../../ui/components';
import { classTime, percent } from '../../ui/format';

export default function StudentDashboard() {
  const dashboard = useQuery({ queryKey: ['student', 'dashboard'], queryFn: () => student.dashboard() });
  const faces = useQuery({ queryKey: ['student', 'faces'], queryFn: student.faceSubmissions });

  return (
    <Screen refreshing={dashboard.isRefetching} onRefresh={() => { void dashboard.refetch(); void faces.refetch(); }}>
      <QueryView query={dashboard} loadingLabel="Loading your dashboard…">
        {data => {
          const bio = biometricStatus(data.profile.consent, faces.data);
          return (
            <>
              <H1>{data.profile.name}</H1>
              <Muted>Roll {data.profile.roll}{data.profile.department ? ` · ${data.profile.department}` : ''}{data.profile.batch ? ` · Batch ${data.profile.batch}` : ''}</Muted>
              <Row style={{ marginVertical: 12 }}>
                <Pill label={`Account ${data.profile.account_status.toLowerCase()}`} tone="success" />
                <Pill label={`Face: ${bio.label}`} tone={bio.tone} />
              </Row>

              <Card>
                <H2>Overall attendance</H2>
                {data.noFinalizedClasses ? (
                  <Empty title="No finalized classes yet">Attendance appears here once your teachers confirm class attendance.</Empty>
                ) : (
                  <Row>
                    <Stat label="Attendance" value={percent(data.attendancePercentage)} />
                    <Stat label="Finalized classes" value={data.totals.finalized_sessions} />
                    <Stat label="Present" value={data.totals.present_count} />
                    <Stat label="Absent" value={data.totals.absent_count} />
                  </Row>
                )}
              </Card>

              <Card>
                <H2>By offering</H2>
                {data.attendanceByOffering.length === 0 ? <Muted>No finalized classes yet.</Muted> : data.attendanceByOffering.map(row => (
                  <KeyValue key={row.offering_id} label={row.offering_label}
                    value={`${percent(row.attendance_percentage)} · ${row.present_count}/${row.eligible_records}`} />
                ))}
              </Card>

              <Card>
                <H2>Enrolled courses</H2>
                {data.courses.length === 0 ? <Muted>You are not enrolled in any course offerings yet.</Muted> : data.courses.map(course => (
                  <View key={course.offering_id} style={{ marginBottom: 8 }}>
                    <Body>{course.course_code} — {course.course_title}</Body>
                    <Muted>{course.academic_term}{course.academic_year ? ` ${course.academic_year}` : ''} · Batch {course.batch} · Section {course.section} · {course.teachers || 'Teacher not assigned'}</Muted>
                  </View>
                ))}
              </Card>

              <Card>
                <H2>Recent attendance</H2>
                {data.recentAttendance.length === 0 ? <Muted>No finalized classes yet.</Muted> : data.recentAttendance.map(row => (
                  <ListItem key={row.session_id} title={row.course_code} subtitle={`${classTime(row)} · ${row.teacher_name ?? 'Teacher unknown'}`}
                    right={<Pill label={row.attendance_status} tone={row.attendance_status === 'PRESENT' ? 'success' : 'error'} />} />
                ))}
                <Button title="Full attendance history" variant="secondary" onPress={() => router.push('/student/attendance')} />
              </Card>
            </>
          );
        }}
      </QueryView>
    </Screen>
  );
}
