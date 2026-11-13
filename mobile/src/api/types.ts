// Shapes returned by the Spring Boot API. Database rows keep their snake_case column names.

export type Role = 'ADMIN' | 'TEACHER' | 'STUDENT' | 'APPLICANT';

export type TokenResponse = { accessToken: string; tokenType: 'Bearer'; expiresAt: string; role: Role };

export type Me = {
  username: string;
  role: Role;
  admin: boolean;
  student: boolean;
  applicant?: boolean;
  mustChangePassword: boolean;
  studentId?: string;
  name?: string;
  roll?: string;
  registrationId?: string;
  registrationStatus?: RegistrationStatus;
};

export type RegistrationStatus = 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';

export type RegistrationInput = {
  name: string;
  roll: string;
  email: string;
  username: string;
  password: string;
  department?: string;
  batch?: string;
};

export type ApplicantRegistration = {
  reference: string;
  status: RegistrationStatus;
  name: string;
  roll: string;
  email: string;
  username: string;
  department: string | null;
  batch: string | null;
  rejectionReason: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  signInAgain: boolean;
};

export type StudentCourse = {
  offering_id: string;
  course_code: string;
  course_title: string;
  academic_term: string;
  academic_year: number | null;
  batch: string;
  section: string;
  offering_label: string;
  teachers: string | null;
};

export type AttendanceRow = {
  session_id: string;
  class_date: string;
  class_start_time: string | null;
  class_end_time: string | null;
  attendance_status: 'PRESENT' | 'ABSENT';
  offering_id: string;
  course_code: string;
  course_title: string;
  offering_label: string;
  teacher_name: string | null;
};

export type Totals = {
  finalized_sessions: number;
  eligible_records: number;
  present_count: number;
  absent_count: number;
};

export type OfferingTotals = Totals & {
  offering_id: string;
  course_code: string;
  offering_label: string;
  attendance_percentage: number | null;
};

export type StudentDashboard = {
  profile: {
    id: string;
    name: string;
    roll: string;
    email: string | null;
    department: string | null;
    batch: string | null;
    consent: boolean;
    account_status: string;
    must_change_password: boolean;
  };
  courses: StudentCourse[];
  totals: Totals;
  attendancePercentage: number | null;
  recentAttendance: AttendanceRow[];
  attendanceByOffering: OfferingTotals[];
  noFinalizedClasses: boolean;
};

export type AttendancePage = { rows: AttendanceRow[]; total: number; page: number; size: number };

export type EnrollmentStatus = 'ACTIVE' | 'PENDING_REVIEW' | 'REJECTED' | 'CANCELLED' | 'RETIRED';

export type FaceSubmission = {
  id: string;
  status: EnrollmentStatus;
  accepted_photo_count: number | null;
  rejection_reason: string | null;
  created_at: string;
  reviewed_at: string | null;
  retention_until: string | null;
};

export type EnrollmentPhoto = { id: string; enrollment_id: string; photo_index: number; width: number; height: number };

export type SubmissionResult = {
  enrollmentId: string;
  submissionId: string;
  studentId: string;
  status: EnrollmentStatus;
  acceptedPhotoCount: number;
  replayed?: boolean;
};

export type AdminStudent = {
  id: string;
  name: string;
  roll: string;
  email: string | null;
  department: string | null;
  batch: string | null;
  consent: boolean;
  archived: boolean;
  attendance_count: number;
  enrollment_id: string | null;
  accepted_photo_count: number | null;
  enrollment_status: 'ENROLLED' | 'PENDING_REVIEW' | 'NOT_ENROLLED' | 'ENROLLED_PHOTOS_UNAVAILABLE';
  pending_enrollment_id: string | null;
  account_username: string | null;
  account_active: boolean | null;
  account_status: string | null;
  must_change_password: boolean | null;
  registration_source: string | null;
};

export type RegistrationRequest = {
  id: string;
  full_name: string;
  roll: string;
  email: string;
  username: string;
  department: string | null;
  batch: string | null;
  candidate_student_id: string | null;
  candidate_name: string | null;
  candidate_roll: string | null;
  candidate_has_account: boolean;
  status: RegistrationStatus;
  rejection_reason: string | null;
  submitted_at: string;
};

export type PendingFaceSubmission = {
  enrollment_id: string;
  student_id: string;
  name: string;
  roll: string;
  email: string | null;
  accepted_photo_count: number;
  created_at: string;
  submission_source: string;
};

export type Offering = {
  id: string;
  course_id: string;
  course_code: string;
  course_title: string;
  academic_term: string;
  academic_year: number | null;
  batch: string;
  section: string;
  archived: boolean;
  legacy: boolean;
  offering_label: string;
  primary_teacher: string | null;
  teachers: string | null;
  enrolled_count: number;
  session_count: number;
  can_create_session: boolean;
};

export type CatalogCourse = { id: string; course_code: string; title: string; active: boolean; offering_count: number };
export type TeacherProfile = { id: string; username: string; display_name: string; active: boolean };
export type TeacherAssignment = {
  id: string;
  offering_id: string;
  teacher_id: string;
  username: string;
  display_name: string;
  assignment_role: 'PRIMARY' | 'CO_TEACHER';
  effective_from: string | null;
  effective_to: string | null;
  legacy: boolean;
  course_code: string;
  course_title: string;
  academic_term: string;
  academic_year: number | null;
  batch: string;
  section: string;
  status: string;
};
export type RosterStudent = { id: string; name: string; roll: string };

export type SessionSummary = {
  id: string;
  course_id: string;
  offering_id: string;
  teacher_profile_id: string | null;
  class_date: string;
  class_start_time: string | null;
  class_end_time: string | null;
  status: 'DRAFT' | 'IN_REVIEW' | 'FINALIZED';
  version: number;
  name: string;
  course_code: string;
  offering_label: string;
  teacher_name: string | null;
};

export type AttendanceState = 'PRESENT' | 'ABSENT' | 'UNCONFIRMED';
export type DecisionSource = 'NONE' | 'AI' | 'MANUAL';

export type SessionRosterEntry = {
  session_id: string;
  student_id: string;
  student_name: string;
  roll: string;
  state: AttendanceState;
  decision_source: DecisionSource;
};

export type FaceResult = {
  faceNumber: number;
  faceId: string;
  boundingBox: { x: number; y: number; width: number; height: number };
  detectionConfidence: number;
  status: 'MATCHED' | 'UNKNOWN' | 'UNCERTAIN' | 'LOW_QUALITY' | 'PROCESSING_FAILED' | string;
  studentId: string | null;
  score?: number | null;
  [key: string]: unknown;
};

export type RecognitionPhoto = { photoId: string; imageWidth: number; imageHeight: number; results: FaceResult[] };

export type RecognitionAnalysis = {
  photos: RecognitionPhoto[];
  matchedStudentIds: string[];
  attendanceStatus: string;
  analysisId: string;
  thresholdPercentage: number;
  initiatingUser: string;
  initiatingRole: string;
  analyzedAt: string;
};

export type SessionDetail = {
  session: SessionSummary & { teacher_username?: string | null };
  roster: SessionRosterEntry[];
  audit: { id: number; actor: string; action: string; created_at: string }[];
  recognitionAnalysis: RecognitionAnalysis | null;
};

export type RecognitionSettings = { threshold: number; saved: boolean };

export type ReportType = 'COURSE' | 'SESSION' | 'STUDENT' | 'DETAIL';
export type ReportFilters = {
  type: ReportType;
  courseId?: string;
  offeringId?: string;
  teacherId?: string;
  sessionId?: string;
  fromDate?: string;
  toDate?: string;
  fromTime?: string;
  toTime?: string;
  student?: string;
  status?: 'ALL' | 'PRESENT' | 'ABSENT';
};
export type ReportResult = {
  rows: Record<string, unknown>[];
  summary: {
    finalizedSessions: number;
    distinctStudents: number;
    presentRecords: number;
    absentRecords: number;
    attendancePercentage: number | null;
    [key: string]: unknown;
  };
  totalRows?: number;
  [key: string]: unknown;
};
export type ReportOptions = {
  courses: { id: string; course_code: string; name: string }[];
  offerings: { id: string; course_code: string; course_name: string; academic_term: string; academic_year: number | null; batch: string; section: string }[];
  teachers: { id: string; display_name: string }[];
  sessions: { id: string; course_code: string; class_date: string; class_start_time: string | null }[];
};
