import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import React, { useState } from 'react';

import { admin, staff } from '../../api/endpoints';
import { Button, Card, Checkbox, Empty, ErrorBanner, Field, H2, ListItem, Pill, QueryView, Screen, Select } from '../../ui/components';

export default function Courses() {
  const queryClient = useQueryClient();
  const catalog = useQuery({ queryKey: ['admin', 'catalog'], queryFn: admin.catalogCourses });
  const [showArchived, setShowArchived] = useState(false);
  const offerings = useQuery({ queryKey: ['staff', 'offerings', showArchived], queryFn: () => staff.offerings(showArchived) });
  const [course, setCourse] = useState({ code: '', title: '' });
  const [offering, setOffering] = useState({ courseId: '', term: '', year: '', batch: '', section: '' });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'catalog'] });
    void queryClient.invalidateQueries({ queryKey: ['staff', 'offerings'] });
  };
  const mutation = useMutation({ mutationFn: (task: () => Promise<unknown>) => task(), onSuccess: refresh });
  const year = offering.year ? Number(offering.year) : null;

  return (
    <Screen refreshing={catalog.isRefetching} onRefresh={() => { void catalog.refetch(); void offerings.refetch(); }}>
      <ErrorBanner error={mutation.error} title="Change not saved" />
      <Card>
        <H2>Catalog courses</H2>
        <QueryView query={catalog}>
          {data => data.length === 0 ? <Empty title="No courses" /> : (
            <>
              {data.map(c => (
                <ListItem key={c.id} title={`${c.course_code} — ${c.title}`} subtitle={`${c.offering_count} offerings`}
                  right={<Button title={c.active ? 'Archive' : 'Activate'} variant="ghost" disabled={mutation.isPending}
                    onPress={() => mutation.mutate(() => (c.active ? admin.archiveCourse(c.id) : admin.activateCourse(c.id)))} />} />
              ))}
            </>
          )}
        </QueryView>
        <Field label="Course code" value={course.code} onChangeText={code => setCourse({ ...course, code })} autoCapitalize="characters" />
        <Field label="Title" value={course.title} onChangeText={title => setCourse({ ...course, title })} />
        <Button title="Add course" disabled={!course.code.trim() || !course.title.trim()} loading={mutation.isPending}
          onPress={() => mutation.mutate(async () => { await admin.createCourse(course.code.trim(), course.title.trim()); setCourse({ code: '', title: '' }); })} />
      </Card>
      <Card>
        <H2>Add offering</H2>
        <Select label="Course" value={offering.courseId} onChange={courseId => setOffering({ ...offering, courseId })}
          options={(catalog.data ?? []).filter(c => c.active).map(c => ({ value: c.id, label: `${c.course_code} — ${c.title}` }))} />
        <Field label="Academic term" value={offering.term} onChangeText={term => setOffering({ ...offering, term })} placeholder="e.g. Spring" />
        <Field label="Academic year (optional)" value={offering.year} onChangeText={value => setOffering({ ...offering, year: value.replace(/\D/g, '') })} keyboardType="number-pad" />
        <Field label="Batch" value={offering.batch} onChangeText={batch => setOffering({ ...offering, batch })} />
        <Field label="Section" value={offering.section} onChangeText={section => setOffering({ ...offering, section })} />
        <Button title="Add offering" loading={mutation.isPending}
          disabled={!offering.courseId || !offering.term.trim() || !offering.batch.trim() || !offering.section.trim()}
          onPress={() => mutation.mutate(async () => {
            await admin.createOffering({ courseId: offering.courseId, academicTerm: offering.term.trim(), academicYear: year, batch: offering.batch.trim(), section: offering.section.trim() });
            setOffering({ courseId: '', term: '', year: '', batch: '', section: '' });
          })} />
      </Card>
      <Card>
        <H2>Offerings</H2>
        <Checkbox checked={showArchived} onChange={setShowArchived} label="Include archived offerings" />
        <QueryView query={offerings}>
          {data => data.length === 0 ? <Empty title="No offerings" /> : (
            <>
              {data.map(o => (
                <ListItem key={o.id} title={o.offering_label} subtitle={`${o.teachers ?? 'No teachers'} · ${o.enrolled_count} enrolled`}
                  right={o.archived ? <Pill label="Archived" tone="neutral" /> : o.legacy ? <Pill label="Legacy" tone="neutral" /> : undefined}
                  onPress={() => router.push(`/admin/offering/${o.id}`)} />
              ))}
            </>
          )}
        </QueryView>
      </Card>
    </Screen>
  );
}
