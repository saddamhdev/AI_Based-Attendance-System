process.env.EXPO_PUBLIC_API_URL = 'http://192.168.0.109:8080';

const mockAuth = { current: { status: 'signedIn', me: { role: 'STUDENT', username: 'student-a' } } as Record<string, unknown> };
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ state: mockAuth.current }) }));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react-native';
import React from 'react';


import { ApiError, configureApiClient } from '../src/api/client';
import {
  describePhotoFailure, loadPrivateImage, privateImageKey, resolvePrivateImagePath, toBase64,
} from '../src/api/privateImages';
import { SecureImage } from '../src/ui/components';

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PATH = '/student/faces/enr-1/photos/photo-1/thumbnail';

function imageResponse(status: number, body: Uint8Array | string, type = 'image/jpeg') {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? type : null) },
    arrayBuffer: async () => (typeof body === 'string' ? new TextEncoder().encode(body) : body).buffer,
    text: async () => (typeof body === 'string' ? body : ''),
  };
}

const onUnauthorized = jest.fn();
let fetchMock: jest.Mock;
beforeEach(() => {
  onUnauthorized.mockReset();
  configureApiClient({ getToken: () => 'att_student_a', onUnauthorized });
  fetchMock = jest.fn().mockResolvedValue(imageResponse(200, JPEG));
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('photo URL resolution', () => {
  const base = 'http://192.168.0.109:8080';
  it('resolves relative paths and removes a duplicated /api prefix', () => {
    expect(resolvePrivateImagePath(PATH, base)).toBe(PATH);
    expect(resolvePrivateImagePath(`/api${PATH}`, base)).toBe(PATH);
    expect(resolvePrivateImagePath('student/faces/e/photos/p', base)).toBe('/student/faces/e/photos/p');
  });
  it('keeps query strings and accepts absolute URLs on the API origin (HTTPS production too)', () => {
    expect(resolvePrivateImagePath(`${base}/api/students/s/faces/p?enrollmentId=e`, base)).toBe('/students/s/faces/p?enrollmentId=e');
    expect(resolvePrivateImagePath('https://att.example.edu/api/student/faces/e/photos/p', 'https://att.example.edu'))
      .toBe('/student/faces/e/photos/p');
  });
  it('refuses other origins, localhost, Python-service and file URLs so the token is never sent there', () => {
    for (const bad of ['http://localhost:8080/api/x', 'http://192.168.0.109:8001/enroll/x', 'https://evil.example/x', 'file:///data/enrollment-photos/a.jpg']) {
      expect(() => resolvePrivateImagePath(bad, base)).toThrow(expect.objectContaining({ code: 'UNTRUSTED_IMAGE_ORIGIN' }));
    }
  });
});

describe('base64 encoding', () => {
  it('matches Node for every padding case', () => {
    for (let length = 0; length < 12; length++) {
      const bytes = Uint8Array.from({ length }, (_, i) => (i * 37 + 11) % 256);
      expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
    }
  });
});

describe('loadPrivateImage', () => {
  it('fetches the configured API origin with the bearer token and returns a data URI', async () => {
    const uri = await loadPrivateImage(PATH);
    expect(uri).toBe(`data:image/jpeg;base64,${Buffer.from(JPEG).toString('base64')}`);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`http://192.168.0.109:8080/api${PATH}`);
    expect(url).not.toMatch(/\/api\/api\//);
    expect(init.headers.Authorization).toBe('Bearer att_student_a');
    expect(url).not.toMatch(/att_student_a/); // never a credential in the URL
  });

  it('never contacts an untrusted origin', async () => {
    await expect(loadPrivateImage('https://evil.example/photo.jpg')).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('distinguishes missing photos, access denial, expired sessions and network errors', async () => {
    fetchMock.mockResolvedValueOnce(imageResponse(404, '{"message":"Enrollment photo not found"}', 'application/json'));
    expect(describePhotoFailure(await loadPrivateImage(PATH).catch(e => e)).title).toBe('Not stored');

    fetchMock.mockResolvedValueOnce(imageResponse(403, '{}', 'application/json'));
    expect(describePhotoFailure(await loadPrivateImage(PATH).catch(e => e)).title).toBe('No access');

    fetchMock.mockResolvedValueOnce(imageResponse(401, '{"code":"SESSION_EXPIRED"}', 'application/json'));
    expect(describePhotoFailure(await loadPrivateImage(PATH).catch(e => e)).title).toBe('Signed out');
    expect(onUnauthorized).toHaveBeenCalledWith('SESSION_EXPIRED');

    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));
    expect(describePhotoFailure(await loadPrivateImage(PATH).catch(e => e)).title).toBe('Offline');
  });

  it('rejects non-image responses such as an HTML proxy page', async () => {
    fetchMock.mockResolvedValueOnce(imageResponse(200, '<html>login</html>', 'text/html'));
    await expect(loadPrivateImage(PATH)).rejects.toMatchObject({ code: 'NOT_AN_IMAGE' });
  });

  it('isolates cache keys per account and per photo', () => {
    expect(privateImageKey('STUDENT:a', PATH)).not.toEqual(privateImageKey('STUDENT:b', PATH));
    expect(privateImageKey('STUDENT:a', PATH)).not.toEqual(privateImageKey('STUDENT:a', PATH.replace('photo-1', 'photo-2')));
  });
});

describe('SecureImage', () => {
  const wrap = (client: QueryClient, ui: React.ReactElement) => <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
  const clients: QueryClient[] = [];
  const client = () => {
    const created = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    clients.push(created);
    return created;
  };
  afterEach(() => {
    clients.splice(0).forEach(created => created.clear());
  });

  it('shows the photo from an authenticated fetch, not a native header request (regression)', async () => {
    await render(wrap(client(), <SecureImage path={PATH} style={{ width: 96, height: 96 }} accessibilityLabel="Photo 1" />));
    const image = await screen.findByLabelText('Photo 1');
    expect(image.props.source.uri).toMatch(/^data:image\/jpeg;base64,/);
    expect(image.props.source.headers).toBeUndefined();
  });

  it('explains a deleted photo and offers retry instead of a bare "Unavailable"', async () => {
    fetchMock.mockResolvedValue(imageResponse(404, '{"message":"Enrollment photo not found"}', 'application/json'));
    await render(wrap(client(), <SecureImage path={PATH} style={{ width: 96, height: 96 }} accessibilityLabel="Photo 1" />));
    expect(await screen.findByText('Not stored')).toBeTruthy();
    expect(screen.getByText('Tap to retry')).toBeTruthy();
    expect(screen.queryByText('Unavailable')).toBeNull();
  });

  it('never shows another account cached photo after switching accounts', async () => {
    const shared = client();
    fetchMock.mockResolvedValueOnce(imageResponse(200, Uint8Array.from([1, 2, 3]))); // student A
    const first = await render(wrap(shared, <SecureImage path={PATH} style={{}} accessibilityLabel="Photo" />));
    const a = (await screen.findByLabelText('Photo')).props.source.uri;
    await first.unmount();

    mockAuth.current = { status: 'signedIn', me: { role: 'STUDENT', username: 'student-b' } };
    configureApiClient({ getToken: () => 'att_student_b', onUnauthorized });
    fetchMock.mockResolvedValueOnce(imageResponse(200, Uint8Array.from([9, 9, 9]))); // student B
    await render(wrap(shared, <SecureImage path={PATH} style={{}} accessibilityLabel="Photo" />));
    const b = (await screen.findByLabelText('Photo')).props.source.uri;
    expect(b).not.toBe(a);
    expect(fetchMock.mock.calls.at(-1)[1].headers.Authorization).toBe('Bearer att_student_b');
    mockAuth.current = { status: 'signedIn', me: { role: 'STUDENT', username: 'student-a' } };
  });
});
