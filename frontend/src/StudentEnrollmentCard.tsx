import React, { useEffect, useRef, useState } from 'react';

type Student = Record<string, any>;

type Props = {
  student: Student;
  busy: boolean;
  onUpload: (studentId: string, files: File[]) => Promise<void>;
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
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const enrolled = student.enrollment_status === 'ENROLLED';
  const photosUnavailable = student.enrollment_status === 'ENROLLED_PHOTOS_UNAVAILABLE';
  const inputId = `face-photos-${student.id}`;

  useEffect(() => {
    const urls = files.map(file => URL.createObjectURL(file));
    setPreviews(urls);
    return () => urls.forEach(URL.revokeObjectURL);
  }, [files]);

  async function saveEnrollment() {
    const studentId = String(student.id);
    const filesToUpload = files.slice();
    setSaving(true);
    setError('');
    setStatus('Uploading and processing photos…');
    try {
      await onUpload(studentId, filesToUpload);
      setFiles([]);
      if (inputRef.current) inputRef.current.value = '';
      setStatus('Enrollment saved.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setStatus('');
    } finally {
      setSaving(false);
    }
  }

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
          <div className="inline">
            <label className="upload" htmlFor={inputId}>
              {enrolled || photosUnavailable ? 'Replace face photos' : 'Upload 5–10 face photos'}
              <input
                ref={inputRef}
                id={inputId}
                type="file"
                accept="image/jpeg,image/png"
                multiple
                disabled={saving || !student.consent}
                onChange={event => {
                  const selectedFiles = Array.from(event.currentTarget.files || []);
                  event.currentTarget.value = '';
                  setError('');
                  setStatus('');
                  if (selectedFiles.length > 10) {
                    setError('Select no more than 10 photos.');
                    return;
                  }
                  setFiles(selectedFiles);
                }}
              />
            </label>
            {files.length > 0 && (
              <>
                <span>{files.length} selected</span>
                <button type="button" disabled={saving || files.length < 5} onClick={saveEnrollment}>
                  {saving ? 'Saving…' : 'Save enrollment'}
                </button>
              </>
            )}
          </div>
          {error && <p role="alert" className="error">{error}</p>}
          {status && <p role="status" className="notice">{status}</p>}
          {previews.length > 0 && (
            <div className="preview-strip">
              {previews.map((url, index) => (
                <div key={url}>
                  <img src={url} alt={`Preview ${index + 1}`} />
                  <button
                    type="button"
                    className="secondary"
                    disabled={saving}
                    onClick={() => setFiles(current => current.filter((_, fileIndex) => fileIndex !== index))}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
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
