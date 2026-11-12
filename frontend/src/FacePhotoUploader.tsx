import { useEffect, useRef, useState } from 'react';
import {
  friendlyPhotoIssue,
  PhotoIssue,
  previewFacePhoto,
  releaseFacePhotoPreview,
  snapshotSelectedFiles,
  UploadFailure,
  uploadConfirmation,
} from './facePhotoUpload';
import './face-photo-upload.css';

type Props = {
  studentId: string;
  name: string;
  roll: string;
  mode: 'student' | 'admin';
  consentRecorded?: boolean;
  onSubmit: (files: File[], submissionId: string, consent: boolean) => Promise<{ status: string }>;
};

type SelectedPhoto = {
  id: string;
  file: File;
  issue?: PhotoIssue;
  previewStatus: 'PREVIEWING' | 'READY' | 'FAILED';
  previewUrl?: string;
};

function FacePhotoUploaderInstance({
  studentId,
  name,
  roll,
  mode,
  consentRecorded = true,
  onSubmit,
}: Props) {
  const [photos, setPhotos] = useState<SelectedPhoto[]>([]);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<UploadFailure | null>(null);
  const [selectionError, setSelectionError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const replaceInputs = useRef<Record<string, HTMLInputElement | null>>({});
  const operationRef = useRef('');
  const photosRef = useRef<SelectedPhoto[]>([]);
  const previewControllers = useRef(new Map<string, { generation: number; controller: AbortController }>());
  const previewGenerations = useRef(new Map<string, number>());
  const previewUrls = useRef(new Map<string, string>());
  const mounted = useRef(true);
  const label = `${name} (${roll})`;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      operationRef.current = '';
      previewControllers.current.forEach(({ controller }) => controller.abort());
      previewControllers.current.clear();
      previewUrls.current.forEach(releaseFacePhotoPreview);
      previewUrls.current.clear();
    };
  }, [studentId]);

  function updatePhotos(update: (current: SelectedPhoto[]) => SelectedPhoto[]) {
    const next = update(photosRef.current);
    photosRef.current = next;
    setPhotos(next);
  }

  function cancelPreview(id: string) {
    previewControllers.current.get(id)?.controller.abort();
    previewControllers.current.delete(id);
    const url = previewUrls.current.get(id);
    if (url) releaseFacePhotoPreview(url);
    previewUrls.current.delete(id);
  }

  function startPreview(id: string, file: File) {
    cancelPreview(id);
    const generation = (previewGenerations.current.get(id) ?? 0) + 1;
    previewGenerations.current.set(id, generation);
    const controller = new AbortController();
    previewControllers.current.set(id, { generation, controller });
    updatePhotos(current => current.map(photo => photo.id === id
      ? { id, file, previewStatus: 'PREVIEWING' }
      : photo));

    void previewFacePhoto(file, controller.signal).then(result => {
      const currentOperation = previewControllers.current.get(id);
      if (!mounted.current || currentOperation?.generation !== generation) {
        if (result.url) releaseFacePhotoPreview(result.url);
        return;
      }
      previewControllers.current.delete(id);
      if (result.cancelled) return;
      if (result.url) previewUrls.current.set(id, result.url);
      updatePhotos(current => current.map(photo => photo.id === id
        ? {
          ...photo,
          previewStatus: result.issue ? 'FAILED' : 'READY',
          ...(result.issue ? { issue: result.issue } : {}),
          ...(result.url ? { previewUrl: result.url } : {}),
        }
        : photo));
    }).catch(() => {
      const currentOperation = previewControllers.current.get(id);
      if (!mounted.current || currentOperation?.generation !== generation) return;
      previewControllers.current.delete(id);
      updatePhotos(current => current.map(photo => photo.id === id
        ? {
          ...photo,
          previewStatus: 'FAILED',
          issue: {
            photoIndex: 0,
            code: 'PREVIEW_FAILED',
            message: 'A preview could not be completed. Replace this photo with a valid JPEG or PNG.',
          },
        }
        : photo));
    });
  }

  function addFiles(files: FileList | File[], replaceId?: string) {
    const selected = Array.from(files);
    if (!selected.length) return;
    setError(null);
    setStatus('');
    setSelectionError('');
    if (replaceId) {
      if (photosRef.current.some(photo => photo.id === replaceId)) {
        startPreview(replaceId, selected[0]);
      }
      return;
    }
    const available = Math.max(0, 10 - photosRef.current.length);
    if (selected.length > available) setSelectionError('A submission can contain no more than 10 photos.');
    const accepted = selected.slice(0, available);
    const added = accepted.map(file => ({
      id: crypto.randomUUID(),
      file,
      previewStatus: 'PREVIEWING' as const,
    }));
    updatePhotos(current => [
      ...current,
      ...added,
    ]);
    added.forEach(photo => startPreview(photo.id, photo.file));
  }

  function removePhoto(id: string) {
    cancelPreview(id);
    previewGenerations.current.delete(id);
    updatePhotos(current => current.filter(photo => photo.id !== id));
  }

  function thumbnailFailed(id: string, url: string) {
    if (photosRef.current.find(photo => photo.id === id)?.previewUrl !== url) return;
    cancelPreview(id);
    updatePhotos(current => current.map(photo => photo.id === id
      ? {
        ...photo,
        previewUrl: undefined,
        previewStatus: 'FAILED',
        issue: {
          photoIndex: 0,
          code: 'PREVIEW_FAILED',
          message: 'The photo preview failed to load. Replace it with a valid JPEG or PNG.',
        },
      }
      : photo));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSelectionError('');
    setStatus('');
    const readyPhotos = photosRef.current.filter(photo => photo.previewStatus === 'READY' && !photo.issue);
    if (photosRef.current.length < 5 || photosRef.current.length > 10 || readyPhotos.length !== photosRef.current.length) {
      setSelectionError('Select between 5 and 10 valid photos.');
      return;
    }
    if (mode === 'student' && !consent) {
      setSelectionError('Give explicit consent before submitting face photos.');
      return;
    }
    if (mode === 'admin' && !consentRecorded) {
      setSelectionError('Record biometric consent before uploading photos.');
      return;
    }
    if (mode === 'admin' && !consent) {
      setSelectionError('Verify the student’s identity and confirm recorded consent.');
      return;
    }
    if (mode === 'admin' && !window.confirm(
      `Upload and activate face enrollment for ${label}? Confirm identity verification and recorded consent.`,
    )) return;

    const operationId = crypto.randomUUID();
    operationRef.current = `${studentId}:${operationId}`;
    setBusy(true);
    setStatus(mode === 'student'
      ? `Processing photo submission for ${label}…`
      : `Processing enrollment for ${label}…`);
    try {
      const result = await onSubmit(readyPhotos.map(photo => photo.file), operationId, mode === 'student' || consent);
      if (operationRef.current !== `${studentId}:${operationId}`) return;
      const confirmation = uploadConfirmation(mode, result?.status, name, roll);
      photosRef.current.forEach(photo => cancelPreview(photo.id));
      updatePhotos(() => []);
      setConsent(false);
      if (inputRef.current) inputRef.current.value = '';
      setStatus(confirmation);
    } catch (reason) {
      if (operationRef.current !== `${studentId}:${operationId}`) return;
      const failure: UploadFailure = reason instanceof Error
        ? reason as UploadFailure
        : Object.assign(new Error('Photo submission failed.'), { code: 'UPLOAD_FAILED' });
      setError(failure);
      if (failure.photoErrors?.length) {
        const byIndex = new Map<number, PhotoIssue>(
          failure.photoErrors.map(issue => [issue.photoIndex - 1, issue]),
        );
        updatePhotos(current => current.map(photo => {
          const submittedIndex = readyPhotos.findIndex(item => item.id === photo.id);
          const issue = byIndex.get(submittedIndex);
          return issue ? { ...photo, issue } : photo;
        }));
      }
      setStatus('');
    } finally {
      if (operationRef.current === `${studentId}:${operationId}` && mounted.current) setBusy(false);
    }
  }

  const invalidCount = photos.filter(photo => photo.issue || photo.previewStatus === 'FAILED').length;
  const previewingCount = photos.filter(photo => photo.previewStatus === 'PREVIEWING').length;
  const readyCount = photos.filter(photo => photo.previewStatus === 'READY' && !photo.issue).length;
  const submitDisabledReason = busy ? ''
    : mode === 'admin' && !consentRecorded ? 'Record verified consent before uploading.'
      : invalidCount > 0 ? `Replace ${invalidCount} invalid photo${invalidCount === 1 ? '' : 's'} or remove ${invalidCount === 1 ? 'it' : 'them'}.`
        : previewingCount > 0 ? `Previewing ${previewingCount} photo${previewingCount === 1 ? '' : 's'}; wait for previews to finish.`
          : readyCount < 5 ? 'Select at least 5 valid photos.'
            : photos.length > 10 ? 'A submission can contain no more than 10 photos.'
              : mode === 'admin' && !consent ? 'Verify identity and confirm recorded consent.'
                : mode === 'student' && !consent ? 'Give consent before submitting photos.'
                  : '';

  return (
    <section className="card face-upload" data-student-id={studentId} data-mode={mode}>
      <h3>{mode === 'student' ? 'Submit face photos' : `Face-photo upload for ${label}`}</h3>
      {mode === 'admin' && <p>Student: <strong>{name}</strong> · Roll: <strong>{roll}</strong></p>}
      {mode === 'admin' && !consentRecorded && (
        <p role="alert" className="error">Verified biometric consent is required before uploading.</p>
      )}
      <form onSubmit={submit}>
        <label className="upload">
          Choose 5–10 JPEG or PNG photos
          <input ref={inputRef} type="file" accept="image/jpeg,image/png" multiple
            disabled={busy || (mode === 'admin' && !consentRecorded)}
            onChange={event => {
              const files = snapshotSelectedFiles(event.currentTarget);
              if (files.length) addFiles(files);
            }} />
        </label>
        {photos.length > 0 && <p>{photos.length} photo(s) selected for {label}; {readyCount} previewed and valid.</p>}
        <div className="preview-strip">
          {photos.map((photo, index) => (
            <figure className="face-photo-preview" key={`${studentId}:${photo.id}`}>
              {photo.previewUrl && <img src={photo.previewUrl} alt={`Photo ${index + 1} for ${name}`}
                onError={() => thumbnailFailed(photo.id, photo.previewUrl!)} />}
              <figcaption>Photo {index + 1} · {photo.previewStatus === 'PREVIEWING' ? 'Previewing' : photo.issue || photo.previewStatus === 'FAILED' ? 'Needs replacement' : 'Ready'}</figcaption>
              {photo.issue && <p role="alert" className="photo-error">{friendlyPhotoIssue(photo.issue)}</p>}
              <div className="inline">
                <button type="button" className="secondary" disabled={busy}
                  onClick={() => removePhoto(photo.id)}>Remove</button>
                <button type="button" className="secondary" disabled={busy}
                  onClick={() => replaceInputs.current[photo.id]?.click()}>Replace photo</button>
                <input ref={element => { replaceInputs.current[photo.id] = element; }} className="visually-hidden"
                  type="file" accept="image/jpeg,image/png" disabled={busy}
                  aria-label={`Replace photo ${index + 1} for ${name}`}
                  onChange={event => {
                    const files = snapshotSelectedFiles(event.currentTarget);
                    if (files.length) addFiles(files, photo.id);
                  }} />
              </div>
            </figure>
          ))}
        </div>
        {mode === 'student'
          ? <label className="consent-text"><input type="checkbox" checked={consent}
              onChange={event => setConsent(event.target.checked)} />
            I consent to processing of these face photos to create a biometric template for attendance matching.</label>
          : consentRecorded && <label className="consent-text"><input type="checkbox" checked={consent}
              onChange={event => setConsent(event.target.checked)} />
            I verified this student’s identity and confirmed biometric consent is recorded.</label>}
        {selectionError && <p role="alert" className="error">{selectionError}</p>}
        {error && <div role="alert" className="error">
          <p>{error.message}</p>
          {error.supportReferenceId && <p>Support reference: {error.supportReferenceId}</p>}
        </div>}
        {status && <p role="status" className="notice">{status}</p>}
        {!busy && submitDisabledReason && <p className="upload-hint">{submitDisabledReason}</p>}
        <button type="submit" disabled={Boolean(submitDisabledReason) || busy}>
          {busy ? 'Processing photos…' : mode === 'student' ? 'Submit for admin review' : 'Upload and activate enrollment'}
        </button>
      </form>
    </section>
  );
}

export default function FacePhotoUploader(props: Props) {
  return <FacePhotoUploaderInstance key={`${props.mode}:${props.studentId}`} {...props} />;
}
