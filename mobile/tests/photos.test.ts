jest.mock('../src/auth/privateFiles', () => ({
  deleteTempFile: jest.fn(),
  privateDir: jest.fn(),
}));
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: {}, SaveFormat: { JPEG: 'jpeg' } }));
jest.mock('expo-file-system', () => ({ File: jest.fn() }));

import { deleteTempFile } from '../src/auth/privateFiles';
import { preparePhoto, type Prepared } from '../src/photos/prepare';
import {
  mapServerPhotoErrors, precheckAsset, submitCheck, validatePrepared, type PhotoItem,
} from '../src/photos/rules';

const asset = { uri: 'file:///cache/ImagePicker/a.heic', width: 4032, height: 3024, type: 'image', mimeType: 'image/heic' };
const item = (status: PhotoItem['status'], id = Math.random().toString()): PhotoItem => ({ clientId: id, source: 'gallery', status });

describe('photo validation rules', () => {
  it('accepts HEIC/HEIF/WebP for conversion to JPEG but rejects other formats with advice', () => {
    expect(precheckAsset(asset)).toBeNull();
    expect(precheckAsset({ ...asset, mimeType: 'image/webp' })).toBeNull();
    const gif = precheckAsset({ ...asset, mimeType: 'image/gif' });
    expect(gif?.code).toBe('UNSUPPORTED_FORMAT');
    expect(gif?.advice).toMatch(/JPEG|camera/);
    expect(precheckAsset({ ...asset, type: 'video' })?.code).toBe('NOT_A_PHOTO');
  });

  it('enforces the backend limits on the prepared file', () => {
    expect(validatePrepared(1600, 1200, 400_000)).toBeNull();
    expect(validatePrepared(1600, 1200, 11 * 1024 * 1024)?.code).toBe('FILE_TOO_LARGE');
    expect(validatePrepared(20, 20, 1000)?.code).toBe('IMAGE_TOO_SMALL');
    expect(validatePrepared(6000, 5000, 1000)?.code).toBe('IMAGE_TOO_LARGE');
    expect(validatePrepared(100, 100, 0)?.code).toBe('EMPTY_FILE');
  });

  it('explains every reason submit is disabled', () => {
    const items = [item('ready'), item('ready'), item('preparing'), item('invalid')];
    const check = submitCheck(items, 'enrollment', { consent: false });
    expect(check.canSubmit).toBe(false);
    expect(check.reasons.join(' ')).toMatch(/still being prepared/);
    expect(check.reasons.join(' ')).toMatch(/Remove or replace 1 photo/);
    expect(check.reasons.join(' ')).toMatch(/Add 3 more valid photos/);
    expect(check.reasons.join(' ')).toMatch(/consent/);
  });

  it('allows 5–10 enrollment photos and 1–3 classroom photos', () => {
    const five = Array.from({ length: 5 }, () => item('ready'));
    expect(submitCheck(five, 'enrollment', { consent: true }).canSubmit).toBe(true);
    expect(submitCheck(five.slice(0, 1), 'classroom').canSubmit).toBe(true);
    expect(submitCheck(Array.from({ length: 4 }, () => item('ready')), 'classroom').reasons.join(' ')).toMatch(/Remove 1 photo/);
  });

  it('maps 1-based server photo errors back to stable client IDs and keeps the others', () => {
    const mapped = mapServerPhotoErrors(['a', 'b', 'c'], [
      { photoIndex: 2, code: 'MULTIPLE_FACES', message: 'contains multiple faces.' },
      { photoIndex: 9, code: 'NO_DETECTABLE_FACE', message: 'has no detectable face.' },
    ], 'enrollment');
    expect(Object.keys(mapped)).toEqual(['b']);
    expect(mapped.b.message).toBe('This photo contains multiple faces.');
    expect(mapped.b.advice).toMatch(/one face/);
  });

  it('distinguishes enrollment and classroom advice for the same face code', () => {
    const enroll = mapServerPhotoErrors(['a'], [{ photoIndex: 1, code: 'NO_DETECTABLE_FACE', message: 'has no detectable face.' }], 'enrollment');
    const room = mapServerPhotoErrors(['a'], [{ photoIndex: 1, code: 'NO_DETECTABLE_FACE', message: 'has no detectable face.' }], 'classroom');
    expect(enroll.a.advice).not.toEqual(room.a.advice);
  });
});

describe('preparePhoto', () => {
  beforeEach(() => (deleteTempFile as jest.Mock).mockClear());

  it('returns the processed JPEG and removes the picker cache copy', async () => {
    const processor = jest.fn(async (): Promise<Prepared> => ({ ok: true, uri: 'file:///cache/attend-private/photos/x.jpg', width: 1600, height: 1200, bytes: 300_000 }));
    const result = await preparePhoto(asset, 'enrollment', 'x', { processor });
    expect(result).toMatchObject({ ok: true, width: 1600 });
    expect(processor).toHaveBeenCalledWith(asset, 'enrollment', 'x');
    expect(deleteTempFile).toHaveBeenCalledWith(asset.uri);
  });

  it('never stays stuck: a hung preview settles with a timeout issue, and a late result is discarded', async () => {
    let finish: (value: Prepared) => void = () => undefined;
    const processor = () => new Promise<Prepared>(resolve => { finish = resolve; });
    const result = await preparePhoto(asset, 'enrollment', 'slow', { processor, timeoutMs: 10 });
    expect(result).toEqual({ ok: false, issue: expect.objectContaining({ code: 'PREVIEW_TIMEOUT' }) });
    finish({ ok: true, uri: 'file:///cache/attend-private/photos/slow.jpg', width: 1, height: 1, bytes: 1 });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(deleteTempFile).toHaveBeenCalledWith('file:///cache/attend-private/photos/slow.jpg');
  });

  it('turns a decoder failure into a specific, recoverable issue', async () => {
    const result = await preparePhoto(asset, 'classroom', 'bad', { processor: () => Promise.reject(new Error('decode')) });
    expect(result).toEqual({ ok: false, issue: expect.objectContaining({ code: 'PREVIEW_FAILED' }) });
  });

  it('rejects unsupported files before processing', async () => {
    const processor = jest.fn();
    const result = await preparePhoto({ ...asset, mimeType: 'image/gif' }, 'enrollment', 'gif', { processor });
    expect(result.ok).toBe(false);
    expect(processor).not.toHaveBeenCalled();
  });
});
