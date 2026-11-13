import { Directory, File, Paths } from 'expo-file-system';

/**
 * All biometric/temporary files the app writes live under the app-private cache directory
 * (never the shared photo library or public storage). Logout and app start remove them.
 */
const ROOT = 'attend-private';

export function privateDir(kind: 'photos' | 'reports'): Directory {
  const dir = new Directory(Paths.cache, ROOT, kind);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

export function isInsideCache(uri: string): boolean {
  return uri.startsWith(Paths.cache.uri);
}

/** Deletes a temporary file if it is inside the app cache. Never throws. */
export function deleteTempFile(uri: string | null | undefined) {
  if (!uri || !uri.startsWith('file:') || !isInsideCache(uri)) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Best effort; the whole private directory is also cleared on logout.
  }
}

/** Removes every private temporary file, including picker and manipulator cache copies. */
export function clearPrivateFiles() {
  for (const name of [ROOT, 'ImagePicker', 'ImageManipulator']) {
    try {
      const dir = new Directory(Paths.cache, name);
      if (dir.exists) dir.delete();
    } catch {
      // Best effort.
    }
  }
}
