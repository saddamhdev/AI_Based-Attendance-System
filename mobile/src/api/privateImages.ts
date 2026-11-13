import { apiBaseUrl } from '../config';
import { ApiError, apiBinary } from './client';

/**
 * Private biometric photos are loaded through the same authenticated fetch as every other API
 * call and displayed from an in-memory data URI — the same approach as the web app (fetch → blob URL).
 *
 * Handing the URL plus an Authorization header to the native <Image> loader is not reliable:
 * whether the native image pipeline forwards custom headers depends on how it is configured
 * (Expo Go vs. dev builds, Android Fresco fetcher), and its onError hides the HTTP status, so a
 * 401 looked identical to a missing file ("Unavailable").
 */

/**
 * Normalizes a photo reference to an API-relative path ("/student/faces/…").
 * Accepts "/student/…", "/api/student/…", or an absolute URL on the configured API origin.
 * Anything else (another origin, file:, localhost when not the API origin) is refused so the
 * bearer token is never sent to an untrusted host.
 */
export function resolvePrivateImagePath(reference: string, base = apiBaseUrl()): string {
  const value = reference.trim();
  if (!value) throw untrusted('The photo reference is empty.');
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    let url: URL;
    let api: URL;
    try {
      url = new URL(value);
      api = new URL(base);
    } catch {
      throw untrusted('The photo address is invalid.');
    }
    if (url.origin !== api.origin) throw untrusted('The photo address is not on the attendance server.');
    return stripApiPrefix(`${url.pathname}${url.search}`, api.pathname);
  }
  return stripApiPrefix(value.startsWith('/') ? value : `/${value}`, '');
}

function stripApiPrefix(path: string, basePath: string): string {
  let result = path;
  const prefix = basePath.replace(/\/+$/, '');
  if (prefix && result.startsWith(`${prefix}/`)) result = result.slice(prefix.length);
  while (result.startsWith('/api/')) result = result.slice(4);
  return result;
}

function untrusted(message: string) {
  return new ApiError({ kind: 'config', code: 'UNTRUSTED_IMAGE_ORIGIN', message });
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Dependency-free base64 encoder (Hermes-safe, no string-size limits from btoa). */
export function toBase64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += `${B64[(n >> 18) & 63]}${B64[(n >> 12) & 63]}==`;
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += `${B64[(n >> 18) & 63]}${B64[(n >> 12) & 63]}${B64[(n >> 6) & 63]}=`;
  }
  return out;
}

/** Downloads a private photo with the bearer token and returns a displayable data URI. */
export async function loadPrivateImage(reference: string, signal?: AbortSignal): Promise<string> {
  const path = resolvePrivateImagePath(reference);
  const { bytes, contentType } = await apiBinary(path, { signal, timeoutMs: 30_000 });
  const type = contentType.split(';')[0].trim();
  if (type !== 'image/jpeg' && type !== 'image/png') {
    throw new ApiError({ kind: 'http', code: 'NOT_AN_IMAGE', message: 'The server did not return a photo.' });
  }
  if (!bytes.length) throw new ApiError({ kind: 'http', code: 'EMPTY_IMAGE', status: 404, message: 'This photo file is empty.' });
  return `data:${type};base64,${toBase64(bytes)}`;
}

/** Query key: isolated per signed-in account and per photo path (which contains the photo ID). */
export function privateImageKey(ownerKey: string, reference: string) {
  return ['private-image', ownerKey, reference] as const;
}

export type PhotoFailure = { title: string; detail: string; retryable: boolean };

/** Separates missing/deleted photos from permission, session, and connection problems. */
export function describePhotoFailure(error: unknown): PhotoFailure {
  if (error instanceof ApiError) {
    if (error.code === 'UNTRUSTED_IMAGE_ORIGIN') return { title: 'Blocked', detail: 'Untrusted photo address.', retryable: false };
    if (error.kind === 'unauthorized') return { title: 'Signed out', detail: 'Sign in again to view photos.', retryable: false };
    if (error.status === 404) return { title: 'Not stored', detail: 'This photo was removed or is no longer kept.', retryable: true };
    if (error.status === 403) return { title: 'No access', detail: 'You cannot view this photo.', retryable: false };
    if (error.kind === 'network') return { title: 'Offline', detail: 'Cannot reach the server.', retryable: true };
    if (error.kind === 'timeout') return { title: 'Timed out', detail: 'The server was too slow.', retryable: true };
    if (error.kind === 'config') return { title: 'Setup error', detail: error.message, retryable: false };
  }
  return { title: 'Could not load', detail: 'The photo could not be shown.', retryable: true };
}
