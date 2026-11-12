import React from 'react';
import FacePhotoUploader from './FacePhotoUploader';

type Student = Record<string, any>;

type Props = {
  student: Student;
  busy: boolean;
  onUpload: (studentId: string, files: File[], submissionId: string, consent: boolean) => Promise<{ status: string }>;
  onViewPhotos: (studentId: string, enrollmentId: string) => void;
  onDeleteFaces: (student: Student) => void;
  onDeleteStudent: (student: Student) => void;
};

export default function StudentEnrollmentCard({
  student,
  busy,
  onUpload,
  onViewPhotos,
  onDeleteFaces,
  onDeleteStudent,
}: Props) {
  const enrolled = student.enrollment_status === 'ENROLLED';
  const photosUnavailable = student.enrollment_status === 'ENROLLED_PHOTOS_UNAVAILABLE';

  return (
    <div className={`student ${student.archived ? 'archived' : ''}`}>
      <div>
        <strong>{student.name}</strong>
        <small>
          {student.roll} · {student.archived ? 'Archived' : student.consent ? 'Consent recorded' : 'Consent required'} · Face: {enrolled ? 'Enrolled' : photosUnavailable ? 'Enrolled — photos unavailable' : 'Not enrolled'}
          {enrolled && ` · ${student.accepted_photo_count} photos · ${student.enrollment_date}`}
        </small>
      </div>
      {!student.archived && (
        <>
          {student.consent
            ? <FacePhotoUploader
                key={String(student.id)}
                studentId={String(student.id)}
                name={String(student.name)}
                roll={String(student.roll)}
                mode="admin"
                consentRecorded={Boolean(student.consent)}
                onSubmit={(files, submissionId, consent) => onUpload(
                  String(student.id), files, submissionId, consent,
                )}
              />
            : <p className="notice">Record verified identity and biometric consent before uploading photos.</p>}
          {enrolled && (
            <button type="button" className="secondary" disabled={busy} onClick={() => onViewPhotos(String(student.id), String(student.enrollment_id))}>
              View photos
            </button>
          )}
          <button type="button" className="secondary" disabled={busy} onClick={() => onDeleteFaces(student)}>
            Delete biometric enrollment
          </button>
          <button type="button" className="danger" disabled={busy} onClick={() => onDeleteStudent(student)}>
            {student.attendance_count > 0 ? 'Archive student' : 'Delete student'}
          </button>
        </>
      )}
    </div>
  );
}
