process.env.EXPO_PUBLIC_API_URL = 'http://192.168.1.20:8080';

import {
  ApiError, apiRequest, apiUpload, buildUrl, configureApiClient, describeError, errorFromResponse, setXhrFactory,
} from '../src/api/client';
import { isDeviceUnreachableHost, resolveApiBaseUrl } from '../src/config';

const json = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

describe('configuration', () => {
  it('requires HTTPS in production builds', () => {
    expect(() => resolveApiBaseUrl('http://api.example.edu', 'production')).toThrow(/HTTPS/);
    expect(resolveApiBaseUrl('https://api.example.edu/api/', 'production')).toBe('https://api.example.edu');
  });
  it('accepts a LAN HTTP backend in development and strips /api', () => {
    expect(resolveApiBaseUrl('http://192.168.1.20:8080/api', 'development')).toBe('http://192.168.1.20:8080');
  });
  it('rejects a missing URL with setup guidance', () => {
    expect(() => resolveApiBaseUrl('', 'development')).toThrow(/EXPO_PUBLIC_API_URL/);
  });
  it('flags localhost, which a physical phone cannot reach', () => {
    expect(isDeviceUnreachableHost('http://localhost:8080')).toBe(true);
    expect(isDeviceUnreachableHost('http://127.0.0.1:8080')).toBe(true);
    expect(isDeviceUnreachableHost('http://10.0.2.2:8080')).toBe(false);
  });
  it('builds encoded query strings and skips empty filters', () => {
    expect(buildUrl('/student/attendance', { offeringId: 'a b', fromDate: '', toDate: undefined, page: 0 }, 'https://x.test'))
      .toBe('https://x.test/api/student/attendance?offeringId=a%20b&page=0');
  });
});

describe('error handling', () => {
  it('never exposes non-JSON bodies such as HTML error pages or stack traces', () => {
    const error = errorFromResponse(500, '<html>java.lang.NullPointerException at com.attendance.Api</html>', true);
    expect(error.message).not.toMatch(/NullPointer|com\.attendance|html/);
    expect(error.kind).toBe('http');
  });
  it('keeps the backend message, code, photo errors, and support reference', () => {
    const error = errorFromResponse(422, JSON.stringify({
      code: 'FACE_PHOTO_VALIDATION_FAILED', message: 'Some photos need to be replaced.',
      photoErrors: [{ photoIndex: 2, code: 'MULTIPLE_FACES', message: 'contains multiple faces.' }],
      supportReferenceId: null, previousEnrollmentPreserved: true,
    }), true);
    expect(error.code).toBe('FACE_PHOTO_VALIDATION_FAILED');
    expect(error.photoErrors).toHaveLength(1);
    expect(error.previousEnrollmentPreserved).toBe(true);
  });
  it('appends the support reference for unexpected failures', () => {
    const error = errorFromResponse(500, JSON.stringify({ message: 'Something went wrong.', supportReferenceId: 'ref-123' }), true);
    expect(describeError(error)).toContain('ref-123');
  });
  it('only treats 401 as session expiry when a token was sent', () => {
    expect(errorFromResponse(401, '{}', true).kind).toBe('unauthorized');
    expect(errorFromResponse(401, '{}', false).kind).toBe('http');
  });
});

describe('apiRequest', () => {
  const onUnauthorized = jest.fn();
  beforeEach(() => {
    onUnauthorized.mockReset();
    configureApiClient({ getToken: () => 'att_token', onUnauthorized });
  });

  it('sends the bearer token and JSON body', async () => {
    const fetchMock = jest.fn().mockResolvedValue(json(200, { ok: 1 }));
    global.fetch = fetchMock as unknown as typeof fetch;
    await apiRequest('/sessions', { method: 'POST', body: { a: 1 } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://192.168.1.20:8080/api/sessions');
    expect(init.headers.Authorization).toBe('Bearer att_token');
    expect(init.body).toBe('{"a":1}');
  });

  it('signals session expiry on 401 so private data can be cleared', async () => {
    global.fetch = jest.fn().mockResolvedValue(json(401, { code: 'SESSION_EXPIRED', message: 'Expired' })) as unknown as typeof fetch;
    await expect(apiRequest('/me')).rejects.toMatchObject({ kind: 'unauthorized' });
    expect(onUnauthorized).toHaveBeenCalledWith('SESSION_EXPIRED');
  });

  it('marks a lost response to a state-changing request as uncertain (never retried blindly)', async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Network request failed')) as unknown as typeof fetch;
    const error: ApiError = await apiRequest<never>('/sessions/1/confirm', { method: 'POST', body: {} }).catch((e: ApiError) => e);
    expect(error.kind).toBe('network');
    expect(error.uncertain).toBe(true);
    const read: ApiError = await apiRequest<never>('/sessions').catch((e: ApiError) => e);
    expect(read.uncertain).toBe(false);
  });

  it('times out instead of hanging', async () => {
    global.fetch = jest.fn((_url: string, init: { signal: AbortSignal }) => new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')));
    })) as unknown as typeof fetch;
    const error: ApiError = await apiRequest<never>('/sessions', { method: 'PUT', body: {}, timeoutMs: 20 }).catch((e: ApiError) => e);
    expect(error.kind).toBe('timeout');
    expect(error.uncertain).toBe(true);
  });
});

class FakeXhr {
  static last: FakeXhr;
  headers: Record<string, string> = {};
  upload: { onload: ((e: unknown) => void) | null } = { onload: null };
  onload: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  ontimeout: ((e: unknown) => void) | null = null;
  onabort: ((e: unknown) => void) | null = null;
  status = 0;
  responseText = '';
  timeout = 0;
  method = '';
  url = '';
  body: unknown;
  constructor() { FakeXhr.last = this; }
  open(method: string, url: string) { this.method = method; this.url = url; }
  setRequestHeader(key: string, value: string) { this.headers[key] = value; }
  send(body: unknown) { this.body = body; }
  abort() { this.onabort?.({}); }
}

describe('apiUpload (multipart)', () => {
  beforeEach(() => {
    configureApiClient({ getToken: () => 'att_token', onUnauthorized: jest.fn() });
    setXhrFactory(() => new FakeXhr() as never);
  });

  it('sends file parts with the token, lets the client set the boundary, and reports real stages', async () => {
    const stages: string[] = [];
    const promise = apiUpload<{ status: string }>('/student/faces', {
      fields: { consent: 'true', submissionId: 'sub-1' },
      files: [{ field: 'images', uri: 'file:///cache/a.jpg', name: 'face-1.jpg', type: 'image/jpeg' }],
    }, { onStage: stage => stages.push(stage) });
    const xhr = FakeXhr.last;
    expect(xhr.headers.Authorization).toBe('Bearer att_token');
    expect(Object.keys(xhr.headers).map(k => k.toLowerCase())).not.toContain('content-type');
    expect(xhr.body).toBeInstanceOf(FormData);
    xhr.upload.onload?.({});
    xhr.status = 200;
    xhr.responseText = '{"status":"PENDING_REVIEW"}';
    xhr.onload?.({});
    await expect(promise).resolves.toEqual({ status: 'PENDING_REVIEW' });
    expect(stages).toEqual(['uploading', 'processing']);
  });

  it('treats an interrupted upload as uncertain so the same submission ID is reused', async () => {
    const promise = apiUpload('/student/faces', { files: [] });
    FakeXhr.last.onerror?.({});
    await expect(promise).rejects.toMatchObject({ kind: 'network', uncertain: true });
  });
});
