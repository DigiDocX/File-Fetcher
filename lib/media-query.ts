/**
 * lib/media-query.ts
 *
 * PDF discovery via the native AceScannerModule bridge.
 * Queries Android MediaStore.Files directly for MIME_TYPE = application/pdf.
 *
 * PERMISSION NOTE:
 *   On Android 11+ (API 30+), MediaStore.Files queries for non-media types
 *   (documents, PDFs) require MANAGE_EXTERNAL_STORAGE special-access permission.
 *   This is NOT a standard runtime permission — PermissionsAndroid.check() always
 *   returns DENIED for it. The only correct check is Environment.isExternalStorageManager(),
 *   exposed here via AceScannerModule.isExternalStorageManager().
 */

import { Alert, NativeModules, Platform } from 'react-native';
import * as IntentLauncher from 'expo-intent-launcher';
import Constants from 'expo-constants';

const { AceScannerModule } = NativeModules;

// ─── Types ────────────────────────────────────────────────────────────────────

export type DiscoveredPdf = {
  /** MediaStore row ID (string) */
  id: string;
  /** file:// URI  e.g. file:///storage/emulated/0/Downloads/invoice.pdf */
  uri: string;
  /** Absolute path without file:// prefix */
  path: string;
  /** Original display filename */
  name: string;
  /** MIME type reported by MediaStore */
  mimeType?: string;
};

// ─── Permission helpers ───────────────────────────────────────────────────────

function getPackageName(): string | undefined {
  return (
    Constants.expoConfig?.android?.package ??
    (Constants.manifest as any)?.android?.package
  );
}

/**
 * Opens the app-specific "All Files Access" settings page so the user can
 * toggle MANAGE_EXTERNAL_STORAGE without navigating manually.
 */
async function openAllFilesAccessSettings(): Promise<void> {
  const pkg = getPackageName();
  if (pkg) {
    try {
      await IntentLauncher.startActivityAsync(
        'android.settings.MANAGE_APP_ALL_FILES_ACCESS_PERMISSION',
        { data: `package:${pkg}` }
      );
      return;
    } catch {
      // Some OEMs (OPPO/Xiaomi) don't support app-specific intent — fall through
    }
  }
  try {
    await IntentLauncher.startActivityAsync(
      'android.settings.MANAGE_ALL_FILES_ACCESS_PERMISSION',
      {}
    );
  } catch {
    // Last resort
    await IntentLauncher.startActivityAsync('android.settings.SETTINGS', {});
  }
}

/**
 * Returns true if MANAGE_EXTERNAL_STORAGE is granted (via native check).
 * On Android < 11 always returns true (READ_EXTERNAL_STORAGE suffices).
 */
async function checkStorageManagerPermission(): Promise<boolean> {
  if (!AceScannerModule?.isExternalStorageManager) return false;
  try {
    return await AceScannerModule.isExternalStorageManager();
  } catch {
    return false;
  }
}

/**
 * Shows a blocking alert directing the user to grant All Files Access,
 * then opens the settings page. Returns false so the caller can bail out.
 */
async function promptForStorageAccess(): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      'All Files Access Required',
      'F-Rename needs "All Files Access" (MANAGE_EXTERNAL_STORAGE) to discover PDFs on your device.\n\nTap Open Settings → enable the toggle → come back and scan again.',
      [
        {
          text: 'Cancel',
          style: 'cancel',
          onPress: () => resolve(false),
        },
        {
          text: 'Open Settings',
          onPress: async () => {
            await openAllFilesAccessSettings();
            resolve(false); // user must return and re-tap scan
          },
        },
      ],
      { cancelable: false }
    );
  });
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Calls the native AceScannerModule to query MediaStore.Files for all PDFs.
 * Returns a flat array ready for immediate UI rendering.
 */
export async function discoverPDFs(): Promise<DiscoveredPdf[]> {
  if (Platform.OS !== 'android') return [];

  // Guard: native module must be present (requires full native rebuild)
  if (!AceScannerModule) {
    Alert.alert(
      'Native Module Missing',
      'AceScannerModule is not linked. Run: npx expo run:android'
    );
    return [];
  }

  // Guard: MANAGE_EXTERNAL_STORAGE must be granted for MediaStore.Files PDF queries
  const hasAccess = await checkStorageManagerPermission();
  if (!hasAccess) {
    await promptForStorageAccess();
    return [];
  }

  try {
    const raw: Array<{ id: string; uri: string; filename: string; mimeType?: string }> =
      await AceScannerModule.discoverPDFsInstantly();

    return raw.map((item) => ({
      id: item.id,
      uri: item.uri,
      path: item.uri.replace('file://', ''),
      name: item.filename,
      mimeType: item.mimeType,
    }));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[media-query] AceScannerModule error:', msg);
    Alert.alert('Scan Error', msg);
    return [];
  }
}
