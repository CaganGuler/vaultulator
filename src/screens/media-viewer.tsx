/**
 * The media viewer: a horizontal pager over the gallery's current list.
 *
 * A plain FlatList with pagingEnabled rather than a hand-rolled Reanimated
 * pager — momentum, deceleration and overscroll are not worth reimplementing.
 * The app is portrait-locked, so page width never changes mid-session.
 */
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PhotoPage } from '@/components/media/photo-page';
import { DocumentPage } from '@/components/media/document-page';
import { VideoPage } from '@/components/media/video-page';
import { deleteMediaItem, getMediaText, type MediaItem } from '@/lib/db/media-repo';
import { useGalleryPage } from '@/hooks/use-gallery-page';
import type { MediaFilter } from '@/lib/media/gallery-order';
import { clearPhotoTemps, evictPhoto, getPhotoFileUri, prefetchPhotos, setPinnedPhotos } from '@/lib/media/photo-cache';
import { canShareOut, shareMediaItem } from '@/lib/media/share';
import { getThumbnailDataUri } from '@/lib/media/viewer-cache';
import { requireCtx } from '@/stores/session';
import { colors, formatBytes, formatDate, radius, spacing } from '@/theme';

/** Kept either side of the focused page; the cache window is a little wider. */
const NEIGHBOURS = 1;

interface Props {
  id: string;
  filter: MediaFilter;
  oldestFirst: boolean;
}

export function MediaViewerScreen({ id, filter, oldestFirst }: Props) {
  const { width } = useWindowDimensions();
  const { list, initialIndex, loading, notFound } = useGalleryPage(id, filter, oldestFirst);

  // Derived, not copied: the loaded list minus anything deleted from in here.
  // Mirroring it into state would mean syncing two sources in an effect.
  const [removedIds, setRemovedIds] = useState<ReadonlySet<string>>(new Set());
  const [pagedIndex, setPagedIndex] = useState<number | null>(null);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [zoomed, setZoomed] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [uris, setUris] = useState<Record<string, string>>({});
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [failedIds, setFailedIds] = useState<Set<string>>(new Set());
  const [names, setNames] = useState<Record<string, string>>({});

  const listRef = useRef<FlatList<MediaItem>>(null);

  const items = useMemo(
    () => (removedIds.size === 0 ? list : list.filter((item) => !removedIds.has(item.id))),
    [list, removedIds],
  );
  const index = Math.min(pagedIndex ?? initialIndex, Math.max(0, items.length - 1));

  // Everything decrypted for this screen goes away when it closes.
  useEffect(() => () => clearPhotoTemps(), []);

  const current = items[index];

  /** Focused item first, then neighbours; videos are never warmed. */
  useEffect(() => {
    if (items.length === 0) return;
    const window = items.slice(Math.max(0, index - NEIGHBOURS), index + NEIGHBOURS + 1);
    setPinnedPhotos(window.map((item) => item.id));

    const ctx = requireCtx();
    const focused = items[index];
    if (!focused) return;

    // Thumbnails are already in the grid's cache, so this is near-free and
    // gives fast swipes something to show instead of a black frame.
    for (const item of window) {
      if (thumbs[item.id]) continue;
      void getThumbnailDataUri(ctx.dek, item)
        .then((uri) => uri && setThumbs((prev) => ({ ...prev, [item.id]: uri })))
        .catch(() => undefined);
    }

    // Documents need their original filename, which is encrypted per row.
    if (focused.type === 'document' && names[focused.id] === undefined) {
      void getMediaText(ctx, focused.id)
        .then((text) => setNames((prev) => ({ ...prev, [focused.id]: text?.originalName ?? '' })))
        .catch(() => setNames((prev) => ({ ...prev, [focused.id]: '' })));
    }

    if (focused.type === 'photo' && !uris[focused.id]) {
      void getPhotoFileUri(ctx, focused)
        .then((uri) => setUris((prev) => ({ ...prev, [focused.id]: uri })))
        .catch(() => setFailedIds((prev) => new Set(prev).add(focused.id)));
    }
    prefetchPhotos(ctx, window);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- uris/thumbs are caches, not inputs
  }, [items, index]);

  const confirmShare = () => {
    if (!current) return;
    Alert.alert('Kasadan dışarı paylaş', 'Bu içerik şifresi çözülerek kasanın DIŞINA paylaşılacak. Emin misin?', [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Paylaş',
        style: 'destructive',
        onPress: () => {
          setSharing(true);
          void shareMediaItem(requireCtx().dek, current)
            .catch(() => Alert.alert('Hata', 'Paylaşım başarısız oldu.'))
            .finally(() => setSharing(false));
        },
      },
    ]);
  };

  const confirmDelete = () => {
    if (!current) return;
    Alert.alert('Kalıcı olarak sil', 'Bu içerik geri getirilemez şekilde silinecek.', [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Sil',
        style: 'destructive',
        onPress: () => {
          void deleteMediaItem(requireCtx(), current)
            .then(() => {
              evictPhoto(current.id);
              if (items.length <= 1) {
                router.back();
                return;
              }
              // Stay put: the next item slides into this index. Bouncing back
              // to the grid after every delete is what the old viewer did.
              setRemovedIds((prev) => new Set(prev).add(current.id));
            })
            .catch(() => Alert.alert('Hata', 'Silinemedi.'));
        },
      },
    ]);
  };

  const renderItem = useCallback(
    ({ item, index: itemIndex }: { item: MediaItem; index: number }) =>
      item.type === 'video' ? (
        <VideoPage item={item} placeholderUri={thumbs[item.id] ?? null} active={itemIndex === index} />
      ) : item.type === 'document' ? (
        <DocumentPage item={item} originalName={names[item.id] ?? ''} active={itemIndex === index} />
      ) : (
        <PhotoPage
          uri={uris[item.id] ?? null}
          placeholderUri={thumbs[item.id] ?? null}
          failed={failedIds.has(item.id)}
          onZoomChange={setZoomed}
          onSingleTap={() => setChromeVisible((v) => !v)}
          pagerRef={listRef}
        />
      ),
    [thumbs, uris, failedIds, names, index],
  );

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  if (notFound || items.length === 0) {
    return (
      <View style={styles.container}>
        <Ionicons name="alert-circle-outline" size={44} color={colors.textDim} />
        <Text style={styles.meta}>Bu içerik bulunamadı.</Text>
        <Pressable style={styles.iconButton} onPress={() => router.back()} accessibilityLabel="Kapat">
          <Ionicons name="close" size={24} color={colors.text} />
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        ref={listRef}
        data={items}
        horizontal
        pagingEnabled
        keyExtractor={(item) => item.id}
        initialScrollIndex={initialIndex}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        showsHorizontalScrollIndicator={false}
        // Belt-and-braces behind blocksExternalGesture, which does the real
        // arbitration natively.
        scrollEnabled={!zoomed}
        // Only ~3 pages mount; clipping them makes expo-image blank on Android.
        removeClippedSubviews={false}
        windowSize={3}
        initialNumToRender={1}
        maxToRenderPerBatch={1}
        onMomentumScrollEnd={(e) => setPagedIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
        renderItem={renderItem}
      />

      {chromeVisible && (
        <SafeAreaView style={styles.chrome} pointerEvents="box-none">
          <View style={styles.topRow}>
            <Pressable
              style={styles.iconButton}
              onPress={() => router.back()}
              accessibilityRole="button"
              accessibilityLabel="Kapat"
            >
              <Ionicons name="close" size={24} color={colors.text} />
            </Pressable>
            {current && (
              <Text style={styles.meta}>
                {index + 1}/{items.length} · {formatDate(current.createdAt)} · {formatBytes(current.sizeBytes)}
              </Text>
            )}
          </View>
          <View style={styles.bottomRow}>
            {canShareOut() && (
              <Pressable
                style={styles.iconButton}
                onPress={confirmShare}
                disabled={sharing}
                accessibilityRole="button"
                accessibilityLabel="Kasadan dışarı paylaş"
              >
                <Ionicons name="share-outline" size={24} color={colors.text} />
              </Pressable>
            )}
            <Pressable
              style={styles.iconButton}
              onPress={confirmDelete}
              accessibilityRole="button"
              accessibilityLabel="Kalıcı olarak sil"
            >
              <Ionicons name="trash-outline" size={24} color={colors.danger} />
            </Pressable>
          </View>
        </SafeAreaView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  chrome: { ...StyleSheet.absoluteFill, justifyContent: 'space-between' },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  meta: { color: colors.textDim, fontSize: 13 },
  bottomRow: { flexDirection: 'row', justifyContent: 'space-around', paddingBottom: spacing.md },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
