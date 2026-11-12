import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = await readFile(new URL('../src/facePhotoUpload.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function uploaderModule(behaviorFor = () => 'load', createUrl = file => `blob:${file.name}`) {
  const revoked = [];
  const images = [];
  class FakeImage {
    naturalWidth = 64;
    naturalHeight = 64;
    onload = null;
    onerror = null;
    behavior = 'load';
    _src = '';

    constructor() {
      images.push(this);
    }

    set src(value) {
      this._src = value;
      if (!value) return;
      this.behavior = behaviorFor(value);
      if (this.behavior === 'small') this.naturalWidth = 20;
      if (this.behavior === 'never') return;
      queueMicrotask(() => {
        if (this.behavior === 'error') this.onerror?.();
        else this.onload?.();
      });
    }

    get src() {
      return this._src;
    }

    decode() {
      if (this.behavior === 'never-decode') return new Promise(() => {});
      return this.behavior === 'decode-error'
        ? Promise.reject(new Error('decode failed'))
        : Promise.resolve();
    }
  }

  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    exports: module.exports,
    module,
    Image: FakeImage,
    setTimeout,
    clearTimeout,
    URL: {
      createObjectURL: createUrl,
      revokeObjectURL: url => revoked.push(url),
    },
  });
  return { api: module.exports, images, revoked };
}

const file = (name, type = 'image/jpeg', size = 100) => ({ name, type, size });

test('student and admin only receive success text for their required completed status', () => {
  const { uploadConfirmation } = uploaderModule().api;
  assert.equal(
    uploadConfirmation('student', 'PENDING_REVIEW', 'Student One', 'S-1'),
    'Pending admin review for Student One (S-1). Photos are not active for recognition yet.',
  );
  assert.equal(
    uploadConfirmation('admin', 'ACTIVE', 'Student One', 'S-1'),
    'Enrollment active for Student One (S-1).',
  );
  assert.throws(() => uploadConfirmation('admin', 'PENDING_REVIEW', 'Student One', 'S-1'), {
    code: 'STATUS_NOT_CONFIRMED',
  });
  assert.throws(() => uploadConfirmation('student', 'ACTIVE', 'Student One', 'S-1'), {
    code: 'STATUS_NOT_CONFIRMED',
  });
});

test('snapshots selected files before clearing a live file input list', () => {
  const { snapshotSelectedFiles } = uploaderModule().api;
  const selected = [file('selected.png', 'image/png')];
  const input = {
    files: selected,
    set value(value) {
      if (value === '') this.files = [];
    },
  };
  const result = snapshotSelectedFiles(input);
  assert.deepEqual([...result].map(item => item.name), ['selected.png']);
  assert.equal(input.files.length, 0);
});

test('valid JPEG and PNG previews settle and keep their Blob URLs until released', async () => {
  const { api, revoked } = uploaderModule();
  const expectedRevoked = [];
  for (const [name, type] of [['valid.jpg', 'image/jpeg'], ['valid.png', 'image/png']]) {
    const result = await api.previewFacePhoto(file(name, type));
    assert.equal(result.issue, null);
    assert.equal(result.url, `blob:${name}`);
    api.releaseFacePhotoPreview(result.url);
    expectedRevoked.push(`blob:${name}`);
    assert.deepEqual(revoked, expectedRevoked);
  }
});

test('rejects unsupported, empty, oversized, and corrupt images with actionable errors', async () => {
  const { api } = uploaderModule(url => url.includes('corrupt') ? 'error' : 'load');
  assert.equal((await api.previewFacePhoto(file('empty.jpg', 'image/jpeg', 0))).issue.code, 'EMPTY_FILE');
  assert.equal((await api.previewFacePhoto(file('animated.gif', 'image/gif'))).issue.code, 'UNSUPPORTED_FORMAT');
  assert.equal((await api.previewFacePhoto(file('large.jpg', 'image/jpeg', 10 * 1024 * 1024 + 1))).issue.code, 'FILE_TOO_LARGE');
  const corrupt = await api.previewFacePhoto(file('corrupt.jpg'));
  assert.equal(corrupt.issue.code, 'INVALID_IMAGE');
  assert.match(corrupt.issue.message, /corrupt or unsupported/i);
});

test('reports an actionable error when the browser cannot create a preview URL', async () => {
  const { api } = uploaderModule(() => 'load', () => {
    throw new Error('browser URL allocation failed');
  });
  const result = await api.previewFacePhoto(file('unavailable.jpg'));
  assert.equal(result.issue.code, 'PREVIEW_UNAVAILABLE');
  assert.match(result.issue.message, /Choose another JPEG or PNG/);
});

test('handles image decode rejection and undersized images as validation failures', async () => {
  const decodeModule = uploaderModule(() => 'decode-error');
  assert.equal(
    (await decodeModule.api.previewFacePhoto(file('decode-failure.jpg'))).issue.code,
    'INVALID_IMAGE',
  );
  const smallModule = uploaderModule(url => url.includes('small') ? 'small' : 'load');
  const small = await smallModule.api.previewFacePhoto(file('small.jpg'));
  assert.equal(small.issue.code, 'IMAGE_TOO_SMALL');
});

test('a successful image load settles even if the optional decode promise hangs', async () => {
  const { api } = uploaderModule(() => 'never-decode');
  const result = await api.previewFacePhoto(file('loaded.png', 'image/png'), undefined, 500);
  assert.equal(result.issue, null);
  assert.equal(result.url, 'blob:loaded.png');
});

test('preview timeout settles, revokes its failed URL, and does not block another file', async () => {
  const { api, revoked } = uploaderModule(url => url.includes('hang') ? 'never' : 'load');
  const [hung, valid] = await Promise.all([
    api.previewFacePhoto(file('hang.jpg'), undefined, 10),
    api.previewFacePhoto(file('valid.jpg')),
  ]);
  assert.equal(hung.issue.code, 'PREVIEW_TIMEOUT');
  assert.equal(hung.url, null);
  assert.equal(valid.issue, null);
  assert.deepEqual(revoked, ['blob:hang.jpg']);
});

test('cancelled obsolete previews settle and release only their own Blob URL', async () => {
  const { api, images, revoked } = uploaderModule(url => url.includes('slow') ? 'never' : 'load');
  const controller = new AbortController();
  const obsolete = api.previewFacePhoto(file('slow.jpg'), controller.signal, 1000);
  const obsoleteImage = images[0];
  controller.abort();
  const cancelled = await obsolete;
  assert.equal(cancelled.cancelled, true);
  assert.deepEqual(revoked, ['blob:slow.jpg']);
  obsoleteImage.onload?.();

  const current = await api.previewFacePhoto(file('current.png', 'image/png'));
  assert.equal(current.url, 'blob:current.png');
  assert.deepEqual(revoked, ['blob:slow.jpg']);
});

test('image load errors and timeout tests keep failed resources isolated by file URL', async () => {
  const { api, revoked } = uploaderModule(url => url.includes('bad') ? 'error' : 'load');
  const [bad, good] = await Promise.all([
    api.previewFacePhoto(file('bad.jpg')),
    api.previewFacePhoto(file('good.jpg')),
  ]);
  assert.equal(bad.issue.code, 'INVALID_IMAGE');
  assert.equal(good.url, 'blob:good.jpg');
  assert.deepEqual(revoked, ['blob:bad.jpg']);
});
