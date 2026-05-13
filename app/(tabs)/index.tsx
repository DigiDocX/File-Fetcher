import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  FlatList,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  checkAllFilesAccess,
  ensureAllFilesAccess,
} from '@/lib/android-storage-access';
import { runBulkOcr, type BulkOcrMode, type BulkOcrProgress } from '@/lib/bulk-ocr';
import { getAllRecords, getDoneRecords, type PdfRenameRecord } from '@/lib/rename-db';
import { openPdf } from '@/lib/open-pdf';
import { initRenameDb } from '@/lib/rename-db';

// ─── Sub-components ───────────────────────────────────────────────────────────

type PermissionBadgeProps = { status: 'granted' | 'denied' | 'unknown' | 'unavailable' };

function PermissionBadge({ status }: PermissionBadgeProps) {
  const colors: Record<string, string> = {
    granted: '#22C55E',
    denied: '#EF4444',
    unknown: '#94A3B8',
    unavailable: '#F59E0B',
  };
  const labels: Record<string, string> = {
    granted: '✓ Storage Access',
    denied: '✗ No Storage Access',
    unknown: '○ Checking…',
    unavailable: '⚠ N/A on iOS',
  };
  return (
    <View style={[styles.permBadge, { borderColor: colors[status] }]}>
      <Text style={[styles.permBadgeText, { color: colors[status] }]}>
        {labels[status]}
      </Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

type ProgressOverlayProps = {
  progress: BulkOcrProgress;
  onCancel: () => void;
};

function ProgressOverlay({ progress, onCancel }: ProgressOverlayProps) {
  const ratio =
    progress.phase === 'ocr' && progress.total > 0
      ? progress.processed / progress.total
      : 0;

  const widthAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(widthAnim, {
      toValue: ratio,
      duration: 300,
      useNativeDriver: false,
    }).start();
  }, [ratio, widthAnim]);

  const phaseLabel =
    progress.phase === 'scanning'
      ? `Scanning… (${progress.total} found)`
      : progress.phase === 'ocr'
        ? `Processing ${progress.processed} / ${progress.total}`
        : 'Done!';

  return (
    <View style={styles.progressOverlay}>
      <View style={styles.progressCard}>
        <View style={styles.progressHeader}>
          <Text style={styles.progressTitle}>{phaseLabel}</Text>
          <ActivityIndicator color="#7C3AED" size="small" />
        </View>

        {/* Progress bar */}
        <View style={styles.progressBarTrack}>
          <Animated.View
            style={[
              styles.progressBarFill,
              {
                width: widthAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: ['0%', '100%'],
                }),
              },
            ]}
          />
        </View>

        {progress.currentLabel ? (
          <Text style={styles.progressLabel} numberOfLines={1}>
            {progress.currentLabel}
          </Text>
        ) : null}

        <Pressable style={styles.cancelButton} onPress={onCancel}>
          <Text style={styles.cancelButtonText}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

type PdfCardProps = {
  record: PdfRenameRecord;
  showSuggested: boolean;
};

function PdfCard({ record, showSuggested }: PdfCardProps) {
  const [pressing, setPressing] = useState(false);

  const handlePress = useCallback(() => {
    openPdf(record.original_uri, record.original_name);
  }, [record.original_uri, record.original_name]);

  const displayName = showSuggested
    ? record.suggested_name ?? record.original_name
    : record.original_name;

  const statusColor: Record<string, string> = {
    done: '#22C55E',
    error: '#EF4444',
    pending: '#94A3B8',
    processing: '#7C3AED',
  };

  const sizeLabel =
    record.file_size != null
      ? record.file_size < 1024 * 1024
        ? `${(record.file_size / 1024).toFixed(1)} KB`
        : `${(record.file_size / (1024 * 1024)).toFixed(1)} MB`
      : null;

  return (
    <Pressable
      onPress={handlePress}
      onPressIn={() => setPressing(true)}
      onPressOut={() => setPressing(false)}
      style={[styles.card, pressing && styles.cardPressed]}>
      {/* Status dot */}
      <View
        style={[styles.statusDot, { backgroundColor: statusColor[record.status] ?? '#94A3B8' }]}
      />

      <View style={styles.cardBody}>
        <Text style={styles.cardName} numberOfLines={2}>
          {displayName}
        </Text>

        {showSuggested && record.suggested_name && record.suggested_name !== record.original_name ? (
          <Text style={styles.cardOriginalSmall} numberOfLines={1}>
            ← {record.original_name}
          </Text>
        ) : null}

        <Text style={styles.cardMeta} numberOfLines={1}>
          {record.relative_path}
          {sizeLabel ? `  ·  ${sizeLabel}` : ''}
        </Text>

        {record.status === 'error' && record.error_message ? (
          <Text style={styles.cardError} numberOfLines={1}>
            ⚠ {record.error_message}
          </Text>
        ) : null}
      </View>

      <Text style={styles.cardChevron}>›</Text>
    </Pressable>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ label }: { label: string }) {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyIcon}>📂</Text>
      <Text style={styles.emptyText}>{label}</Text>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

type InnerTab = 'original' | 'suggested';

export default function HomeScreen() {
  const [permStatus, setPermStatus] = useState<
    'granted' | 'denied' | 'unknown' | 'unavailable'
  >('unknown');
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<BulkOcrProgress | null>(null);
  const [records, setRecords] = useState<PdfRenameRecord[]>([]);
  const [doneRecords, setDoneRecords] = useState<PdfRenameRecord[]>([]);
  const [innerTab, setInnerTab] = useState<InnerTab>('original');
  const [mode, setMode] = useState<BulkOcrMode>('skip-done');
  const [summary, setSummary] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  // ── Permission check ──────────────────────────────────────────────────────
  const checkPerm = useCallback(() => {
    if (Platform.OS !== 'android') {
      setPermStatus('unavailable');
      return;
    }
    checkAllFilesAccess().then((s) => {
      if (s === 'granted') setPermStatus('granted');
      else if (s === 'unavailable') setPermStatus('unavailable');
      else setPermStatus('denied');
    });
  }, []);

  // ── Init ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    try {
      initRenameDb();
      refreshLists();
    } catch {
      // DB might not exist yet — that's fine
    }

    checkPerm();

    // Re-check permission whenever the app comes back to the foreground.
    // This is essential for MANAGE_EXTERNAL_STORAGE because it is granted
    // via Android Settings (not a runtime dialog), so we only learn about
    // the grant when the user switches back to our app.
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        checkPerm();
      }
    });

    return () => subscription.remove();
  }, [checkPerm]);

  const refreshLists = useCallback(() => {
    try {
      setRecords(getAllRecords());
      setDoneRecords(getDoneRecords());
    } catch {
      // Tables not created yet
    }
  }, []);

  // ── Grant permission ──────────────────────────────────────────────────────
  const handleGrantPermission = useCallback(async () => {
    const result = await ensureAllFilesAccess();
    if (result === 'granted') {
      setPermStatus('granted');
    } else if (result === 'opened-settings') {
      Alert.alert(
        'Permission Required',
        'Please grant "All Files Access" in Settings, then come back and tap Run again.'
      );
    }
  }, []);

  // ── Run OCR ───────────────────────────────────────────────────────────────
  const handleRun = useCallback(async () => {
    if (Platform.OS !== 'android') {
      Alert.alert('Android Only', 'Bulk phone storage scanning is only available on Android.');
      return;
    }

    if (permStatus !== 'granted') {
      await handleGrantPermission();
      return;
    }

    setSummary(null);
    setIsRunning(true);
    abortRef.current = new AbortController();

    try {
      const result = await runBulkOcr(
        mode,
        (p) => {
          setProgress(p);
          if (p.phase === 'done' || p.phase === 'ocr') {
            refreshLists();
          }
        },
        abortRef.current.signal
      );

      setSummary(
        `Found ${result.totalFound} PDFs · Processed ${result.totalProcessed} · Skipped ${result.totalSkipped} · Errors ${result.totalErrors}`
      );
      refreshLists();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      Alert.alert('OCR Failed', msg);
    } finally {
      setIsRunning(false);
      setProgress(null);
      abortRef.current = null;
    }
  }, [permStatus, mode, handleGrantPermission, refreshLists]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────
  const listData = innerTab === 'original' ? records : doneRecords;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <View style={styles.header}>
          <View>
            <Text style={styles.appTitle}>F-Rename</Text>
            <Text style={styles.appSubtitle}>Smart PDF Renamer</Text>
          </View>
          <PermissionBadge status={permStatus} />
        </View>

        {/* ── Run button + mode toggle ────────────────────────────────────── */}
        <View style={styles.actionRow}>
          <Pressable
            style={[styles.runButton, isRunning && styles.runButtonDisabled]}
            onPress={handleRun}
            disabled={isRunning}>
            <Text style={styles.runButtonIcon}>🔍</Text>
            <Text style={styles.runButtonText}>
              {isRunning ? 'Running OCR…' : 'Run OCR on All Files'}
            </Text>
          </Pressable>

          {/* Mode toggle */}
          <Pressable
            style={styles.modeToggle}
            onPress={() => setMode((m) => (m === 'skip-done' ? 'reprocess-all' : 'skip-done'))}
            disabled={isRunning}>
            <Text style={styles.modeToggleText}>
              {mode === 'skip-done' ? '⏩ Skip processed' : '🔄 Re-process all'}
            </Text>
          </Pressable>
        </View>

        {/* ── Summary line ────────────────────────────────────────────────── */}
        {summary ? (
          <View style={styles.summaryBar}>
            <Text style={styles.summaryText}>{summary}</Text>
          </View>
        ) : null}

        {/* ── Inner tab bar ───────────────────────────────────────────────── */}
        <View style={styles.innerTabBar}>
          <Pressable
            style={[styles.innerTab, innerTab === 'original' && styles.innerTabActive]}
            onPress={() => setInnerTab('original')}>
            <Text style={[styles.innerTabText, innerTab === 'original' && styles.innerTabTextActive]}>
              Original Names
              {records.length > 0 ? ` (${records.length})` : ''}
            </Text>
          </Pressable>
          <Pressable
            style={[styles.innerTab, innerTab === 'suggested' && styles.innerTabActive]}
            onPress={() => setInnerTab('suggested')}>
            <Text
              style={[styles.innerTabText, innerTab === 'suggested' && styles.innerTabTextActive]}>
              Suggested Names
              {doneRecords.length > 0 ? ` (${doneRecords.length})` : ''}
            </Text>
          </Pressable>
        </View>

        {/* ── List ────────────────────────────────────────────────────────── */}
        <FlatList
          data={listData}
          keyExtractor={(item) => `${item.id}`}
          renderItem={({ item }) => (
            <PdfCard record={item} showSuggested={innerTab === 'suggested'} />
          )}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <EmptyState
              label={
                innerTab === 'original'
                  ? 'No PDFs found yet.\nTap "Run OCR on All Files" to start.'
                  : 'No renamed PDFs yet.\nRun OCR to generate suggested names.'
              }
            />
          }
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      </View>

      {/* ── Progress overlay ─────────────────────────────────────────────── */}
      {isRunning && progress ? (
        <ProgressOverlay progress={progress} onCancel={handleCancel} />
      ) : null}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#020617',
  },
  container: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 12,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  appTitle: {
    color: '#F8FAFC',
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  appSubtitle: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '500',
    marginTop: 1,
  },

  // Permission badge
  permBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  permBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },

  // Action row
  actionRow: {
    gap: 8,
  },
  runButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#7C3AED',
    paddingVertical: 14,
    borderRadius: 14,
    shadowColor: '#7C3AED',
    shadowOpacity: 0.45,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  runButtonDisabled: {
    opacity: 0.55,
  },
  runButtonIcon: {
    fontSize: 18,
  },
  runButtonText: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '700',
  },
  modeToggle: {
    alignSelf: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  modeToggleText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
  },

  // Summary bar
  summaryBar: {
    backgroundColor: '#0F172A',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  summaryText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
  },

  // Inner tab bar
  innerTabBar: {
    flexDirection: 'row',
    backgroundColor: '#0F172A',
    borderRadius: 12,
    padding: 4,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  innerTab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 9,
    borderRadius: 9,
  },
  innerTabActive: {
    backgroundColor: '#7C3AED',
  },
  innerTabText: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '600',
  },
  innerTabTextActive: {
    color: '#F8FAFC',
  },

  // List
  listContent: {
    paddingBottom: 24,
    flexGrow: 1,
  },
  separator: {
    height: 8,
  },

  // PDF Card
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1E293B',
    padding: 14,
    gap: 12,
  },
  cardPressed: {
    opacity: 0.75,
    transform: [{ scale: 0.985 }],
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    flexShrink: 0,
  },
  cardBody: {
    flex: 1,
    gap: 3,
  },
  cardName: {
    color: '#E2E8F0',
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
  },
  cardOriginalSmall: {
    color: '#64748B',
    fontSize: 11,
    fontStyle: 'italic',
  },
  cardMeta: {
    color: '#475569',
    fontSize: 11,
  },
  cardError: {
    color: '#FCA5A5',
    fontSize: 11,
  },
  cardChevron: {
    color: '#334155',
    fontSize: 22,
    fontWeight: '300',
  },

  // Empty state
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 60,
    gap: 12,
  },
  emptyIcon: {
    fontSize: 48,
  },
  emptyText: {
    color: '#475569',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
  },

  // Progress overlay
  progressOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(2, 6, 23, 0.88)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  progressCard: {
    backgroundColor: '#0F172A',
    borderRadius: 20,
    padding: 24,
    width: '100%',
    borderWidth: 1,
    borderColor: '#1E293B',
    gap: 16,
  },
  progressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  progressTitle: {
    color: '#E2E8F0',
    fontSize: 16,
    fontWeight: '700',
    flexShrink: 1,
  },
  progressBarTrack: {
    height: 8,
    backgroundColor: '#1E293B',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#7C3AED',
    borderRadius: 4,
  },
  progressLabel: {
    color: '#64748B',
    fontSize: 12,
    fontStyle: 'italic',
  },
  cancelButton: {
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
  },
  cancelButtonText: {
    color: '#94A3B8',
    fontWeight: '600',
    fontSize: 14,
  },
});
