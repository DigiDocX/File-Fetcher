import { Linking, Platform } from 'react-native';
import * as IntentLauncher from 'expo-intent-launcher';
import Constants from 'expo-constants';
import { check, PERMISSIONS, RESULTS } from 'react-native-permissions';

type AllFilesAccessStatus = 'granted' | 'blocked' | 'denied' | 'opened-settings' | 'unavailable';

function getAndroidPackageName() {
  return Constants.expoConfig?.android?.package ?? Constants.manifest?.android?.package;
}

export async function checkAllFilesAccess(): Promise<AllFilesAccessStatus> {
  if (Platform.OS !== 'android') {
    return 'unavailable';
  }

  if (Platform.Version < 30) {
    return 'unavailable';
  }

  const status = await check(PERMISSIONS.ANDROID.MANAGE_EXTERNAL_STORAGE);
  if (status === RESULTS.GRANTED) {
    return 'granted';
  }

  if (status === RESULTS.BLOCKED) {
    return 'blocked';
  }

  return 'denied';
}

export async function openAllFilesAccessSettings(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return false;
  }

  const packageName = getAndroidPackageName();
  if (packageName) {
    await IntentLauncher.startActivityAsync(
      'android.settings.MANAGE_APP_ALL_FILES_ACCESS_PERMISSION',
      { data: `package:${packageName}` }
    );
    return true;
  }

  const url = 'android.settings.MANAGE_ALL_FILES_ACCESS_PERMISSION';
  if (await Linking.canOpenURL(url)) {
    await Linking.openURL(url);
    return true;
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
