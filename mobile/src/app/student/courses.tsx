import { useQuery } from '@tanstack/react-query';
import React from 'react';

import { student } from '../../api/endpoints';
import { Body, Card, Empty, KeyValue, Muted, QueryView, Screen } from '../../ui/components';
import { percent } from '../../ui/format';

export default function StudentCourses() {
  const courses = useQuery({ queryKey: ['student', 'courses'], queryFn: student.courses });
  const dashboard = useQuery({ queryKey: ['student', 'dashboard'], queryFn: () => student.dashboard() });
  const totals = new Map((dashboard.data?.attendanceByOffering ?? []).map(row => [row.offering_id, row]));
  return (
    <Screen refreshing={courses.isRefetching} onRefresh={() => { void courses.refetch(); void dashboard.refetch(); }}>
      <QueryView query={courses} loadingLabel="Loading courses…">
        {data => data.length === 0 ? <Empty title="No courses yet">An administrator enrolls you in course offerings.</Empty> : (
          <>
            {data.map(course => {
              const stats = totals.get(course.offering_id);
              return (
                <Card key={course.offering_id}>
                  <Body style={{ fontWeight: '700' }}>{course.course_code} — {course.course_title}</Body>
                  <Muted>{course.offering_label}</Muted>
                  <KeyValue label="Term" value={`${course.academic_term}${course.academic_year ? ` ${course.academic_year}` : ''}`} />
                  <KeyValue label="Section" value={course.section} />
                  <KeyValue label="Teachers" value={course.teachers || 'Not assigned'} />
                  <KeyValue label="Finalized classes" value={stats?.finalized_sessions ?? 0} />
                  <KeyValue label="Attendance" value={stats ? `${percent(stats.attendance_percentage)} (${stats.present_count} present, ${stats.absent_count} absent)` : 'No finalized classes yet'} />
                </Card>
              );
            })}
          </>
        )}
      </QueryView>
    </Screen>
  );
}
