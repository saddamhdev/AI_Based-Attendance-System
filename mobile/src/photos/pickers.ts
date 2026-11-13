import * as ImagePicker from 'expo-image-picker';
import { Alert, Linking } from 'react-native';

import type { PickedAsset } from './prepare';
import type { PhotoProfile } from './rules';

export class PermissionDeniedError extends Error {
  constructor(readonly canAskAgain: boolean) {
    super('Camera access is turned off for Attend.');
  }
}

/** Asks for camera access only when the user taps "Take photo". */
export async function takePhoto(profile: PhotoProfile): Promise<PickedAsset[]> {
  const current = await ImagePicker.getCameraPermissionsAsync();
  const permission = current.granted ? current : await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) throw new PermissionDeniedError(permission.canAskAgain);
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: 'images',
    quality: 1, // Compression happens once, later, in a controlled step.
    exif: false,
    allowsEditing: false,
    cameraType: profile === 'enrollment' ? ImagePicker.CameraType.front : ImagePicker.CameraType.back,
  });
  return result.canceled ? [] : result.assets.map(toPicked);
}

/**
 * Opens the system photo picker. On Android 13+ and iOS 14+ this needs no media-library
 * permission; only the photos the user picks are shared with the app.
 */
export async function chooseFromGallery(remaining: number): Promise<PickedAsset[]> {
  if (remaining <= 0) return [];
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: 'images',
    allowsMultipleSelection: remaining > 1,
    selectionLimit: remaining,
    orderedSelection: true,
    quality: 1,
    exif: false,
    // iOS: deliver HEIC selections in a compatible format; they are re-encoded as JPEG anyway.
    preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    shouldDownloadFromNetwork: true,
  });
  return result.canceled ? [] : result.assets.slice(0, remaining).map(toPicked);
}

/** Android may destroy the activity while the camera is open; recover that result on return. */
export async function recoverPendingPick(): Promise<PickedAsset[]> {
  try {
    const pending = await ImagePicker.getPendingResultAsync();
    if (pending && 'assets' in pending && !pending.canceled && pending.assets) return pending.assets.map(toPicked);
  } catch {
    // Nothing to recover.
  }
  return [];
}

function toPicked(asset: ImagePicker.ImagePickerAsset): PickedAsset {
  return { uri: asset.uri, width: asset.width, height: asset.height, type: asset.type, mimeType: asset.mimeType };
}

/** Explains a denied camera permission and offers the available alternatives. */
export function explainCameraDenied(error: PermissionDeniedError, onUseGallery?: () => void) {
  Alert.alert(
    'Camera access is off',
    error.canAskAgain
      ? 'Attend needs the camera to take photos. You can allow it next time, or choose existing photos instead.'
      : 'Camera access was denied. Turn it on in Settings, or choose existing photos from your gallery instead.',
    [
      ...(onUseGallery ? [{ text: 'Choose from gallery', onPress: onUseGallery }] : []),
      ...(!error.canAskAgain ? [{ text: 'Open Settings', onPress: () => void Linking.openSettings() }] : []),
      { text: 'Close', style: 'cancel' as const },
    ],
  );
}
