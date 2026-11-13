import { useQuery } from '@tanstack/react-query';
import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { describeError } from '../api/client';
import { staff } from '../api/endpoints';
import type { ReportFilters, ReportType } from '../api/types';
import { useMe } from '../auth/AuthProvider';
import { REPORT_COLUMNS } from '../features/reportColumns';
import { reportHtml, sharePdf, shareTextFile } from '../features/share';
import { Banner, Button, Card, Empty, ErrorBanner, Field, H2, Loading, Muted, Row, Screen, Select, Stat } from '../ui/components';
import { DateField } from '../ui/DateField';
import { percent } from '../ui/format';
import { colors, space } from '../ui/theme';

/** Uses the backend's report filters and totals so numbers match the web application. */
export default function Reports() {
  const me = useMe();
  const [filters, setFilters] = useState<ReportFilters>({ type: 'COURSE', status: 'ALL' });
  const [page, setPage] = useState(0);
  const [exporting, setExporting] = useState<'' | 'csv' | 'pdf'>('');
  const [exportError, setExportError] = useState('');
  const set = <K extends keyof ReportFilters>(key: K, value: ReportFilters[K]) => {
    setPage(0);
    setFilters(current => ({ ...current, [key]: value || undefined, ...(key === 'courseId' ? { offeringId: undefined, sessionId: undefined } : {}) }));
  };
  const invalidRange = Boolean(filters.fromDate && filters.toDate && filters.fromDate > filters.toDate);
  const options = useQuery({ queryKey: ['reports', 'options', filters.courseId], queryFn: () => staff.reportOptions({ courseId: filters.courseId }) });
  const report = useQuery({ queryKey: ['reports', filters, page], queryFn: () => staff.report(filters, page, 50), enabled: !invalidRange });
  const columns = REPORT_COLUMNS[filters.type];

  async function exportReport(kind: 'csv' | 'pdf') {
    setExporting(kind);
    setExportError('');
    try {
      if (kind === 'csv') {
        await shareTextFile('attendance-report.csv', await staff.reportCsv(filters), 'text/csv', 'public.comma-separated-values-text');
      } else {
        const data = await staff.reportExportData(filters);
        const s = data.summary;
        await sharePdf('attendance-report.pdf', reportHtml(String(data.title ?? 'Attendance report'), [
          ['Generated', data.generatedAt], ['Timezone', data.timezone], ['Finalized sessions', s.finalizedSessions],
          ['Distinct students', s.distinctStudents], ['Present records', s.presentRecords], ['Absent records', s.absentRecords],
          ['Attendance percentage', percent(s.attendancePercentage)],
        ], columns, data.rows));
      }
    } catch (error) {
      setExportError(describeError(error));
    } finally {
      setExporting('');
    }
  }

  return (
    <Screen refreshing={report.isRefetching} onRefresh={() => void report.refetch()}>
      <Card>
        <H2>Filters</H2>
        <Select label="Report" value={filters.type} onChange={value => set('type', value as ReportType)} options={[
          { value: 'COURSE', label: 'By course' }, { value: 'SESSION', label: 'By session' },
          { value: 'STUDENT', label: 'By student' }, { value: 'DETAIL', label: 'Detailed records' },
        ]} />
        <Select label="Course" value={filters.courseId ?? ''} onChange={value => set('courseId', value)}
          options={[{ value: '', label: 'All permitted courses' }, ...(options.data?.courses ?? []).map(c => ({ value: c.id, label: `${c.course_code} — ${c.name}` }))]} />
        <Select label="Offering" value={filters.offeringId ?? ''} onChange={value => set('offeringId', value)}
          options={[{ value: '', label: 'All offerings' }, ...(options.data?.offerings ?? []).map(o => ({
            value: o.id, label: `${o.course_code} — ${o.academic_term}${o.academic_year ? ` ${o.academic_year}` : ''} — ${o.batch} — ${o.section}` }))]} />
        {me.role === 'ADMIN' ? (
          <Select label="Teacher" value={filters.teacherId ?? ''} onChange={value => set('teacherId', value)}
            options={[{ value: '', label: 'All teachers' }, ...(options.data?.teachers ?? []).map(t => ({ value: t.id, label: t.display_name }))]} />
        ) : null}
        <Select label="Session" value={filters.sessionId ?? ''} onChange={value => set('sessionId', value)}
          options={[{ value: '', label: 'All sessions' }, ...(options.data?.sessions ?? []).map(s => ({
            value: s.id, label: `${s.course_code} · ${s.class_date} ${s.class_start_time?.slice(0, 5) ?? ''}` }))]} />
        <Row>
          <DateField label="From date" value={filters.fromDate ?? ''} onChange={value => set('fromDate', value)} clearable />
          <DateField label="To date" value={filters.toDate ?? ''} onChange={value => set('toDate', value)} clearable />
        </Row>
        <Row>
          <DateField label="From time" mode="time" value={filters.fromTime ?? ''} onChange={value => set('fromTime', value)} clearable />
          <DateField label="To time" mode="time" value={filters.toTime ?? ''} onChange={value => set('toTime', value)} clearable />
        </Row>
        <Field label="Student (name or roll)" value={filters.student ?? ''} onChangeText={value => set('student', value)} autoCapitalize="none" />
        <Select label="Attendance status" value={filters.status ?? 'ALL'} onChange={value => set('status', value as ReportFilters['status'])}
          options={[{ value: 'ALL', label: 'All' }, { value: 'PRESENT', label: 'Present' }, { value: 'ABSENT', label: 'Absent' }]} />
        {invalidRange ? <Banner tone="error">The From date must not be after the To date.</Banner> : null}
      </Card>

      {report.isPending && !invalidRange ? <Loading label="Building report…" /> : null}
      <ErrorBanner error={report.error} onRetry={() => void report.refetch()} />
      {report.data ? (
        <>
          <Row style={{ marginBottom: space.md }}>
            <Stat label="Finalized sessions" value={report.data.summary.finalizedSessions} />
            <Stat label="Students" value={report.data.summary.distinctStudents} />
            <Stat label="Present" value={report.data.summary.presentRecords} />
            <Stat label="Absent" value={report.data.summary.absentRecords} />
            <Stat label="Attendance" value={percent(report.data.summary.attendancePercentage)} />
          </Row>
          <Row>
            <Button title="Share CSV" variant="secondary" loading={exporting === 'csv'} disabled={Boolean(exporting)} onPress={() => void exportReport('csv')} />
            <Button title="Share PDF" variant="secondary" loading={exporting === 'pdf'} disabled={Boolean(exporting)} onPress={() => void exportReport('pdf')} />
          </Row>
          {exportError ? <Banner tone="error" title="Export failed">{exportError}</Banner> : null}
          <Card>
            {report.data.rows.length === 0 ? <Empty title="No finalized classes match these filters" /> : (
              <ScrollView horizontal>
                <View>
                  <View style={styles.tr}>{columns.map(column => <Text key={column} style={[styles.td, styles.th]}>{column.replace(/_/g, ' ')}</Text>)}</View>
                  {report.data.rows.map((row, index) => (
                    <View key={index} style={styles.tr}>
                      {columns.map(column => <Text key={column} style={styles.td}>{column === 'attendance_percentage' ? percent(row[column] as number) : String(row[column] ?? '—')}</Text>)}
                    </View>
                  ))}
                </View>
              </ScrollView>
            )}
            <Row>
              <Button title="Previous" variant="ghost" disabled={page === 0} onPress={() => setPage(page - 1)} />
              <Muted>Page {page + 1} of {Math.max(1, Math.ceil(Number(report.data.totalRows ?? 0) / 50))}</Muted>
              <Button title="Next" variant="ghost" disabled={(page + 1) * 50 >= Number(report.data.totalRows ?? 0)} onPress={() => setPage(page + 1)} />
            </Row>
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  tr: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.divider },
  td: { width: 120, padding: 6, fontSize: 12, color: colors.text },
  th: { fontWeight: '700', backgroundColor: colors.primarySoft },
});
