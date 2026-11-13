import { randomUUID } from 'expo-crypto';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';

import { onPrivateStateReset } from '../auth/AuthProvider';
import { deleteTempFile } from '../auth/privateFiles';
import { chooseFromGallery, explainCameraDenied, PermissionDeniedError, recoverPendingPick, takePhoto } from './pickers';
import { preparePhoto, type PickedAsset } from './prepare';
import { PROFILE, submitCheck, type PhotoIssue, type PhotoItem, type PhotoProfile } from './rules';

/**
 * Selected photos for one scope (a student's submission, or one session's analysis).
 * When `scopeKey` changes, or on logout, the selection and its private files are discarded,
 * so photos never leak between students, sessions, or accounts.
 */
export function usePhotoSet(profile: PhotoProfile, scopeKey: string) {
  const [items, setItems] = useState<PhotoItem[]>([]);
  const itemsRef = useRef<PhotoItem[]>([]);
  const scope = useRef(scopeKey);
  const generation = useRef(0);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const discardAll = useCallback(() => {
    generation.current += 1;
    itemsRef.current.forEach(item => deleteTempFile(item.uri));
    setItems([]);
  }, []);

  useEffect(() => {
    if (scope.current !== scopeKey) {
      scope.current = scopeKey;
      discardAll();
    }
  }, [scopeKey, discardAll]);

  useEffect(() => onPrivateStateReset(discardAll), [discardAll]);
  useEffect(() => () => {
    generation.current += 1;
    itemsRef.current.forEach(item => deleteTempFile(item.uri));
  }, []);

  const prepare = useCallback(async (clientId: string, asset: PickedAsset) => {
    const startedIn = generation.current;
    const result = await preparePhoto(asset, profile, clientId);
    if (startedIn !== generation.current) {
      if (result.ok) deleteTempFile(result.uri); // Scope changed while preparing.
      return;
    }
    setItems(current => {
      if (!current.some(item => item.clientId === clientId)) {
        if (result.ok) deleteTempFile(result.uri); // Removed while preparing.
        return current;
      }
      return current.map(item => item.clientId !== clientId ? item : result.ok
        ? { ...item, status: 'ready', uri: result.uri, width: result.width, height: result.height, bytes: result.bytes, issue: undefined }
        : { ...item, status: 'invalid', uri: undefined, issue: result.issue });
    });
  }, [profile]);

  const addAssets = useCallback((assets: PickedAsset[], source: PhotoItem['source'], replaceId?: string) => {
    if (!assets.length) return;
    const created = assets.map(asset => ({ asset, item: { clientId: randomUUID(), source, status: 'preparing' as const } }));
    setItems(current => {
      if (replaceId) {
        const index = current.findIndex(item => item.clientId === replaceId);
        if (index >= 0) {
          deleteTempFile(current[index].uri);
          const next = current.slice();
          next.splice(index, 1, created[0].item);
          return next;
        }
      }
      return [...current, ...created.map(entry => entry.item)];
    });
    created.forEach(entry => void prepare(entry.item.clientId, entry.asset));
  }, [prepare]);

  const remaining = PROFILE[profile].max - items.length;

  const fromGallery = useCallback(async (replaceId?: string) => {
    try {
      const assets = await chooseFromGallery(replaceId ? 1 : PROFILE[profile].max - itemsRef.current.length);
      addAssets(assets, 'gallery', replaceId);
    } catch {
      Alert.alert('Photos unavailable', 'The photo library could not be opened. Try again or use the camera.');
    }
  }, [addAssets, profile]);

  const fromCamera = useCallback(async (replaceId?: string) => {
    if (!replaceId && PROFILE[profile].max - itemsRef.current.length <= 0) return;
    try {
      addAssets(await takePhoto(profile), 'camera', replaceId);
    } catch (error) {
      if (error instanceof PermissionDeniedError) explainCameraDenied(error, () => void fromGallery(replaceId));
      else Alert.alert('Camera unavailable', 'The camera could not be opened. Choose photos from the gallery instead.');
    }
  }, [addAssets, fromGallery, profile]);

  useEffect(() => {
    void recoverPendingPick().then(assets => addAssets(assets, 'camera'));
  }, [addAssets]);

  const remove = useCallback((clientId: string) => {
    setItems(current => {
      const target = current.find(item => item.clientId === clientId);
      deleteTempFile(target?.uri);
      return current.filter(item => item.clientId !== clientId);
    });
  }, []);

  /** Marks specific photos as needing attention (server validation) while keeping all others. */
  const flag = useCallback((issues: Record<string, PhotoIssue>) => {
    setItems(current => current.map(item => issues[item.clientId]
      ? { ...item, status: 'invalid', issue: issues[item.clientId] }
      : item));
  }, []);

  const ready = items.filter(item => item.status === 'ready');

  return {
    items,
    ready,
    remaining,
    fromCamera,
    fromGallery,
    remove,
    replaceWithCamera: (clientId: string) => fromCamera(clientId),
    replaceFromGallery: (clientId: string) => fromGallery(clientId),
    flag,
    clear: discardAll,
    check: (extra?: { consent?: boolean; busy?: boolean }) => submitCheck(items, profile, extra),
  };
}

export type PhotoSet = ReturnType<typeof usePhotoSet>;
