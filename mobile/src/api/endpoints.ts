import { apiRequest, apiText, apiUpload, type UploadFilePart, type UploadStage } from './client';
import type * as T from './types';

const json = <R>(path: string, options?: Parameters<typeof apiRequest>[1]) => apiRequest<R>(path, options);

// ------------------------------------------------------------------ authentication
export const auth = {
  signIn: (username: string, password: string, clientName: string) =>
    json<T.TokenResponse>('/auth/token', {
      method: 'POST', auth: false, body: { username, password, clientName },
    }),
  /** Revokes the given token. Idempotent; failures are ignored by callers. */
  signOut: (token: string) => json<void>('/auth/token', { method: 'DELETE', token, timeoutMs: 8000 }),
  me: (token?: string) => json<T.Me>('/me', { token }),
  changePassword: (currentPassword: string, newPassword: string, confirmPassword: string) =>
    json<{ passwordChanged: boolean }>('/account/password', {
      method: 'PUT', body: { currentPassword, newPassword, confirmPassword },
    }),
};

// ------------------------------------------------------------------ registration
export const registration = {
  submit: (input: T.RegistrationInput) =>
    json<{ reference: string; statusToken: string; status: T.RegistrationStatus }>('/student-registrations', {
      method: 'POST', auth: false, body: input,
    }),
  mine: () => json<T.ApplicantRegistration>('/applicant/registration'),
  resubmit: (input: Omit<T.RegistrationInput, 'username' | 'password'> & { newPassword?: string }) =>
    json<T.ApplicantRegistration>('/applicant/registration/resubmit', { method: 'POST', body: input }),
};

// ------------------------------------------------------------------ student portal
export type StudentFilters = { offeringId?: string; fromDate?: string; toDate?: string };

export const student = {
  dashboard: (filters: StudentFilters = {}) => json<T.StudentDashboard>('/student/dashboard', { query: filters }),
  courses: () => json<T.StudentCourse[]>('/student/courses'),
  attendance: (filters: StudentFilters & { status?: 'ALL' | 'PRESENT' | 'ABSENT'; page?: number; size?: number }) =>
    json<T.AttendancePage>('/student/attendance', { query: filters }),
  attendanceCsv: (filters: StudentFilters) => apiText('/student/attendance.csv', { query: filters }),
  faceSubmissions: () => json<T.FaceSubmission[]>('/student/faces'),
  facePhotos: (enrollmentId: string) => json<T.EnrollmentPhoto[]>(`/student/faces/${enrollmentId}/photos`),
  facePhotoPath: (enrollmentId: string, photoId: string, thumbnail = true) =>
    `/student/faces/${enrollmentId}/photos/${photoId}${thumbnail ? '/thumbnail' : ''}`,
  submitFaces: (files: UploadFilePart[], submissionId: string, onStage?: (stage: UploadStage) => void) =>
    apiUpload<T.SubmissionResult>('/student/faces', {
      fields: { consent: 'true', submissionId }, files,
    }, { onStage }),
  cancelSubmission: (enrollmentId: string) =>
    json<{ status: string; cleanupPending: boolean }>(`/student/faces/${enrollmentId}`, { method: 'DELETE' }),
  withdrawConsent: () => json<{ consent: boolean }>('/student/consent', { method: 'DELETE', timeoutMs: 60_000 }),
};

// ------------------------------------------------------------------ admin
export const admin = {
  students: () => json<T.AdminStudent[]>('/students', { timeoutMs: 60_000 }),
  createStudent: (input: {
    name: string; roll: string; email?: string; department?: string; batch?: string;
    username?: string; temporaryPassword?: string; consent: boolean;
  }) => json<{ id: string; accountCreated: boolean }>('/admin/students', { method: 'POST', body: input }),
  addAccount: (studentId: string, input: { username: string; email: string; temporaryPassword: string }) =>
    json<{ accountCreated: boolean }>(`/students/${studentId}/account`, { method: 'POST', body: input }),
  setAccountActive: (studentId: string, active: boolean) =>
    json<{ active: boolean }>(`/students/${studentId}/account`, { method: 'PUT', body: { active } }),
  resetPassword: (studentId: string, temporaryPassword: string) =>
    json<{ passwordReset: boolean }>(`/students/${studentId}/account/password-reset`, {
      method: 'POST', body: { temporaryPassword },
    }),
  updateProfile: (studentId: string, input: { name: string; email?: string; department?: string; batch?: string }) =>
    json<{ updated: boolean }>(`/students/${studentId}/profile`, { method: 'PUT', body: input }),
  deleteStudent: (studentId: string) =>
    json<{ archived?: boolean; deleted?: boolean }>(`/students/${studentId}`, { method: 'DELETE', timeoutMs: 60_000 }),
  recordConsent: (studentId: string) =>
    json<{ consent: boolean }>(`/students/${studentId}/consent`, { method: 'POST', body: { consent: true } }),
  deleteFaces: (studentId: string) => json<void>(`/students/${studentId}/faces`, { method: 'DELETE', timeoutMs: 60_000 }),
  activePhotos: (studentId: string, enrollmentId: string) =>
    json<T.EnrollmentPhoto[]>(`/students/${studentId}/faces`, { query: { enrollmentId } }),
  activePhotoPath: (studentId: string, enrollmentId: string, photoId: string, thumbnail = true) =>
    `/students/${studentId}/faces/${photoId}${thumbnail ? '/thumbnail' : ''}?enrollmentId=${encodeURIComponent(enrollmentId)}`,
  enrollFaces: (studentId: string, files: UploadFilePart[], submissionId: string,
    onStage?: (stage: UploadStage) => void) =>
    apiUpload<T.SubmissionResult>(`/students/${studentId}/faces`, {
      fields: { consent: 'true', submissionId }, files,
    }, { onStage }),

  registrations: (status: T.RegistrationStatus, search?: string) =>
    json<T.RegistrationRequest[]>('/admin/student-registrations', { query: { status, search } }),
  approveRegistration: (id: string, existingStudentId?: string | null) =>
    json<{ status: string; studentId: string }>(`/admin/student-registrations/${id}/approve`, {
      method: 'POST', body: { existingStudentId: existingStudentId ?? null },
    }),
  rejectRegistration: (id: string, reason: string) =>
    json<{ status: string }>(`/admin/student-registrations/${id}/reject`, { method: 'POST', body: { reason } }),

  faceSubmissions: () => json<T.PendingFaceSubmission[]>('/admin/face-submissions'),
  faceSubmissionPhotos: (enrollmentId: string) =>
    json<T.EnrollmentPhoto[]>(`/admin/face-submissions/${enrollmentId}/photos`),
  faceSubmissionPhotoPath: (enrollmentId: string, photoId: string, thumbnail = true) =>
    `/admin/face-submissions/${enrollmentId}/photos/${photoId}${thumbnail ? '/thumbnail' : ''}`,
  approveFaces: (enrollmentId: string) =>
    json<{ status: string }>(`/admin/face-submissions/${enrollmentId}/approve`, { method: 'POST', timeoutMs: 60_000 }),
  rejectFaces: (enrollmentId: string, reason: string) =>
    json<{ status: string; cleanupPending: boolean }>(`/admin/face-submissions/${enrollmentId}/reject`, {
      method: 'POST', body: { reason }, timeoutMs: 60_000,
    }),

  catalogCourses: () => json<T.CatalogCourse[]>('/academic/courses'),
  createCourse: (courseCode: string, title: string) =>
    json<{ id: string }>('/academic/courses', { method: 'POST', body: { courseCode, title } }),
  archiveCourse: (id: string) => json<unknown>(`/academic/courses/${id}/archive`, { method: 'POST' }),
  activateCourse: (id: string) => json<unknown>(`/academic/courses/${id}/activate`, { method: 'POST' }),
  createOffering: (input: { courseId: string; academicTerm: string; academicYear?: number | null; batch: string; section: string }) =>
    json<{ id: string }>('/offerings', { method: 'POST', body: input }),
  archiveOffering: (id: string) => json<unknown>(`/offerings/${id}/archive`, { method: 'POST' }),
  activateOffering: (id: string) => json<unknown>(`/offerings/${id}/activate`, { method: 'POST' }),
  teachers: () => json<T.TeacherProfile[]>('/teacher-profiles'),
  createTeacher: (username: string, displayName: string, password: string) =>
    json<{ id: string }>('/teacher-profiles', { method: 'POST', body: { username, displayName, password } }),
  assignments: (query: { offeringId?: string; teacherId?: string } = {}) =>
    json<T.TeacherAssignment[]>('/teacher-assignments', { query }),
  assignTeacher: (input: { offeringId: string; teacherId: string; role: 'PRIMARY' | 'CO_TEACHER'; effectiveFrom: string; effectiveTo?: string | null }) =>
    json<{ id: string }>('/teacher-assignments', { method: 'POST', body: input }),
  endAssignment: (id: string, effectiveTo: string) =>
    json<unknown>(`/teacher-assignments/${id}/end`, { method: 'POST', body: { effectiveTo } }),
  enrollStudent: (offeringId: string, studentId: string) =>
    json<{ id: string }>(`/offerings/${offeringId}/students/${studentId}`, { method: 'POST' }),
  withdrawStudent: (offeringId: string, studentId: string) =>
    json<unknown>(`/offerings/${offeringId}/students/${studentId}`, { method: 'DELETE' }),
  deleteSession: (id: string) => json<unknown>(`/sessions/${id}`, { method: 'DELETE' }),
};

// ------------------------------------------------------------------ staff (admin + teacher)
export const staff = {
  offerings: (includeArchived = false) => json<T.Offering[]>('/offerings', { query: { includeArchived } }),
  offeringRoster: (offeringId: string) => json<T.RosterStudent[]>(`/offerings/${offeringId}/students`),
  sessions: () => json<T.SessionSummary[]>('/sessions'),
  createSession: (input: { offeringId: string; date: string; startTime: string; endTime: string; teacherId?: string; authorizeSubstitute?: boolean }) =>
    json<{ id: string; overlapWarning: boolean }>('/sessions', { method: 'POST', body: input }),
  session: (id: string) => json<T.SessionDetail>(`/sessions/${id}`),
  saveDraft: (id: string, version: number, states: Record<string, string>, sources: Record<string, string>) =>
    json<T.SessionDetail>(`/sessions/${id}`, { method: 'PUT', body: { version, states, sources } }),
  confirm: (id: string, version: number) =>
    json<T.SessionDetail>(`/sessions/${id}/confirm`, { method: 'POST', body: { version } }),
  recognize: (id: string, files: UploadFilePart[], onStage?: (stage: UploadStage) => void) =>
    apiUpload<T.RecognitionAnalysis>(`/sessions/${id}/recognize`, { files }, { onStage }),
  recognitionSettings: () => json<T.RecognitionSettings>('/me/recognition-settings'),
  saveThreshold: (threshold: number) =>
    json<T.RecognitionSettings>('/me/recognition-settings', { method: 'PUT', body: { threshold } }),
  resetThreshold: () => json<T.RecognitionSettings>('/me/recognition-settings', { method: 'PUT', body: { reset: true } }),
  reportOptions: (filters: Partial<T.ReportFilters> = {}) =>
    json<T.ReportOptions>('/reporting/options', { query: { ...filters, type: undefined } }),
  report: (filters: T.ReportFilters, page = 0, size = 50) =>
    json<T.ReportResult>('/reporting', { query: { ...filters, page, size }, timeoutMs: 60_000 }),
  reportExportData: (filters: T.ReportFilters) =>
    json<T.ReportResult & { title?: string; generatedAt?: string; timezone?: string }>('/reporting/export-data', {
      query: filters, timeoutMs: 90_000,
    }),
  reportCsv: (filters: T.ReportFilters) => apiText('/reporting/export.csv', { query: filters, timeoutMs: 90_000 }),
};
