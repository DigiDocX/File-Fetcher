import * as FileSystem from 'expo-file-system';
import { Platform } from 'react-native';

export type ScannedPdf = {
  /** Absolute file URI (file:// or content://) */
  uri: string;
  /** Display filename, e.g. "invoice.pdf" */
  name: string;
  /** Human-readable relative path from storage root, e.g. "Downloads/invoice.pdf" */
  relativePath: string;
  /** File size in bytes (may be undefined if unavailable) */
  size?: number;
};

export type ScanProgressCallback = (
  scanned: number,
  currentPath: string
) => void;

/**
 * Directories to skip during scan — these are typically inaccessible
 * system directories that would cause permission errors or waste time.
 */
const SKIP_DIRS = new Set([
  'proc',
  'sys',
  'dev',
  'acct',
  'd',
  'cache',
  'data',
  'system',
  'vendor',
  'product',
  'odm',
  'oem',
  'apex',
  'config',
  'metadata',
  'mnt',
  'sbin',
  'bin',
  'etc',
]);

const ANDROID_STORAGE_ROOT = '/storage/emulated/0';

/**
 * Recursively collects all PDF files under `dirUri`.
 * Calls `onProgress` for every directory entered.
 */
async function collectPdfsRecursive(
  dirUri: string,
  storageRoot: string,
  onProgress: ScanProgressCallback,
  results: ScannedPdf[],
  depth: number
): Promise<void> {
  // Limit recursion depth to avoid infinite loops or very deep trees
  if (depth > 12) {
    return;
  }



  try {
    const dirName = dirUri.replace(/\/$/, '').split('/').pop() ?? '';
    if (SKIP_DIRS.has(dirName.toLowerCase())) {
      return;
    }

    const rawEntries = await (FileSystem as any).readDirectoryAsync(dirUri);
    if (!Array.isArray(rawEntries)) {
      return;
    }




    for (const entry of rawEntries as string[]) {
      const entryUri = `${dirUri.replace(/\/$/, '')}/${entry}`;

      let info: any;
      try {
        info = await FileSystem.getInfoAsync(entryUri);
      } catch {
        continue;
      }

      if (!info.exists) {
        continue;
      }

      if (info.isDirectory) {
        onProgress(results.length, entryUri);
        await collectPdfsRecursive(
          entryUri,
          storageRoot,
          onProgress,
          results,
          depth + 1
        );
      } else if (entry.toLowerCase().endsWith('.pdf')) {
        const relativePath = entryUri.startsWith(storageRoot)
          ? entryUri.slice(storageRoot.length).replace(/^\//, '')
          : entry;

        results.push({
          uri: `file://${entryUri}`,
          name: entry,
          relativePath,
          size: (info as any).size,
        });
      }
    }
  } catch {
    // Silently skip directories we can't read (permission denied, etc.)
  }
}

/**
 * Scans the phone's primary external storage for all PDF files.
 *
 * - Android: walks /storage/emulated/0 recursively.
 * - iOS: returns an empty array (sandboxed FS, bulk scan not possible).
 *
 * @param onProgress Called each time a new directory is entered.
 * @returns Array of found PDF descriptors.
 */
export async function scanStorageForPdfs(
  onProgress: ScanProgressCallback = () => {}
): Promise<ScannedPdf[]> {
  if (Platform.OS !== 'android') {
    return [];
  }

  const results: ScannedPdf[] = [];
  onProgress(0, ANDROID_STORAGE_ROOT);

  await collectPdfsRecursive(
    ANDROID_STORAGE_ROOT,
    ANDROID_STORAGE_ROOT,
    onProgress,
    results,
    0
  );

  return results;
}
