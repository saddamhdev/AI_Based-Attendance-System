import type { AdminStudent, FaceSubmission } from '../api/types';

/** Summarizes the student's biometric enrollment for the dashboard. */
export function biometricStatus(consent: boolean, submissions: FaceSubmission[] | undefined) {
  if (!submissions) return { label: 'Checking…', tone: 'neutral' as const };
  if (submissions.some(item => item.status === 'ACTIVE') && consent) return { label: 'Enrolled (active)', tone: 'success' as const };
  if (submissions.some(item => item.status === 'PENDING_REVIEW')) return { label: 'Pending review', tone: 'warning' as const };
  if (submissions[0]?.status === 'REJECTED') return { label: 'Action required', tone: 'error' as const };
  return { label: 'Not enrolled (optional)', tone: 'neutral' as const };
}

export function enrollmentLabel(student: AdminStudent) {
  switch (student.enrollment_status) {
    case 'ENROLLED': return { label: 'Face enrolled', tone: 'success' as const };
    case 'PENDING_REVIEW': return { label: 'Face pending review', tone: 'warning' as const };
    case 'ENROLLED_PHOTOS_UNAVAILABLE': return { label: 'Enrolled (no photos)', tone: 'warning' as const };
    default: return { label: 'No face enrollment', tone: 'neutral' as const };
  }
}
