import type { ReportType } from '../api/types';

/** Subset of the backend CSV columns (Reports.columns) that fits a phone table. */
export const REPORT_COLUMNS: Record<ReportType, string[]> = {
  COURSE: ['course_code', 'course_name', 'finalized_sessions', 'student_session_records', 'present_count', 'absent_count', 'attendance_percentage'],
  SESSION: ['course_code', 'section', 'teacher_name', 'class_date', 'class_start_time', 'roster_count', 'present_count', 'absent_count', 'attendance_percentage'],
  STUDENT: ['roll', 'student_name', 'course_code', 'section', 'eligible_sessions', 'present_count', 'absent_count', 'attendance_percentage'],
  DETAIL: ['course_code', 'section', 'teacher_name', 'class_date', 'class_start_time', 'roll', 'student_name', 'state'],
};
