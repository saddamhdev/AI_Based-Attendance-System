import Constants from 'expo-constants';

export type AppEnv = 'development' | 'production';

type Extra = { appEnv?: AppEnv; apiUrl?: string };

export class ConfigError extends Error {}

/**
 * Normalizes and validates the configured backend origin. The app talks only to Spring Boot,
 * so the URL is the Spring Boot (or reverse proxy) origin without the /api suffix.
 */
export function resolveApiBaseUrl(raw: string | undefined, appEnv: AppEnv): string {
  const value = (raw ?? '').trim().replace(/\/+$/, '').replace(/\/api$/, '');
  if (!value) {
    throw new ConfigError(
      'EXPO_PUBLIC_API_URL is not set. Copy mobile/.env.example to mobile/.env and set the backend address.',
    );
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigError(`EXPO_PUBLIC_API_URL is not a valid URL: ${value}`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ConfigError('EXPO_PUBLIC_API_URL must start with http:// or https://');
  }
  if (appEnv === 'production' && url.protocol !== 'https:') {
    throw new ConfigError('Production builds require an HTTPS backend URL.');
  }
  return value;
}

/** Hosts that only work on the machine running the backend, not on a phone. */
export function isDeviceUnreachableHost(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

const extra = (Constants.expoConfig?.extra ?? {}) as Extra;
export const appEnv: AppEnv = extra.appEnv === 'production' ? 'production' : 'development';

let cached: string | null = null;
let cachedError: ConfigError | null = null;
export function apiBaseUrl(): string {
  if (cached) return cached;
  if (cachedError) throw cachedError;
  try {
    cached = resolveApiBaseUrl(process.env.EXPO_PUBLIC_API_URL || extra.apiUrl, appEnv);
    return cached;
  } catch (error) {
    cachedError = error instanceof ConfigError ? error : new ConfigError(String(error));
    throw cachedError;
  }
}

/** Limits enforced by the backend and Python service; mirrored here for early, per-photo feedback. */
export const LIMITS = {
  enrollmentMinPhotos: 5,
  enrollmentMaxPhotos: 10,
  classroomMinPhotos: 1,
  classroomMaxPhotos: 3,
  maxUploadBytes: 10 * 1024 * 1024,
  minDimension: 30,
  maxPixels: 24_000_000,
  previewTimeoutMs: 20_000,
  requestTimeoutMs: 30_000,
  uploadTimeoutMs: 180_000,
} as const;
