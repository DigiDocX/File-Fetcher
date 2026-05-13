import {
  buildFilenameFromEntities,
  compromiseExtractEntities,
  pickTopEntityCandidates,
  scoreExtractedEntities,
} from '@/constants/entity-extraction';
import { buildPdfOcrInput } from '@/lib/pdf-ocr-input';
import { runMlKitOcrOnCroppedImage } from '@/lib/pdf-ocr';
import {
  initRenameDb,
  insertPdfIfAbsent,
  markError,
  markProcessing,
  updateSuggestedName,
  getPendingUris,
} from '@/lib/rename-db';
import { scanStorageForPdfs, type ScannedPdf } from '@/lib/pdf-scanner';

const CROP_PERCENT = 0.25;

// ─── Types ────────────────────────────────────────────────────────────────────

export type BulkOcrMode = 'skip-done' | 'reprocess-all';

export type BulkOcrProgress = {
  /** Phase of the pipeline */
  phase: 'scanning' | 'ocr' | 'done';
  /** How many PDFs found so far (during scan) or total (during OCR) */
  total: number;
  /** How many have been processed (OCR phase only) */
  processed: number;
  /** Name/path currently being worked on */
  currentLabel: string;
};

export type BulkOcrResult = {
  totalFound: number;
  totalProcessed: number;
  totalSkipped: number;
  totalErrors: number;
};

export type BulkOcrProgressCallback = (progress: BulkOcrProgress) => void;

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function runOcrAndSuggestName(
  pdf: ScannedPdf
): Promise<{ suggestedName: string; ocrText: string }> {
  const input = await buildPdfOcrInput(pdf.uri, pdf.name, {
    cropPercent: CROP_PERCENT,
  });

  const result = await runMlKitOcrOnCroppedImage(input.croppedImage, {
    includeLines: false,
    includeBlocks: false,
    includeElements: false,
  });

  const normalizedText = result.normalizedText ?? '';

  const entityInputs = [{ source: 'ocr' as const, text: normalizedText }];
  const extracted = compromiseExtractEntities(entityInputs);
  const scored = scoreExtractedEntities(entityInputs, extracted);
  const top = pickTopEntityCandidates(scored, 3);

  const suggestedName = buildFilenameFromEntities(top, 60) + '.pdf';

  return { suggestedName, ocrText: normalizedText };
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Runs the full bulk OCR pipeline:
 * 1. Initialises the SQLite database.
 * 2. Scans phone storage for PDFs.
 * 3. Inserts newly found PDFs into the DB.
 * 4. Runs OCR on pending PDFs, persists results.
 *
 * @param mode  'skip-done'      — skips PDFs already processed (default)
 *              'reprocess-all'  — resets all records and re-runs everything
 * @param onProgress  Called on every meaningful state change.
 * @param signal  Optional AbortSignal to cancel mid-run.
 */
export async function runBulkOcr(
  mode: BulkOcrMode = 'skip-done',
  onProgress: BulkOcrProgressCallback = () => {},
  signal?: AbortSignal
): Promise<BulkOcrResult> {
  // ── 1. Init DB ──────────────────────────────────────────────────────────
  initRenameDb();

  if (mode === 'reprocess-all') {
    const { resetAllToPending } = await import('@/lib/rename-db');
    resetAllToPending();
  }

  // ── 2. Scan storage ─────────────────────────────────────────────────────
  let foundCount = 0;

  const pdfs = await scanStorageForPdfs((scanned, currentPath) => {
    foundCount = scanned;
    onProgress({
      phase: 'scanning',
      total: scanned,
      processed: 0,
      currentLabel: currentPath.split('/').slice(-2).join('/'),
    });
  });

  if (signal?.aborted) {
    return { totalFound: pdfs.length, totalProcessed: 0, totalSkipped: 0, totalErrors: 0 };
  }

  // ── 3. Upsert all discovered PDFs into DB ───────────────────────────────
  for (const pdf of pdfs) {
    insertPdfIfAbsent(pdf.uri, pdf.name, pdf.relativePath, pdf.size);
  }

  // ── 4. Determine which URIs still need processing ───────────────────────
  const pendingUris = new Set(getPendingUris());
  const pendingPdfs = pdfs.filter((p) => pendingUris.has(p.uri));
  const skipped = pdfs.length - pendingPdfs.length;

  const total = pendingPdfs.length;
  let processed = 0;
  let errors = 0;

  // ── 5. OCR loop ─────────────────────────────────────────────────────────
  for (const pdf of pendingPdfs) {
    if (signal?.aborted) {
      break;
    }

    onProgress({
      phase: 'ocr',
      total,
      processed,
      currentLabel: pdf.name,
    });

    markProcessing(pdf.uri);

    try {
      const { suggestedName, ocrText } = await runOcrAndSuggestName(pdf);
      updateSuggestedName(pdf.uri, suggestedName, ocrText);
      processed += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'OCR failed';
      markError(pdf.uri, msg);
      errors += 1;
    }
  }

  onProgress({
    phase: 'done',
    total,
    processed,
    currentLabel: '',
  });

  return {
    totalFound: pdfs.length,
    totalProcessed: processed,
    totalSkipped: skipped,
    totalErrors: errors,
  };
}
