import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/empty-state';
import { ProgressOverlay } from '@/components/progress-overlay';
import { ThumbTile } from '@/components/thumb-tile';
import { useMediaItems } from '@/hooks/use-media-items';
import { addItemsToAlbum, listAlbumSummaries } from '@/lib/db/albums-repo';
import { deleteMediaItem, loadCaptionIndex, type MediaItem } from '@/lib/db/media-repo';
import { applyGalleryOrder, type MediaFilter, serializeOrder } from '@/lib/media/gallery-order';
import {
  importAssets,
  importDocuments,
  type ImportProgress,
  pickDocuments,
  pickFromLibrary,
} from '@/lib/media/import';
import { canShareOut, shareMediaItem } from '@/lib/media/share';
import { requireCtx, SessionChangedError, useSession } from '@/stores/session';
import { colors, radius, spacing } from '@/theme';

const COLUMNS = 3;
const GAP = 2;

const FILTERS: { key: MediaFilter; label: string }[] = [
  { key: 'all', label: 'Tümü' },
  { key: 'photo', label: 'Fotoğraf' },
  { key: 'video', label: 'Video' },
  { key: 'document', label: 'Belge' },
];

export default function GalleryScreen() {
  const { items, loading, error, refresh } = useMediaItems();
  const { width } = useWindowDimensions();
  const tileSize = (width - GAP * (COLUMNS - 1)) / COLUMNS;

  const [filter, setFilter] = useState<MediaFilter>('all');
  const [oldestFirst, setOldestFirst] = useState(false);
  const [selection, setSelection] = useState<Set<string> | null>(null);
  const [importing, setImporting] = useState<ImportProgress | null>(null);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [captionIndex, setCaptionIndex] = useState<Map<string, string> | null>(null);
  const [bulkProgress, setBulkProgress] = useState<{ label: string; current: number; total: number } | null>(null);
  // The "we did not delete your originals" warning is worth reading once per
  // unlocked session; on every batch it becomes a dismiss reflex. The screen
  // unmounts at lock, so this resets exactly when the reminder is due again.
  const warnedAboutOriginals = useRef(false);

  // Shared with the viewer so both screens page through the same list.
  const ordered = useMemo(() => applyGalleryOrder(items, filter, oldestFirst), [items, filter, oldestFirst]);

  // Captions are decrypted once when search opens, never per keystroke — the
  // gallery's list query does no crypto at all and should stay that way.
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('tr-TR');
    if (!needle || !captionIndex) return ordered;
    return ordered.filter((item) => (captionIndex.get(item.id) ?? '').toLocaleLowerCase('tr-TR').includes(needle));
  }, [ordered, query, captionIndex]);

  const selecting = selection !== null;
  const selectedCount = selection?.size ?? 0;

  const toggle = (id: string) => {
    setSelection((current) => {
      const next = new Set(current ?? []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openSearch = () => {
    setSearching(true);
    if (captionIndex) return;
    void loadCaptionIndex(requireCtx())
      .then(setCaptionIndex)
      .catch(() => setCaptionIndex(new Map()));
  };

  const runImport = (source: 'media' | 'documents') => {
    void (async () => {
      // Pick first, outside the busy marker: the picker is a system UI and the
      // user may sit in it for a while.
      const media = source === 'media' ? await pickFromLibrary() : [];
      const documents = source === 'documents' ? await pickDocuments() : [];
      const total = media.length + documents.length;
      if (total === 0) return;

      // Encryption holds the session context across the whole batch, so the
      // idle timer must not lock and zeroize it mid-write.
      const release = useSession.getState().beginBusy();
      setImporting({ current: 1, total });
      try {
        const ctx = requireCtx();
        const { failed } =
          source === 'media'
            ? await importAssets(ctx, media, setImporting)
            : await importDocuments(ctx, documents, setImporting);
        await refresh();
        if (failed > 0) {
          Alert.alert('Kısmen alındı', `${total - failed} öğe alındı, ${failed} tanesi alınamadı.`);
        } else if (!warnedAboutOriginals.current) {
          warnedAboutOriginals.current = true;
          Alert.alert(
            'Alındı',
            source === 'media'
              ? 'Seçtiklerin kasaya kopyalandı. Orijinalleri galeriden silmedik — uygulamanın galeriye erişimi yok. Gizli kalmalarını istiyorsan onları galeriden kendin sil.'
              : 'Belgeler kasaya kopyalandı. Orijinaller bulundukları yerde duruyor; gizli kalmalarını istiyorsan onları kendin sil.',
          );
        }
      } catch (e) {
        Alert.alert(
          'Alınamadı',
          e instanceof SessionChangedError
            ? 'Kasa işlem sırasında kilitlendi. Tekrar dene.'
            : 'İçerik alınamadı. Cihazda yer kalmamış olabilir.',
        );
      } finally {
        release();
        setImporting(null);
      }
    })();
  };

  const addSelectionToAlbum = () => {
    const ids = selection;
    if (!ids || ids.size === 0) return;
    void (async () => {
      const ctx = requireCtx();
      const albums = await listAlbumSummaries(ctx);
      if (albums.length === 0) {
        Alert.alert('Albüm yok', 'Önce Albümler sekmesinden bir albüm oluştur.');
        return;
      }
      Alert.alert('Albüme ekle', `${ids.size} öğe eklenecek.`, [
        { text: 'Vazgeç', style: 'cancel' },
        ...albums.slice(0, 8).map((album) => ({
          text: album.name,
          onPress: () => {
            void addItemsToAlbum(ctx, album.id, [...ids])
              .then(() => setSelection(null))
              .catch(() => Alert.alert('Hata', 'Eklenemedi.'));
          },
        })),
      ]);
    })().catch(() => Alert.alert('Hata', 'Albümler okunamadı.'));
  };

  const selectAll = () => setSelection(new Set(visible.map((item) => item.id)));

  const confirmBulkDelete = () => {
    const ids = selection;
    if (!ids || ids.size === 0) return;
    Alert.alert('Seçilenleri sil', `${ids.size} öğe geri getirilemez şekilde silinecek.`, [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Sil',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            const ctx = requireCtx();
            const targets = items.filter((i) => ids.has(i.id));
            // Deleting 200 items used to freeze the UI silently.
            for (const [at, target] of targets.entries()) {
              setBulkProgress({ label: 'Siliniyor', current: at + 1, total: targets.length });
              await deleteMediaItem(ctx, target);
            }
            setSelection(null);
            await refresh();
          })()
            .catch(() => Alert.alert('Hata', 'Silinemedi.'))
            .finally(() => setBulkProgress(null));
        },
      },
    ]);
  };

  /**
   * Sequential, with the per-item confirm kept. Each file leaves the vault
   * separately, so one blanket "share 40 things" approval would be a weaker
   * promise than the one the single-item path makes.
   */
  const bulkShare = () => {
    const ids = selection;
    if (!ids || ids.size === 0) return;
    const targets = items.filter((i) => ids.has(i.id));
    Alert.alert(
      'Kasadan dışarı paylaş',
      `${targets.length} öğe şifresi çözülerek kasanın DIŞINA paylaşılacak. Her biri için ayrı ayrı onaylaman istenecek.`,
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'Devam',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              const ctx = requireCtx();
              for (const [at, target] of targets.entries()) {
                setBulkProgress({ label: 'Paylaşılıyor', current: at + 1, total: targets.length });
                await shareMediaItem(ctx.dek, target);
              }
              setSelection(null);
            })()
              .catch(() => Alert.alert('Hata', 'Paylaşım tamamlanamadı.'))
              .finally(() => setBulkProgress(null));
          },
        },
      ],
    );
  };

  const renderItem = ({ item }: { item: MediaItem }) => (
    <ThumbTile
      item={item}
      size={tileSize}
      selected={selection?.has(item.id) ?? false}
      selecting={selecting}
      onPress={() =>
        selecting
          ? toggle(item.id)
          : router.push(`/media/${item.id}?${serializeOrder(filter, oldestFirst)}`)
      }
      onLongPress={() => (selecting ? toggle(item.id) : setSelection(new Set([item.id])))}
    />
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>{selecting ? `${selectedCount} seçili` : 'Galeri'}</Text>
        {selecting ? (
          <View style={styles.headerActions}>
            <Pressable onPress={selectAll} accessibilityRole="button" accessibilityLabel="Tümünü seç">
              <Ionicons name="checkmark-done-outline" size={22} color={colors.text} />
            </Pressable>
            {canShareOut() && (
              <Pressable
                onPress={bulkShare}
                disabled={selectedCount === 0}
                accessibilityRole="button"
                accessibilityLabel="Seçilenleri paylaş"
              >
                <Ionicons
                  name="share-outline"
                  size={22}
                  color={selectedCount === 0 ? colors.textDim : colors.text}
                />
              </Pressable>
            )}
            <Pressable
              onPress={addSelectionToAlbum}
              disabled={selectedCount === 0}
              accessibilityRole="button"
              accessibilityLabel="Albüme ekle"
            >
              <Ionicons
                name="albums-outline"
                size={22}
                color={selectedCount === 0 ? colors.textDim : colors.text}
              />
            </Pressable>
            <Pressable
              onPress={confirmBulkDelete}
              disabled={selectedCount === 0}
              accessibilityRole="button"
              accessibilityLabel="Seçilenleri sil"
            >
              <Ionicons
                name="trash-outline"
                size={22}
                color={selectedCount === 0 ? colors.textDim : colors.danger}
              />
            </Pressable>
            <Pressable onPress={() => setSelection(null)} accessibilityRole="button" accessibilityLabel="Seçimi bitir">
              <Text style={styles.headerAction}>Bitti</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.headerActions}>
            <Text style={styles.count}>{visible.length > 0 ? `${visible.length} öğe` : ''}</Text>
            {items.length > 0 && (
              <Pressable
                onPress={() => (searching ? (setSearching(false), setQuery('')) : openSearch())}
                accessibilityRole="button"
                accessibilityLabel={searching ? 'Aramayı kapat' : 'Açıklamalarda ara'}
              >
                <Ionicons name={searching ? 'close' : 'search'} size={20} color={colors.textDim} />
              </Pressable>
            )}
          </View>
        )}
      </View>

      {searching && !selecting && (
        <View style={styles.searchBox}>
          <Ionicons name="search" size={16} color={colors.textDim} />
          <TextInput
            style={styles.searchInput}
            placeholder="Açıklamalarda ara"
            placeholderTextColor={colors.textDim}
            value={query}
            onChangeText={setQuery}
            autoFocus
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Açıklamalarda ara"
          />
        </View>
      )}

      {!selecting && items.length > 0 && (
        <View style={styles.filterRow}>
          {FILTERS.map((option) => (
            <Pressable
              key={option.key}
              onPress={() => setFilter(option.key)}
              style={[styles.chip, filter === option.key && styles.chipActive]}
            >
              <Text style={[styles.chipText, filter === option.key && styles.chipTextActive]}>{option.label}</Text>
            </Pressable>
          ))}
          <Pressable
            onPress={() => setOldestFirst((v) => !v)}
            style={styles.chip}
            accessibilityRole="button"
            accessibilityLabel={oldestFirst ? 'En yeniden sırala' : 'En eskiden sırala'}
          >
            <Ionicons name={oldestFirst ? 'arrow-up' : 'arrow-down'} size={14} color={colors.textDim} />
            <Text style={styles.chipText}>{oldestFirst ? 'En eski' : 'En yeni'}</Text>
          </Pressable>
        </View>
      )}

      {error ? (
        <EmptyState icon="alert-circle-outline" title="Yüklenemedi" subtitle="İçerik okunamadı. Kilitleyip tekrar açmayı dene." />
      ) : !loading && items.length === 0 ? (
        <EmptyState
          icon="images-outline"
          title="Burası boş"
          subtitle="Kamerayla çek ya da galeriden içeri al. Çekilenler cihaz galerisine hiç düşmeden şifrelenir."
          actionLabel="Kamerayı aç"
          onAction={() => router.push('/camera')}
        />
      ) : !loading && visible.length === 0 ? (
        <EmptyState
          icon={query ? 'search-outline' : 'funnel-outline'}
          title="Eşleşen yok"
          subtitle={query ? 'Farklı bir arama dene.' : 'Bu filtreye uyan içerik yok.'}
        />
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(item) => item.id}
          numColumns={COLUMNS}
          columnWrapperStyle={{ gap: GAP }}
          contentContainerStyle={{ gap: GAP, paddingBottom: 96 }}
          // Every tile is the same known size, so the list never has to measure
          // one. Without this a few thousand items make scrolling stutter, and
          // each offscreen tile that mounts decrypts a thumbnail it will not
          // show — real work, not just layout.
          getItemLayout={(_, index) => {
            const row = Math.floor(index / COLUMNS);
            return { length: tileSize + GAP, offset: (tileSize + GAP) * row, index };
          }}
          initialNumToRender={COLUMNS * 6}
          maxToRenderPerBatch={COLUMNS * 4}
          windowSize={5}
          removeClippedSubviews
          renderItem={renderItem}
        />
      )}

      {!selecting && (
        <View style={styles.fabColumn}>
          <Pressable
            style={[styles.fab, styles.fabSecondary]}
            onPress={() => runImport('documents')}
            accessibilityRole="button"
            accessibilityLabel="Belge al"
          >
            <Ionicons name="document-outline" size={22} color={colors.text} />
          </Pressable>
          <Pressable
            style={[styles.fab, styles.fabSecondary]}
            onPress={() => runImport('media')}
            accessibilityRole="button"
            accessibilityLabel="Galeriden içeri al"
          >
            <Ionicons name="download-outline" size={24} color={colors.text} />
          </Pressable>
          <Pressable
            style={styles.fab}
            onPress={() => router.push('/camera')}
            accessibilityRole="button"
            accessibilityLabel="Fotoğraf veya video çek"
          >
            <Ionicons name="camera" size={28} color={colors.bg} />
          </Pressable>
        </View>
      )}

      <ProgressOverlay
        visible={bulkProgress !== null}
        label={bulkProgress ? `${bulkProgress.label} (${bulkProgress.current}/${bulkProgress.total})…` : ''}
        progress={bulkProgress ? bulkProgress.current / bulkProgress.total : null}
      />
      <ProgressOverlay
        visible={importing !== null}
        label={importing ? `Alınıyor (${importing.current}/${importing.total})…` : ''}
        progress={
          importing?.stream && importing.stream.totalBytes > 0
            ? importing.stream.processedBytes / importing.stream.totalBytes
            : null
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  headerAction: { color: colors.accent, fontSize: 16, fontWeight: '600' },
  title: { color: colors.text, fontSize: 30, fontWeight: '700' },
  count: { color: colors.textDim, fontSize: 14 },
  filterRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.accentDim },
  chipText: { color: colors.textDim, fontSize: 13 },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 15, paddingVertical: 10 },
  chipTextActive: { color: colors.accent, fontWeight: '600' },
  fabColumn: { position: 'absolute', right: spacing.lg, bottom: spacing.lg, gap: spacing.sm, alignItems: 'center' },
  fab: {
    width: 60,
    height: 60,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  fabSecondary: { width: 48, height: 48, backgroundColor: colors.surfaceAlt },
});
