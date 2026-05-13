import { Linking, Platform } from 'react-native';
import * as IntentLauncher from 'expo-intent-launcher';
import * as FileSystem from 'expo-file-system';
import Constants from 'expo-constants';

type AllFilesAccessStatus = 'granted' | 'blocked' | 'denied' | 'opened-settings' | 'unavailable';

function getAndroidPackageName() {
  return Constants.expoConfig?.android?.package ?? Constants.manifest?.android?.package;
}

/**
 * Checks whether the app truly has MANAGE_EXTERNAL_STORAGE access by attempting
 * to list the root of external storage. This is the ground-truth check:
 *
 * react-native-permissions's check() is unreliable for MANAGE_EXTERNAL_STORAGE
 * because it's a special permission, NOT a standard runtime permission — Android
 * doesn't reflect its grant state through the normal permission result API.
 *
 * By actually reading /storage/emulated/0 we get a definitive answer that
 * correctly updates the moment the user toggles the switch in Settings.
 */
export async function checkAllFilesAccess(): Promise<AllFilesAccessStatus> {
  if (Platform.OS !== 'android') {
    return 'unavailable';
  }

  // Devices below API 30 don't have MANAGE_EXTERNAL_STORAGE —
  // READ_EXTERNAL_STORAGE (auto-granted at install) is sufficient there.
  if (Platform.Version < 30) {
    return 'granted';
  }

  try {
    const result = await (FileSystem as any).readDirectoryAsync('/storage/emulated/0');
    if (Array.isArray(result)) {
      return 'granted';
    }
    return 'denied';
  } catch {
    return 'denied';
  }
}

export async function openAllFilesAccessSettings(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return false;
  }

  const packageName = getAndroidPackageName();

  // Try app-specific All Files Access screen first (cleaner UX)
  if (packageName) {
    try {
      await IntentLauncher.startActivityAsync(
        'android.settings.MANAGE_APP_ALL_FILES_ACCESS_PERMISSION',
        { data: `package:${packageName}` }
      );
      return true;
    } catch {
      // Some OEMs don't support this intent — fall through
    }
  }

  // Fall back to the global All Files Access list
  try {
    await IntentLauncher.startActivityAsync(
      'android.settings.MANAGE_ALL_FILES_ACCESS_PERMISSION',
      {}
    );
    return true;
  } catch {
    // Last resort: Linking
  }

  const url = 'android.settings.MANAGE_ALL_FILES_ACCESS_PERMISSION';
  try {
    if (await Linking.canOpenURL(url)) {
      await Linking.openURL(url);
      return true;
    }
  } catch {
    // ignore
  }

  return false;
}

export async function ensureAllFilesAccess(): Promise<AllFilesAccessStatus> {
  const status = await checkAllFilesAccess();
  if (status === 'granted' || status === 'unavailable') {
    return status;
  }

  const opened = await openAllFilesAccessSettings();
  return opened ? 'opened-settings' : 'unavailable';
}
