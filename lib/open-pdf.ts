import * as Sharing from 'expo-sharing';
import * as IntentLauncher from 'expo-intent-launcher';
import { Platform, Alert } from 'react-native';

/**
 * Opens a PDF file by its URI.
 *
 * Strategy:
 * - Android: tries expo-intent-launcher first (opens in a native PDF viewer);
 *   falls back to expo-sharing if intent fails.
 * - iOS / other: uses expo-sharing.
 *
 * @param uri  file:// or content:// URI of the PDF.
 * @param name Display name shown in share sheet.
 */
export async function openPdf(uri: string, name: string): Promise<void> {
  try {
    if (Platform.OS === 'android') {
      // Resolve content:// URIs directly; file:// URIs need to go through intent
      const contentUri = uri.startsWith('content://') ? uri : uri;
      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
        data: contentUri,
        type: 'application/pdf',
        flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
      });
      return;
    }
  } catch {
    // Intent failed — fall through to sharing
  }

  try {
    const isAvailable = await Sharing.isAvailableAsync();
    if (isAvailable) {
      await Sharing.shareAsync(uri, {
        mimeType: 'application/pdf',
        dialogTitle: `Open ${name}`,
        UTI: 'com.adobe.pdf',
      });
    } else {
      Alert.alert('Cannot open PDF', 'No PDF viewer is available on this device.');
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    Alert.alert('Failed to open PDF', msg);
  }
}
