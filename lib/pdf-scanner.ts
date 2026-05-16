/**
 * PDF Scanner — walks Android external storage recursively to find all PDFs.
 *
 * Uses the NEW expo-file-system v19 `Directory` class API for listing
 * directory contents. The legacy `readDirectoryAsync` is broken on
 * Android 15 (API 36) — it silently returns ONLY subdirectory names
 * and ignores all files, making it useless for file discovery.
 *
 * The new `Directory.list()` correctly returns both files and directories.
 * We still use `getInfoAsync` from the legacy API for getting file sizes
 * (stat-ing individual files still works fine).
 */
import { Directory } from 'expo-file-system';
import { getInfoAsync, type FileInfo } from 'expo-file-system/legacy';
import { Platform } from 'react-native';

export type ScannedPdf = {
  /** Absolute file URI (file://) */
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
 * Directories to skip during scan.
 *
 * CRITICAL: `Android` MUST be in this list.
 * Even with MANAGE_EXTERNAL_STORAGE, Android 11+ protects /Android/data
 * and /Android/obb for other apps' security. Attempting to read them
 * throws Permission Denied and dramatically slows the scan.
 */
const SKIP_DIRS = new Set([
  // ── Android protected ──
  'Android',
  // ── System / root-level ──
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
  // ── Common hidden/noise directories ──
  'lost+found',
]);

/** Raw filesystem path for the root of internal storage */
const ANDROID_STORAGE_ROOT = '/storage/emulated/0';
/** Same as a file:// URI */
const ANDROID_STORAGE_ROOT_URI = `file://${ANDROID_STORAGE_ROOT}`;

/** Maximum recursion depth to prevent infinite loops or extreme trees */
const MAX_DEPTH = 15;

/**
 * Extracts a human-readable relative path from a full path or URI.
 */
function toRelativePath(fullPath: string): string {
  // Strip file:// prefix if present
  const rawPath = fullPath.startsWith('file://') ? fullPath.slice(7) : fullPath;
  if (rawPath.startsWith(ANDROID_STORAGE_ROOT + '/')) {
    return rawPath.slice(ANDROID_STORAGE_ROOT.length + 1);
  }
  return rawPath.split('/').slice(-2).join('/');
}

/**
 * Lists directory contents using the new expo-file-system v19 Directory API.
 * Returns an array of entry names (both files and directories).
 * Returns null if the directory cannot be read.
 */
function listDirectory(dirUri: string): string[] | null {
  try {
    const dir = new Directory(dirUri);
    if (!dir.exists) {
      console.log(`[pdf-scanner] listDirectory: Directory does not exist according to Directory API: ${dirUri}`);
      return null;
    }
    // Directory.list() returns an array of File/Directory objects in v19.
    const items = dir.list() as any[];
    if (items.length > 0 && dirUri === 'file:///storage/emulated/0') {
      console.log(`[pdf-scanner] listDirectory SAMPLE ITEM:`, Object.keys(items[0]), items[0].uri, items[0].name);
    }
    return items.map(item => {
      if (typeof item === 'string') return decodeURIComponent(item);
      const uri = item.uri || '';
      return decodeURIComponent(uri.replace(/\/$/, '').split('/').pop() || '');
    });
  } catch (error) {
    console.log(`[pdf-scanner] listDirectory: Error reading directory ${dirUri}:`, error);
    return null;
  }
}

/**
 * Checks if an entry is a directory by trying to use getInfoAsync first,
 * which is more reliable for identifying directories than Directory.exists.
 * Fallbacks to Directory.exists if getInfoAsync fails.
 */
async function isDirectoryAsync(uri: string): Promise<boolean> {
  try {
    const info = await getInfoAsync(uri);
    if (info.exists) {
      return info.isDirectory;
    }
  } catch {
    // ignore
  }

  try {
    const dir = new Directory(uri);
    return dir.exists;
  } catch {
    return false;
  }
}

/**
 * Recursively collects all PDF files under `dirUri`.
 * Uses the new Directory class API for listing (works on Android 15+).
 */
async function collectPdfsRecursive(
  dirUri: string,
  onProgress: ScanProgressCallback,
  results: ScannedPdf[],
  depth: number
): Promise<void> {
  if (depth > MAX_DEPTH) {
    return;
  }

  // Extract directory name from the URI for skip checks
  const dirName = dirUri.replace(/\/$/, '').split('/').pop() ?? '';
  if (SKIP_DIRS.has(dirName) || dirName.startsWith('.')) {
    return;
  }

  // Use the new Directory API to list contents
  const entries = listDirectory(dirUri);
  if (entries === null) {
    console.log(`[pdf-scanner] FAILED to read ${dirName}/ (depth=${depth})`);
    return;
  }

  console.log(`[pdf-scanner] ${dirName}/ → ${entries.length} entries (depth=${depth})`);

  // Separate PDFs from other entries for efficient processing
  const pdfEntries: string[] = [];
  const otherEntries: string[] = [];

  for (const entryName of entries) {
    // Skip hidden files/folders
    if (entryName.startsWith('.')) {
      continue;
    }
    // Skip known system directories
    if (SKIP_DIRS.has(entryName)) {
      continue;
    }

    if (entryName.toLowerCase().endsWith('.pdf')) {
      pdfEntries.push(entryName);
    } else {
      otherEntries.push(entryName);
    }
  }

  if (pdfEntries.length > 0) {
    console.log(`[pdf-scanner] Found ${pdfEntries.length} PDFs in ${dirName}/`);
  }

  // Process PDFs — get file info for size
  for (const pdfName of pdfEntries) {
    const pdfUri = `${dirUri.replace(/\/$/, '')}/${pdfName}`;

    let info: FileInfo;
    try {
      info = await getInfoAsync(pdfUri);
    } catch (err) {
      console.log(`[pdf-scanner] FAILED getInfoAsync for ${pdfName}: ${err instanceof Error ? err.message : err}`);
      // Still add the PDF even without size info
      results.push({
        uri: pdfUri,
        name: pdfName,
        relativePath: toRelativePath(pdfUri),
        size: undefined,
      });
      onProgress(results.length, pdfUri);
      continue;
    }

    if (info.exists && !info.isDirectory) {
      results.push({
        uri: pdfUri,
        name: pdfName,
        relativePath: toRelativePath(pdfUri),
        size: info.size,
      });
      onProgress(results.length, pdfUri);
    }
  }

  // Recurse into subdirectories
  for (const entryName of otherEntries) {
    const entryUri = `${dirUri.replace(/\/$/, '')}/${entryName}`;

    // Check if it's a directory before recursing
    if (await isDirectoryAsync(entryUri)) {
      onProgress(results.length, entryUri);
      await collectPdfsRecursive(entryUri, onProgress, results, depth + 1);
    } else {
      // Diagnostic logging if it skips a known important folder
      if (entryName === 'Documents' || entryName === 'Download') {
        console.log(`[pdf-scanner] WARNING: ${entryName} was not recognized as a directory or could not be accessed: ${entryUri}`);
      }
    }
    // If it's a file (not PDF, not directory), we just skip it
  }
}

/**
 * Scans the phone's primary external storage for all PDF files.
 *
 * - Android: walks /storage/emulated/0 recursively, skipping
 *   the /Android folder and other protected/system directories.
 * - iOS: returns an empty array (sandboxed FS, bulk scan not possible).
 *
 * @param onProgress Called each time a new PDF is found or directory entered.
 * @returns Array of found PDF descriptors.
 */
export async function scanStorageForPdfs(
  onProgress: ScanProgressCallback = () => {}
): Promise<ScannedPdf[]> {
  if (Platform.OS !== 'android') {
    return [];
  }

  const results: ScannedPdf[] = [];
  onProgress(0, ANDROID_STORAGE_ROOT_URI);

  console.log(`[pdf-scanner] Starting scan at: ${ANDROID_STORAGE_ROOT_URI}`);
  console.log(`[pdf-scanner] Using new Directory API (expo-file-system v19)`);

  // Quick diagnostic: verify the new API works on the root
  const rootEntries = listDirectory(ANDROID_STORAGE_ROOT_URI);
  if (rootEntries) {
    const fileCount = rootEntries.filter(e => e.includes('.')).length;
    console.log(`[pdf-scanner] Root listing: ${rootEntries.length} entries (${fileCount} likely files)`);
  } else {
    console.log(`[pdf-scanner] ERROR: Cannot list root directory!`);
  }

  await collectPdfsRecursive(
    ANDROID_STORAGE_ROOT_URI,
    onProgress,
    results,
    0
  );

  console.log(`[pdf-scanner] Scan complete: found ${results.length} PDFs`);
  return results;
}
