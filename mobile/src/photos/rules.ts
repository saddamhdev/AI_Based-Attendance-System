import { LIMITS } from '../config';

/** enrollment: exactly one face per photo, 5–10 photos. classroom: many faces allowed, 1–3 photos. */
export type PhotoProfile = 'enrollment' | 'classroom';

export type PhotoIssue = { code: string; message: string; advice: string };

export type PhotoStatus = 'selected' | 'preparing' | 'ready' | 'invalid';

export type PhotoItem = {
  /** Stable client-side identifier; never reused, survives reordering and replacement of others. */
  clientId: string;
  source: 'camera' | 'gallery';
  status: PhotoStatus;
  uri?: string;
  width?: number;
  height?: number;
  bytes?: number;
  issue?: PhotoIssue;
};

export const PROFILE = {
  enrollment: {
    min: LIMITS.enrollmentMinPhotos,
    max: LIMITS.enrollmentMaxPhotos,
    // A single close-up face stays well above the detector's 30 px minimum at this size.
    maxEdge: 1600,
    quality: 0.85,
  },
  classroom: {
    min: LIMITS.classroomMinPhotos,
    max: LIMITS.classroomMaxPhotos,
    // Group photos keep more resolution so distant faces are not shrunk below detection size.
    maxEdge: 3072,
    quality: 0.9,
  },
} as const;

const CONVERTIBLE = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/heic', 'image/heif', 'image/webp']);

/** Checks the picker metadata before any processing. Returns an issue or null. */
export function precheckAsset(asset: { type?: string | null; mimeType?: string | null; width: number; height: number }):
PhotoIssue | null {
  if (asset.type && asset.type !== 'image' && asset.type !== 'livePhoto') {
    return { code: 'NOT_A_PHOTO', message: 'This item is not a photo.', advice: 'Choose a still photo instead.' };
  }
  const mime = asset.mimeType?.toLowerCase();
  if (mime && !CONVERTIBLE.has(mime)) {
    return {
      code: 'UNSUPPORTED_FORMAT',
      message: `This format (${mime.replace('image/', '').toUpperCase()}) cannot be used.`,
      advice: 'Choose a JPEG, PNG, or HEIC photo, or take a new one with the camera.',
    };
  }
  if (asset.width > 0 && asset.height > 0 && (asset.width < LIMITS.minDimension || asset.height < LIMITS.minDimension)) {
    return tooSmall();
  }
  return null;
}

export function tooSmall(): PhotoIssue {
  return {
    code: 'IMAGE_TOO_SMALL',
    message: `The photo is smaller than ${LIMITS.minDimension}×${LIMITS.minDimension} pixels.`,
    advice: 'Use a larger, full-resolution photo.',
  };
}

/** Validates the prepared JPEG against the same limits the backend and Python service enforce. */
export function validatePrepared(width: number, height: number, bytes: number): PhotoIssue | null {
  if (!bytes) {
    return { code: 'EMPTY_FILE', message: 'The prepared photo is empty.', advice: 'Remove it and choose the photo again.' };
  }
  if (bytes > LIMITS.maxUploadBytes) {
    return {
      code: 'FILE_TOO_LARGE',
      message: 'The photo is larger than 10 MB even after compression.',
      advice: 'Choose a different photo.',
    };
  }
  if (width < LIMITS.minDimension || height < LIMITS.minDimension) return tooSmall();
  if (width * height > LIMITS.maxPixels) {
    return { code: 'IMAGE_TOO_LARGE', message: 'The photo exceeds 24 megapixels.', advice: 'Choose a smaller photo.' };
  }
  return null;
}

export function previewTimeoutIssue(): PhotoIssue {
  return {
    code: 'PREVIEW_TIMEOUT',
    message: 'Preparing this photo took too long.',
    advice: 'Replace it with another photo, or take a new one with the camera.',
  };
}

export function processingFailedIssue(): PhotoIssue {
  return {
    code: 'PREVIEW_FAILED',
    message: 'This photo could not be opened. It may be damaged or stored only in the cloud.',
    advice: 'Download it to the device first, or choose a different photo.',
  };
}

/** Advice for backend/Python photo error codes. Only codes the server actually checks are explained. */
export function adviceForServerCode(code: string, profile: PhotoProfile): string {
  switch (code) {
    case 'NO_DETECTABLE_FACE':
      return profile === 'enrollment'
        ? 'Retake it facing the camera with the whole face visible and uncovered.'
        : 'No face was detected. Use a photo where students face the camera.';
    case 'MULTIPLE_FACES':
      return 'Only the student may appear. Retake it with one face in the frame.';
    case 'LOW_QUALITY':
      return 'The face is too small in the frame. Move closer and retake it.';
    case 'IMAGE_TOO_SMALL':
    case 'IMAGE_TOO_LARGE':
    case 'FILE_TOO_LARGE':
    case 'UNSUPPORTED_FORMAT':
    case 'INVALID_IMAGE':
      return 'Replace this photo with a different one.';
    default:
      return 'Replace this photo and submit again.';
  }
}

export type SubmitCheck = { canSubmit: boolean; reasons: string[] };

/** Explains exactly why submission is disabled (if it is). */
export function submitCheck(items: PhotoItem[], profile: PhotoProfile, extra: { consent?: boolean; busy?: boolean } = {}):
SubmitCheck {
  const { min, max } = PROFILE[profile];
  const reasons: string[] = [];
  const ready = items.filter(item => item.status === 'ready').length;
  const preparing = items.filter(item => item.status === 'preparing' || item.status === 'selected').length;
  const invalid = items.filter(item => item.status === 'invalid').length;
  if (extra.busy) reasons.push('A submission is in progress.');
  if (preparing) reasons.push(`${preparing} photo${preparing === 1 ? ' is' : 's are'} still being prepared.`);
  if (invalid) reasons.push(`Remove or replace ${invalid} photo${invalid === 1 ? '' : 's'} that need${invalid === 1 ? 's' : ''} attention.`);
  if (ready < min) reasons.push(`Add ${min - ready} more valid photo${min - ready === 1 ? '' : 's'} (${min}–${max} required).`);
  if (items.length > max) reasons.push(`Remove ${items.length - max} photo${items.length - max === 1 ? '' : 's'} (maximum ${max}).`);
  if (extra.consent === false) reasons.push('Confirm biometric consent.');
  return { canSubmit: reasons.length === 0, reasons };
}

/**
 * Server photo errors use 1-based indexes in submission order. Maps them back to the
 * stable client IDs of the photos that were actually sent.
 */
export function mapServerPhotoErrors(
  sentClientIds: string[],
  errors: { photoIndex: number; code: string; message: string }[],
  profile: PhotoProfile,
): Record<string, PhotoIssue> {
  const mapped: Record<string, PhotoIssue> = {};
  for (const error of errors) {
    const clientId = sentClientIds[error.photoIndex - 1];
    if (!clientId) continue;
    const text = error.message.trim();
    mapped[clientId] = {
      code: error.code,
      message: /^[a-z]/.test(text) ? `This photo ${text.replace(/\.?$/, '.')}` : text,
      advice: adviceForServerCode(error.code, profile),
    };
  }
  return mapped;
}
