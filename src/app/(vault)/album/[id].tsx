/**
 * One album: its items in album order, with rename and delete.
 *
 * Deleting an album never touches the media it references — the membership
 * list is metadata, and losing an album must not lose content that cannot be
 * recovered.
 */
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/empty-state';
import { ThumbTile } from '@/components/thumb-tile';
import { deleteAlbum, getAlbum, listAlbumItems, removeItemsFromAlbum, renameAlbum } from '@/lib/db/albums-repo';
import type { MediaItem } from '@/lib/db/media-repo';
import { requireCtx } from '@/stores/session';
import { colors, radius, spacing } from '@/theme';

const COLUMNS = 3;
const GAP = 2;

export default function AlbumScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { width } = useWindowDimensions();
  const tileSize = (width - GAP * (COLUMNS - 1)) / COLUMNS;

  const [name, setName] = useState<string | null>(null);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [missing, setMissing] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState('');

  const refresh = useCallback(async () => {
    const ctx = requireCtx();
    const album = await getAlbum(ctx, id);
    if (!album) {
      setMissing(true);
      return;
    }
    setName(album.name);
    setItems(await listAlbumItems(ctx, id));
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void refresh().catch(() => setMissing(true));
    }, [refresh]),
  );

  const submitRename = () => {
    const trimmed = draft.trim();
    setRenaming(false);
    if (!trimmed || trimmed === name) return;
    void renameAlbum(requireCtx(), id, trimmed)
      .then(refresh)
      .catch(() => Alert.alert('Hata', 'Yeniden adlandırılamadı.'));
  };

  const confirmDelete = () => {
    Alert.alert('Albümü sil', 'Yalnızca albüm silinir; içindeki fotoğraf ve videolar kasada kalır.', [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Sil',
        style: 'destructive',
        onPress: () => {
          void deleteAlbum(requireCtx(), id)
            .then(() => router.back())
            .catch(() => Alert.alert('Hata', 'Silinemedi.'));
        },
      },
    ]);
  };

  const confirmRemove = (item: MediaItem) => {
    Alert.alert('Albümden çıkar', 'Öğe albümden çıkarılır, kasadan silinmez.', [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Çıkar',
        onPress: () => {
          void removeItemsFromAlbum(requireCtx(), id, [item.id])
            .then(refresh)
            .catch(() => Alert.alert('Hata', 'Çıkarılamadı.'));
        },
      },
    ]);
  };

  if (missing) {
    return (
      <SafeAreaView style={styles.container}>
        <EmptyState icon="alert-circle-outline" title="Albüm bulunamadı" subtitle="Silinmiş olabilir." />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Pressable
          style={styles.iconButton}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Geri"
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        {renaming ? (
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            autoFocus
            maxLength={60}
            returnKeyType="done"
            onSubmitEditing={submitRename}
            onBlur={submitRename}
            accessibilityLabel="Albüm adı"
          />
        ) : (
          <Pressable
            style={{ flex: 1 }}
            onPress={() => {
              setDraft(name ?? '');
              setRenaming(true);
            }}
          >
            <Text style={styles.title} numberOfLines={1}>
              {name ?? '…'}
            </Text>
          </Pressable>
        )}
        <Pressable
          style={styles.iconButton}
          onPress={confirmDelete}
          accessibilityRole="button"
          accessibilityLabel="Albümü sil"
        >
          <Ionicons name="trash-outline" size={22} color={colors.danger} />
        </Pressable>
      </View>

      {items.length === 0 ? (
        <EmptyState
          icon="images-outline"
          title="Albüm boş"
          subtitle="Galeride öğelere uzun basıp seçtiklerini buraya ekleyebilirsin."
        />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          numColumns={COLUMNS}
          columnWrapperStyle={{ gap: GAP }}
          contentContainerStyle={{ gap: GAP, paddingBottom: 96 }}
          getItemLayout={(_, i) => {
            const row = Math.floor(i / COLUMNS);
            return { length: tileSize + GAP, offset: (tileSize + GAP) * row, index: i };
          }}
          removeClippedSubviews
          renderItem={({ item }) => (
            <ThumbTile
              item={item}
              size={tileSize}
              onPress={() => router.push(`/media/${item.id}`)}
              onLongPress={() => confirmRemove(item)}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  title: { color: colors.text, fontSize: 22, fontWeight: '700' },
  input: {
    flex: 1,
    color: colors.text,
    fontSize: 20,
    fontWeight: '700',
    paddingVertical: 6,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
