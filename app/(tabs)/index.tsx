/**
 * app/(tabs)/index.tsx
 *
 * AceScanner — Instant document discovery.
 */

import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { discoverPDFs, type DiscoveredPdf } from '@/lib/media-query';

type FilterKey = 'ALL' | 'PDF' | 'WORD' | 'EXCEL' | 'TXT';

const FILTER_LABELS: Record<FilterKey, string> = {
  ALL: 'ALL',
  PDF: 'PDF',
  WORD: 'WORD',
  EXCEL: 'EXCEL',
  TXT: 'TXT',
};

function getDocKind(item: DiscoveredPdf): FilterKey {
  const mime = (item.mimeType ?? '').toLowerCase();
  const name = item.name.toLowerCase();

  if (mime === 'application/pdf' || name.endsWith('.pdf')) return 'PDF';
  if (
    mime === 'application/msword' ||
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    name.endsWith('.doc') ||
    name.endsWith('.docx')
  ) {
    return 'WORD';
  }
  if (
    mime === 'application/vnd.ms-excel' ||
    mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    name.endsWith('.xls') ||
    name.endsWith('.xlsx')
  ) {
    return 'EXCEL';
  }

  if (mime === 'text/plain' || name.endsWith('.txt')) {
    return 'TXT';
  }

  return 'ALL';
}

// ─── List Item ────────────────────────────────────────────────────────────────

type ListItemProps = {
  item: DiscoveredPdf;
};

function PdfListItem({ item }: ListItemProps) {
  return (
    <View style={styles.card}>
      {/* Row 1: filename */}
      <View style={styles.cardHeader}>
        <Text style={styles.fileName} numberOfLines={1}>
          {item.name}
        </Text>
      </View>

      {/* Row 2: physical path */}
      <Text style={styles.fileUri} numberOfLines={1}>
        {item.uri}
      </Text>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const [pdfs,        setPdfs]        = useState<DiscoveredPdf[]>([]);
  const [isScanning,  setIsScanning]  = useState(false);
  const [elapsedMs,   setElapsedMs]   = useState<number | null>(null);
  const [activeFilter, setActiveFilter] = useState<FilterKey>('ALL');
  const [isFilterOpen, setIsFilterOpen] = useState(false);

  // ── Phase 1: Instant Discovery ─────────────────────────────────────────────
  const handleAceScan = useCallback(async () => {
    if (isScanning) return;

    setIsScanning(true);
    setElapsedMs(null);
    setPdfs([]);

    const t0 = Date.now();
    const discovered = await discoverPDFs();
    const elapsed = Date.now() - t0;

    // ── Phase 2: Immediately render the metadata list ─────────────────────
    setPdfs(discovered);
    setElapsedMs(elapsed);
    setIsScanning(false);
  }, [isScanning]);

  // ── Derived UI state ───────────────────────────────────────────────────────
  const totalCount   = pdfs.length;

  const filterCounts = useMemo(() => {
    const counts: Record<FilterKey, number> = {
      ALL: pdfs.length,
      PDF: 0,
      WORD: 0,
      EXCEL: 0,
      TXT: 0,
    };

    for (const item of pdfs) {
      const kind = getDocKind(item);
      if (kind !== 'ALL') {
        counts[kind] += 1;
      }
    }

    return counts;
  }, [pdfs]);

  const filteredDocs = useMemo(() => {
    if (activeFilter === 'ALL') return pdfs;
    return pdfs.filter((item) => getDocKind(item) === activeFilter);
  }, [pdfs, activeFilter]);
  const buttonLabel = isScanning
    ? 'Scanning…'
    : 'Trigger Ace Scan';

  const buttonDisabled = isScanning;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>

        {/* ── Header ── */}
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <Text style={styles.headerTitle}>AceScanner</Text>
            <View style={styles.filterWrap}>
              <TouchableOpacity
                style={styles.filterButton}
                onPress={() => setIsFilterOpen((open) => !open)}
                activeOpacity={0.8}
              >
                <Text style={styles.filterButtonText}>
                  {FILTER_LABELS[activeFilter]} ({filterCounts[activeFilter]})
                </Text>
                <Text style={styles.filterChevron}>▾</Text>
              </TouchableOpacity>

              {isFilterOpen && (
                <View style={styles.filterMenu}>
                  {(Object.keys(FILTER_LABELS) as FilterKey[]).map((key) => (
                    <TouchableOpacity
                      key={key}
                      style={styles.filterItem}
                      onPress={() => {
                        setActiveFilter(key);
                        setIsFilterOpen(false);
                      }}
                    >
                      <Text style={styles.filterItemText}>
                        {FILTER_LABELS[key]} ({filterCounts[key]})
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          </View>
          {elapsedMs !== null && (
            <Text style={styles.headerSub}>
              {totalCount} document{totalCount !== 1 ? 's' : ''} found in {elapsedMs} ms
            </Text>
          )}
        </View>

        {/* ── PDF List — Phase 2 ── */}
        <FlatList
          data={filteredDocs}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <PdfListItem item={item} />}
          contentContainerStyle={styles.listContent}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={5}
          ListEmptyComponent={
            isScanning ? null : (
              <Text style={styles.emptyText}>
                No documents discovered yet.{'\n'}Tap "Trigger Ace Scan" to begin.
              </Text>
            )
          }
        />

        {/* ── Scan Button ── */}
        <TouchableOpacity
          style={[styles.button, buttonDisabled && styles.buttonDisabled]}
          onPress={handleAceScan}
          disabled={buttonDisabled}
          activeOpacity={0.8}
        >
          {isScanning && (
            <ActivityIndicator
              color="#fff"
              size="small"
              style={styles.spinner}
            />
          )}
          <Text style={styles.buttonText}>{buttonLabel}</Text>
        </TouchableOpacity>

      </View>
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
    padding: 20,
    gap: 16,
  },

  // ── Header
  header: {
    gap: 4,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerTitle: {
    color: '#F8FAFC',
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  headerSub: {
    color: '#94A3B8',
    fontSize: 13,
  },
  filterWrap: {
    position: 'relative',
    alignItems: 'flex-end',
  },
  filterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#0F172A',
    borderColor: '#1E293B',
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
  },
  filterButtonText: {
    color: '#E2E8F0',
    fontSize: 12,
    fontWeight: '600',
  },
  filterChevron: {
    color: '#94A3B8',
    fontSize: 12,
  },
  filterMenu: {
    position: 'absolute',
    top: 36,
    right: 0,
    backgroundColor: '#0F172A',
    borderColor: '#1E293B',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 6,
    minWidth: 160,
    zIndex: 20,
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
  },
  filterItem: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  filterItemText: {
    color: '#E2E8F0',
    fontSize: 13,
    fontWeight: '600',
  },

  // ── List
  listContent: {
    paddingBottom: 24,
    gap: 12,
    flexGrow: 1,
  },
  emptyText: {
    color: '#475569',
    textAlign: 'center',
    marginTop: 60,
    fontSize: 14,
    lineHeight: 22,
  },

  // ── Card
  card: {
    backgroundColor: '#0F172A',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1E293B',
    gap: 8,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  fileName: {
    color: '#E2E8F0',
    fontSize: 15,
    fontWeight: '600',
    flex: 1,
  },
  fileUri: {
    color: '#64748B',
    fontSize: 11,
  },

  // ── Button
  button: {
    backgroundColor: '#3B82F6',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    elevation: 3,
    shadowColor: '#3B82F6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
  },
  buttonDisabled: {
    backgroundColor: '#1E3A5F',
    elevation: 0,
    shadowOpacity: 0,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  spinner: {
    // displayed inline next to button text
  },
});
