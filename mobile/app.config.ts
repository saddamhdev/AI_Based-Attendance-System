import type { ExpoConfig } from 'expo/config';

/**
 * APP_ENV=development  -> allows plain-HTTP API URLs (LAN backend during development)
 * APP_ENV=production   -> requires an HTTPS API URL (enforced at runtime in src/config.ts)
 */
const appEnv = process.env.APP_ENV === 'production' ? 'production' : 'development';
const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';

const config: ExpoConfig = {
  name: 'Attend',
  slug: 'attend-mobile',
  scheme: 'attend',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.attendance.mobile',
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: 'com.attendance.mobile',
    adaptiveIcon: {
      backgroundColor: '#EEECFF',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    // Photos are captured without audio; no video features exist.
    blockedPermissions: ['android.permission.RECORD_AUDIO'],
    predictiveBackGestureEnabled: false,
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-sharing',
    '@react-native-community/datetimepicker',
    [
      'expo-image-picker',
      {
        photosPermission:
          'Attend lets you choose face or classroom photos to submit for attendance review.',
        cameraPermission:
          'Attend uses the camera to take face enrollment photos or classroom attendance photos.',
        microphonePermission: false,
      },
    ],
    [
      'expo-build-properties',
      {
        // Cleartext HTTP is only allowed in development builds so a LAN backend can be used.
        android: { usesCleartextTraffic: appEnv === 'development' },
      },
    ],
  ],
  extra: {
    appEnv,
    apiUrl,
  },
};

export default config;
