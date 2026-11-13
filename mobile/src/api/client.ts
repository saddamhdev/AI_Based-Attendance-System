import { apiBaseUrl, ConfigError, LIMITS } from '../config';

export type ApiErrorKind = 'network' | 'timeout' | 'http' | 'unauthorized' | 'config' | 'aborted';

export type PhotoError = { photoIndex: number; code: string; message: string };

/**
 * A user-safe failure. `message` is either the backend's sanitized message or a generic
 * description; raw bodies (HTML error pages, stack traces) are never surfaced.
 */
export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;
  readonly code?: string;
  readonly supportReferenceId?: string;
  readonly photoErrors: PhotoError[];
  readonly photoIndex?: number;
  readonly previousEnrollmentPreserved?: boolean;
  /** True when a state-changing request may have reached the server (lost response). */
  readonly uncertain: boolean;

  constructor(init: {
    kind: ApiErrorKind;
    message: string;
    status?: number;
    code?: string;
    supportReferenceId?: string;
    photoErrors?: PhotoError[];
    photoIndex?: number;
    previousEnrollmentPreserved?: boolean;
    uncertain?: boolean;
  }) {
    super(init.message);
    this.name = 'ApiError';
    this.kind = init.kind;
    this.status = init.status;
    this.code = init.code;
    this.supportReferenceId = init.supportReferenceId;
    this.photoErrors = init.photoErrors ?? [];
    this.photoIndex = init.photoIndex;
    this.previousEnrollmentPreserved = init.previousEnrollmentPreserved;
    this.uncertain = init.uncertain ?? false;
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

/** Text suitable for display, including a support reference when the server issued one. */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.supportReferenceId && !error.message.includes(error.supportReferenceId)) {
      return `${error.message} Support reference: ${error.supportReferenceId}.`;
    }
    return error.message;
  }
  if (error instanceof ConfigError) return error.message;
  return 'Something went wrong on this device. Try again.';
}

type ClientHooks = {
  getToken: () => string | null;
  onUnauthorized: (code: string | undefined) => void;
};

let hooks: ClientHooks = { getToken: () => null, onUnauthorized: () => undefined };

export function configureApiClient(next: ClientHooks) {
  hooks = next;
}


export type Query = Record<string, string | number | boolean | null | undefined>;

export function buildUrl(path: string, query?: Query, base = apiBaseUrl()): string {
  const params = Object.entries(query ?? {})
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  return `${base}/api${path.startsWith('/') ? path : `/${path}`}${params.length ? `?${params.join('&')}` : ''}`;
}

function genericMessage(status: number): string {
  if (status === 400 || status === 422) return 'The request could not be accepted. Check the details and try again.';
  if (status === 401) return 'Sign in to continue.';
  if (status === 403) return 'You do not have permission to do this.';
  if (status === 404) return 'The requested record was not found.';
  if (status === 409) return 'This record changed. Refresh and try again.';
  if (status === 413) return 'The upload is too large.';
  if (status === 429) return 'Too many attempts. Wait a few minutes and try again.';
  if (status === 502 || status === 503 || status === 504) {
    return 'The service is temporarily unavailable. Try again shortly.';
  }
  return 'The server could not complete the request. Try again.';
}

/** Builds an ApiError from a non-2xx response body (JSON from Spring Boot, or anything else). */
export function errorFromResponse(status: number, bodyText: string, hadToken: boolean): ApiError {
  let payload: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(bodyText);
    if (parsed && typeof parsed === 'object') payload = parsed as Record<string, unknown>;
  } catch {
    // Non-JSON body (proxy page, etc.) — never shown to the user.
  }
  const message = typeof payload.message === 'string' && payload.message.trim() && payload.message.length < 600
    ? payload.message
    : genericMessage(status);
  const photoErrors = Array.isArray(payload.photoErrors)
    ? (payload.photoErrors as PhotoError[]).filter(item => typeof item?.photoIndex === 'number')
    : [];
  return new ApiError({
    kind: status === 401 && hadToken ? 'unauthorized' : 'http',
    status,
    code: typeof payload.code === 'string' ? payload.code : undefined,
    message,
    supportReferenceId: typeof payload.supportReferenceId === 'string' ? payload.supportReferenceId : undefined,
    photoErrors,
    photoIndex: typeof payload.photoIndex === 'number' ? payload.photoIndex : undefined,
    previousEnrollmentPreserved: typeof payload.previousEnrollmentPreserved === 'boolean'
      ? payload.previousEnrollmentPreserved : undefined,
  });
}

function handleUnauthorized(error: ApiError) {
  if (error.kind === 'unauthorized') hooks.onUnauthorized(error.code);
}

export type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Query;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Send the bearer token (default true). */
  auth?: boolean;
  /** Override the token, e.g. right after sign-in before it is stored. */
  token?: string;
};

async function rawFetch(path: string, options: RequestOptions, accept: string): Promise<Response> {
  const method = options.method ?? 'GET';
  const token = options.auth === false ? null : options.token ?? hooks.getToken();
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? LIMITS.requestTimeoutMs);
  const onAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onAbort);
  const headers: Record<string, string> = { Accept: accept };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  let url: string;
  try {
    url = buildUrl(path, options.query);
  } catch (error) {
    clearTimeout(timer);
    throw new ApiError({ kind: 'config', message: error instanceof Error ? error.message : 'App configuration error.' });
  }
  try {
    const response = await fetch(url, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
    if (!response.ok) {
      const error = errorFromResponse(response.status, await response.text().catch(() => ''), Boolean(token));
      handleUnauthorized(error);
      throw error;
    }
    return response;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const stateChanging = method !== 'GET';
    if (options.signal?.aborted && !timedOut) {
      throw new ApiError({ kind: 'aborted', message: 'The request was cancelled.', uncertain: stateChanging });
    }
    if (timedOut) {
      throw new ApiError({
        kind: 'timeout',
        message: stateChanging
          ? 'The server did not answer in time. The change may or may not have been saved; refresh to check before retrying.'
          : 'The server did not answer in time. Check your connection and retry.',
        uncertain: stateChanging,
      });
    }
    throw new ApiError({
      kind: 'network',
      message: stateChanging
        ? 'The connection was interrupted. The change may or may not have been saved; refresh to check before retrying.'
        : 'Cannot reach the attendance server. Check your connection or the configured server address.',
      uncertain: stateChanging,
    });
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await rawFetch(path, options, 'application/json');
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError({ kind: 'http', status: response.status, message: 'The server sent an unreadable response.' });
  }
}

export async function apiText(path: string, options: RequestOptions = {}): Promise<string> {
  const response = await rawFetch(path, options, 'text/csv, text/plain, */*');
  return response.text();
}

/** Authenticated binary GET (private images). Same token, timeout, and error handling as JSON calls. */
export async function apiBinary(path: string, options: RequestOptions = {}): Promise<{ bytes: Uint8Array; contentType: string }> {
  const response = await rawFetch(path, { ...options, method: 'GET' }, 'image/jpeg, image/png, image/*');
  const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch {
    throw new ApiError({ kind: 'network', message: 'The photo download was interrupted. Retry.' });
  }
  return { bytes, contentType };
}

// ---------------------------------------------------------------- multipart uploads

export type UploadFilePart = { field: string; uri: string; name: string; type: 'image/jpeg' | 'image/png' };
export type UploadStage = 'uploading' | 'processing';

type XhrLike = Pick<XMLHttpRequest,
  'open' | 'setRequestHeader' | 'send' | 'abort' | 'status' | 'responseText' | 'timeout'> & {
  upload?: { onload: ((event: unknown) => void) | null } | null;
  onload: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  ontimeout: ((event: unknown) => void) | null;
  onabort: ((event: unknown) => void) | null;
};

let xhrFactory: () => XhrLike = () => new XMLHttpRequest() as unknown as XhrLike;
/** Test seam. */
export function setXhrFactory(factory: () => XhrLike) {
  xhrFactory = factory;
}

/**
 * Sends real image bytes as multipart/form-data. React Native reads each `{uri,name,type}` part
 * from the local file and streams its bytes; the boundary and Content-Type header are generated
 * by the HTTP client (never set manually). Uses XHR so the "upload finished, server processing"
 * transition is a real event rather than a simulated percentage.
 */
export function apiUpload<T>(
  path: string,
  parts: { fields?: Record<string, string>; files: UploadFilePart[] },
  options: { onStage?: (stage: UploadStage) => void; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const token = hooks.getToken();
    let url: string;
    try {
      url = buildUrl(path);
    } catch (error) {
      reject(new ApiError({ kind: 'config', message: error instanceof Error ? error.message : 'App configuration error.' }));
      return;
    }
    const form = new FormData();
    for (const [key, value] of Object.entries(parts.fields ?? {})) form.append(key, value);
    for (const file of parts.files) {
      // React Native's FormData accepts a file descriptor object for a local URI.
      form.append(file.field, { uri: file.uri, name: file.name, type: file.type } as unknown as Blob);
    }
    const xhr = xhrFactory();
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener('abort', onAbort);
      action();
    };
    const onAbort = () => xhr.abort();
    xhr.open('POST', url);
    xhr.timeout = options.timeoutMs ?? LIMITS.uploadTimeoutMs;
    xhr.setRequestHeader('Accept', 'application/json');
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    if (xhr.upload) xhr.upload.onload = () => options.onStage?.('processing');
    xhr.onload = () => finish(() => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve((xhr.responseText ? JSON.parse(xhr.responseText) : undefined) as T);
        } catch {
          reject(new ApiError({ kind: 'http', status: xhr.status, message: 'The server sent an unreadable response.' }));
        }
        return;
      }
      const error = errorFromResponse(xhr.status, xhr.responseText ?? '', Boolean(token));
      handleUnauthorized(error);
      reject(error);
    });
    xhr.onerror = () => finish(() => reject(new ApiError({
      kind: 'network',
      message: 'The upload was interrupted (connection lost or app moved to the background). '
        + 'Check the submission status before retrying.',
      uncertain: true,
    })));
    xhr.ontimeout = () => finish(() => reject(new ApiError({
      kind: 'timeout',
      message: 'Processing took too long. Check the submission status before retrying.',
      uncertain: true,
    })));
    xhr.onabort = () => finish(() => reject(new ApiError({
      kind: 'aborted', message: 'The upload was cancelled.', uncertain: true,
    })));
    options.signal?.addEventListener('abort', onAbort);
    options.onStage?.('uploading');
    xhr.send(form as unknown as Document);
  });
}
