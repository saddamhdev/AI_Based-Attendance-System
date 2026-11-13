import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import React, { useState } from 'react';

import { describeError } from '../../api/client';
import { student, type StudentFilters } from '../../api/endpoints';
import { shareTextFile } from '../../features/share';
import { Banner, Button, Card, Empty, ErrorBanner, H2, ListItem, Loading, Muted, Pill, Row, Screen, Select, Stat } from '../../ui/components';
import { DateField } from '../../ui/DateField';
import { classTime, percent } from '../../ui/format';

const PAGE = 50;

/** Only the signed-in student's own finalized records; the backend derives identity from the token. */
export default function StudentAttendance() {
  const [offeringId, setOfferingId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [status, setStatus] = useState<'ALL' | 'PRESENT' | 'ABSENT'>('ALL');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const rangeInvalid = Boolean(fromDate && toDate && fromDate > toDate);
  const filters: StudentFilters = { offeringId: offeringId || undefined, fromDate: fromDate || undefined, toDate: toDate || undefined };

  const courses = useQuery({ queryKey: ['student', 'courses'], queryFn: student.courses });
  const totals = useQuery({
    queryKey: ['student', 'dashboard', filters], queryFn: () => student.dashboard(filters), enabled: !rangeInvalid,
  });
  const history = useInfiniteQuery({
    queryKey: ['student', 'attendance', filters, status],
    queryFn: ({ pageParam }) => student.attendance({ ...filters, status, page: pageParam, size: PAGE }),
    initialPageParam: 0,
    getNextPageParam: last => ((last.page + 1) * last.size < last.total ? last.page + 1 : undefined),
    enabled: !rangeInvalid,
  });
  const rows = history.data?.pages.flatMap(page => page.rows) ?? [];

  async function exportCsv() {
    setExporting(true);
    setExportError('');
    try {
      const csv = await student.attendanceCsv(filters);
      await shareTextFile('my-attendance.csv', csv, 'text/csv', 'public.comma-separated-values-text');
    } catch (error) {
      setExportError(describeError(error));
    } finally {
      setExporting(false);
    }
  }

  return (
    <Screen refreshing={history.isRefetching} onRefresh={() => { void history.refetch(); void totals.refetch(); }}>
      <Card>
        <H2>Filters</H2>
        <Select label="Course offering" value={offeringId} onChange={setOfferingId}
          options={[{ value: '', label: 'All offerings' }, ...(courses.data ?? []).map(c => ({ value: c.offering_id, label: c.offering_label }))]} />
        <Row>
          <DateField label="From" value={fromDate} onChange={setFromDate} clearable />
          <DateField label="To" value={toDate} onChange={setToDate} clearable />
        </Row>
        <Select label="Status" value={status} onChange={value => setStatus(value as typeof status)}
          options={[{ value: 'ALL', label: 'All' }, { value: 'PRESENT', label: 'Present' }, { value: 'ABSENT', label: 'Absent' }]} />
        {rangeInvalid ? <Banner tone="error">The From date must not be after the To date.</Banner> : null}
      </Card>

      {totals.data ? (
        totals.data.noFinalizedClasses ? <Empty title="No finalized classes yet" /> : (
          <Row style={{ marginBottom: 16 }}>
            <Stat label="Attendance" value={percent(totals.data.attendancePercentage)} />
            <Stat label="Finalized classes" value={totals.data.totals.finalized_sessions} />
            <Stat label="Present" value={totals.data.totals.present_count} />
            <Stat label="Absent" value={totals.data.totals.absent_count} />
          </Row>
        )
      ) : null}

      <Button title="Download CSV" variant="secondary" loading={exporting} onPress={() => void exportCsv()} disabled={rangeInvalid} />
      {exportError ? <Banner tone="error" title="Export failed">{exportError}</Banner> : null}

      <Card>
        <H2>History</H2>
        <Muted>Students cannot edit attendance. Contact your teacher if a record looks wrong.</Muted>
        {history.isPending && !rangeInvalid ? <Loading /> : null}
        <ErrorBanner error={history.error} onRetry={() => void history.refetch()} />
        {!history.isPending && rows.length === 0 && !history.error ? <Empty title="No finalized classes yet" /> : null}
        {rows.map(row => (
          <ListItem key={row.session_id} title={`${row.course_code} — ${row.course_title}`}
            subtitle={`${classTime(row)} · ${row.teacher_name ?? 'Teacher unknown'}`}
            right={<Pill label={row.attendance_status} tone={row.attendance_status === 'PRESENT' ? 'success' : 'error'} />} />
        ))}
        {history.hasNextPage ? (
          <Button title="Load more" variant="secondary" loading={history.isFetchingNextPage} onPress={() => void history.fetchNextPage()} />
        ) : null}
      </Card>
    </Screen>
  );
}
