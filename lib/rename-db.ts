import * as SQLite from 'expo-sqlite';

// ─── Types ────────────────────────────────────────────────────────────────────

export type RenameStatus = 'pending' | 'processing' | 'done' | 'error';

export type PdfRenameRecord = {
  id: number;
  original_uri: string;
  original_name: string;
  suggested_name: string | null;
  ocr_text: string | null;
  relative_path: string;
  status: RenameStatus;
  error_message: string | null;
  file_size: number | null;
  created_at: number;
  updated_at: number;
};

// ─── Database singleton ───────────────────────────────────────────────────────

let _db: SQLite.SQLiteDatabase | null = null;

function getDb(): SQLite.SQLiteDatabase {
  if (!_db) {
    _db = SQLite.openDatabaseSync('f-rename.db');
  }
  return _db;
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS pdf_renames (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    original_uri   TEXT    NOT NULL UNIQUE,
    original_name  TEXT    NOT NULL,
    suggested_name TEXT,
    ocr_text       TEXT,
    relative_path  TEXT    NOT NULL DEFAULT '',
    status         TEXT    NOT NULL DEFAULT 'pending',
    error_message  TEXT,
    file_size      INTEGER,
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL
  );
`;

export function initRenameDb(): void {
  const db = getDb();
  db.execSync(CREATE_TABLE_SQL);
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Inserts a new record for a PDF. If a record with the same `original_uri`
 * already exists it is left untouched (SKIP strategy).
 */
export function insertPdfIfAbsent(
  originalUri: string,
  originalName: string,
  relativePath: string,
  fileSize?: number
): void {
  const db = getDb();
  const now = Date.now();
  db.runSync(
    `INSERT OR IGNORE INTO pdf_renames
       (original_uri, original_name, relative_path, file_size, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
    [originalUri, originalName, relativePath, fileSize ?? null, now, now]
  );
}

/**
 * Marks a record as "processing".
 */
export function markProcessing(originalUri: string): void {
  const db = getDb();
  db.runSync(
    `UPDATE pdf_renames SET status = 'processing', updated_at = ? WHERE original_uri = ?`,
    [Date.now(), originalUri]
  );
}

/**
 * Saves OCR result and suggested filename for a record.
 */
export function updateSuggestedName(
  originalUri: string,
  suggestedName: string,
  ocrText: string
): void {
  const db = getDb();
  db.runSync(
    `UPDATE pdf_renames
        SET suggested_name = ?, ocr_text = ?, status = 'done', error_message = NULL, updated_at = ?
      WHERE original_uri = ?`,
    [suggestedName, ocrText, Date.now(), originalUri]
  );
}

/**
 * Marks a record as failed with an error message.
 */
export function markError(originalUri: string, errorMessage: string): void {
  const db = getDb();
  db.runSync(
    `UPDATE pdf_renames
        SET status = 'error', error_message = ?, updated_at = ?
      WHERE original_uri = ?`,
    [errorMessage, Date.now(), originalUri]
  );
}

/**
 * Resets all records back to 'pending' so they will be re-processed.
 */
export function resetAllToPending(): void {
  const db = getDb();
  const now = Date.now();
  db.runSync(
    `UPDATE pdf_renames SET status = 'pending', suggested_name = NULL, ocr_text = NULL, error_message = NULL, updated_at = ?`,
    [now]
  );
}

/**
 * Deletes all records — full reset.
 */
export function clearAllRecords(): void {
  const db = getDb();
  db.runSync(`DELETE FROM pdf_renames`);
}

/**
 * Returns all records ordered by original_name ascending.
 */
export function getAllRecords(): PdfRenameRecord[] {
  const db = getDb();
  return db.getAllSync<PdfRenameRecord>(
    `SELECT * FROM pdf_renames ORDER BY original_name ASC`
  );
}

/**
 * Returns only records that have status = 'done' (have a suggested name).
 */
export function getDoneRecords(): PdfRenameRecord[] {
  const db = getDb();
  return db.getAllSync<PdfRenameRecord>(
    `SELECT * FROM pdf_renames WHERE status = 'done' ORDER BY suggested_name ASC`
  );
}

/**
 * Returns count of records by status.
 */
export function getStatusCounts(): Record<RenameStatus | 'total', number> {
  const db = getDb();
  const rows = db.getAllSync<{ status: string; count: number }>(
    `SELECT status, COUNT(*) as count FROM pdf_renames GROUP BY status`
  );
  const counts: Record<string, number> = { pending: 0, processing: 0, done: 0, error: 0, total: 0 };
  for (const row of rows) {
    counts[row.status] = row.count;
    counts.total += row.count;
  }
  return counts as Record<RenameStatus | 'total', number>;
}

/**
 * Returns URIs that are still in 'pending' state (not yet processed).
 */
export function getPendingUris(): string[] {
  const db = getDb();
  const rows = db.getAllSync<{ original_uri: string }>(
    `SELECT original_uri FROM pdf_renames WHERE status = 'pending'`
  );
  return rows.map((r) => r.original_uri);
}
