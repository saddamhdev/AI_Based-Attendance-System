export type PhotoIssue = {
  photoIndex: number;
  code: string;
  message: string;
};

export type UploadFailure = Error & {
  code?: string;
  photoErrors?: PhotoIssue[];
  supportReferenceId?: string;
  previousEnrollmentPreserved?: boolean;
};

export type FacePhotoPreview = {
  url: string | null;
  issue: PhotoIssue | null;
  cancelled: boolean;
};

export function snapshotSelectedFiles(input: HTMLInputElement): File[] {
  const files = Array.from(input.files ?? []);
  input.value = '';
  return files;
}

export function releaseFacePhotoPreview(url: string) {
  try {
    URL.revokeObjectURL(url);
  } catch {
    // URL cleanup must not prevent file removal or replacement.
  }
}

function photoIssue(code: string, message: string): PhotoIssue {
  return {
    photoIndex: 0,
    code,
    message,
  };
}

export async function previewFacePhoto(
  file: File,
  signal?: AbortSignal,
  timeoutMs = 10_000,
): Promise<FacePhotoPreview> {
  const invalid = (code: string, message: string): FacePhotoPreview => ({
    url: null,
    issue: photoIssue(code, message),
    cancelled: false,
  });
  if (!file.size) return invalid('EMPTY_FILE', 'The selected file is empty.');
  if (file.size > 10 * 1024 * 1024) return invalid('FILE_TOO_LARGE', 'The photo exceeds the 10 MB limit.');
  if (!['image/jpeg', 'image/png'].includes(file.type)) {
    return invalid('UNSUPPORTED_FORMAT', 'Unsupported image format. Choose a JPEG or PNG photo.');
  }
  if (signal?.aborted) return { url: null, issue: null, cancelled: true };

  let url: string;
  try {
    url = URL.createObjectURL(file);
  } catch {
    return invalid('PREVIEW_UNAVAILABLE', 'A preview could not be created. Choose another JPEG or PNG photo.');
  }

  return new Promise(resolve => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    let decodeTimer: ReturnType<typeof setTimeout> | undefined;
    let image: HTMLImageElement;
    const finish = (result: FacePhotoPreview, revoke = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (decodeTimer) clearTimeout(decodeTimer);
      signal?.removeEventListener('abort', onAbort);
      if (image) {
        image.onload = null;
        image.onerror = null;
      }
      if (revoke) releaseFacePhotoPreview(url);
      try {
        if (image) image.src = '';
      } catch {
        // The image has already settled; a cleanup error cannot change its result.
      }
      resolve(result);
    };
    const fail = (code: string, message: string) => finish({
      url: null,
      issue: photoIssue(code, message),
      cancelled: false,
    }, true);
    const onAbort = () => finish({ url: null, issue: null, cancelled: true }, true);

    timer = setTimeout(() => fail(
      'PREVIEW_TIMEOUT',
      'The photo preview took too long. Replace it with a smaller or different JPEG or PNG.',
    ), timeoutMs);

    try {
      image = new Image();
      image.onerror = () => fail(
        'INVALID_IMAGE',
        'This image could not be previewed. It may be corrupt or unsupported; replace it with a valid JPEG or PNG.',
      );
      image.onload = () => {
        if (image.naturalWidth < 30 || image.naturalHeight < 30) {
          fail('IMAGE_TOO_SMALL', 'The photo must be at least 30 by 30 pixels.');
          return;
        }
        if (image.naturalWidth * image.naturalHeight > 24_000_000) {
          fail('IMAGE_TOO_LARGE', 'The photo must not exceed 24 megapixels.');
          return;
        }

        const ready = () => finish({ url, issue: null, cancelled: false });
        if (typeof image.decode !== 'function') {
          ready();
          return;
        }
        try {
          decodeTimer = setTimeout(ready, 100);
          void image.decode().then(ready, () => fail(
            'INVALID_IMAGE',
            'This image could not be decoded. It may be corrupt; replace it with a valid JPEG or PNG.',
          ));
        } catch {
          fail(
            'INVALID_IMAGE',
            'This image could not be decoded. It may be corrupt; replace it with a valid JPEG or PNG.',
          );
        }
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
      else image.src = url;
    } catch {
      fail('PREVIEW_UNAVAILABLE', 'A preview could not be created. Choose another JPEG or PNG photo.');
    }
  });
}

export function friendlyPhotoIssue(issue: PhotoIssue): string {
  const suffix = issue.message.endsWith('.') ? '' : '.';
  return issue.message + suffix;
}

export function uploadConfirmation(
  mode: 'student' | 'admin',
  status: string,
  name: string,
  roll: string,
): string {
  const expected = mode === 'student' ? 'PENDING_REVIEW' : 'ACTIVE';
  if (status !== expected) {
    throw Object.assign(new Error('The server did not confirm the requested enrollment status.'), {
      code: 'STATUS_NOT_CONFIRMED',
    });
  }
  const student = `${name} (${roll})`;
  return mode === 'student'
    ? `Pending admin review for ${student}. Photos are not active for recognition yet.`
    : `Enrollment active for ${student}.`;
}
