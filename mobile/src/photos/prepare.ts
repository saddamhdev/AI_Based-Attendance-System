import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { LIMITS } from '../config';
import { deleteTempFile, privateDir } from '../auth/privateFiles';
import {
  precheckAsset, previewTimeoutIssue, processingFailedIssue, PROFILE, validatePrepared,
  type PhotoIssue, type PhotoProfile,
} from './rules';

export type PickedAsset = {
  uri: string;
  width: number;
  height: number;
  type?: string | null;
  mimeType?: string | null;
};

export type Prepared =
  | { ok: true; uri: string; width: number; height: number; bytes: number }
  | { ok: false; issue: PhotoIssue };

type Processor = (asset: PickedAsset, profile: PhotoProfile, clientId: string) => Promise<Prepared>;

/**
 * Re-encodes a picked photo as an upright JPEG:
 * - decoding applies the EXIF orientation, so pixels are stored upright and the dimensions
 *   the server reports match what the viewer draws;
 * - HEIC/HEIF/WebP/PNG become JPEG, which the backend accepts;
 * - re-encoding drops EXIF metadata (including GPS location);
 * - the long edge is reduced only down to the profile limit, never upscaled.
 */
export const nativeProcessor: Processor = async (asset, profile, clientId) => {
  const { maxEdge, quality } = PROFILE[profile];
  const context = ImageManipulator.manipulate(asset.uri, { maxWidth: maxEdge, maxHeight: maxEdge });
  const image = await context.renderAsync();
  try {
    let saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: quality });
    let file = new File(saved.uri);
    if (file.size > LIMITS.maxUploadBytes) {
      deleteTempFile(saved.uri);
      saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.7 });
      file = new File(saved.uri);
    }
    const target = new File(privateDir('photos'), `${clientId}.jpg`);
    if (target.exists) target.delete();
    file.moveSync(target);
    const issue = validatePrepared(saved.width, saved.height, target.size);
    if (issue) {
      deleteTempFile(target.uri);
      return { ok: false, issue };
    }
    return { ok: true, uri: target.uri, width: saved.width, height: saved.height, bytes: target.size };
  } finally {
    image.release();
    context.release();
  }
};

/**
 * Prepares a photo and always settles: success, a specific issue, or a timeout.
 * A result that arrives after the timeout is discarded and its file deleted.
 */
export async function preparePhoto(
  asset: PickedAsset,
  profile: PhotoProfile,
  clientId: string,
  options: { processor?: Processor; timeoutMs?: number } = {},
): Promise<Prepared> {
  const pre = precheckAsset(asset);
  if (pre) return { ok: false, issue: pre };
  const processor = options.processor ?? nativeProcessor;
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = processor(asset, profile, clientId).then(
    result => {
      if (timedOut && result.ok) deleteTempFile(result.uri);
      return result;
    },
    (): Prepared => ({ ok: false, issue: processingFailedIssue() }),
  );
  const timeout = new Promise<Prepared>(resolve => {
    timer = setTimeout(() => {
      timedOut = true;
      resolve({ ok: false, issue: previewTimeoutIssue() });
    }, options.timeoutMs ?? LIMITS.previewTimeoutMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
    // The picker's own cache copy is no longer needed once a private JPEG exists (or failed).
    if (asset.uri.startsWith('file:')) deleteTempFile(asset.uri);
  }
}
