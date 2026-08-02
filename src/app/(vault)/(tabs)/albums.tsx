/**
 * Album list.
 *
 * Identical in both vaults, deliberately. A decoy that cannot make albums, or
 * that renders them differently, is exactly the kind of tell invariant #8
 * forbids — so there is no useIsPrimary() anywhere in this feature.
 */
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/empty-state';
import { createAlbum, listAlbumSummaries, type AlbumSummary } from '@/lib/db/albums-repo';
import { requireCtx } from '@/stores/session';
import { colors, formatDate, radius, spacing } from '@/theme';

export default function AlbumsScreen() {
  const [albums, setAlbums] = useState<AlbumSummary[] | null>(null);
  const [error, setError] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');

  const refresh = useCallback(async () => {
    try {
      setAlbums(await listAlbumSummaries(requireCtx()));
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setCreating(false);
      return;
    }
    void createAlbum(requireCtx(), trimmed)
      .then(() => {
        setName('');
        setCreating(false);
        return refresh();
      })
      .catch(() => Alert.alert('Hata', 'Albüm oluşturulamadı.'));
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Albümler</Text>
        <Pressable
          onPress={() => setCreating((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel="Yeni albüm"
        >
          <Ionicons name={creating ? 'close' : 'add'} size={26} color={colors.accent} />
        </Pressable>
      </View>

      {creating && (
        <View style={styles.createRow}>
          <TextInput
            style={styles.input}
            placeholder="Albüm adı"
            placeholderTextColor={colors.textDim}
            value={name}
            onChangeText={setName}
            autoFocus
            maxLength={60}
            returnKeyType="done"
            onSubmitEditing={submit}
            accessibilityLabel="Albüm adı"
          />
          <Pressable onPress={submit} accessibilityRole="button" accessibilityLabel="Oluştur">
            <Text style={styles.action}>Oluştur</Text>
          </Pressable>
        </View>
      )}

      {error ? (
        <EmptyState icon="alert-circle-outline" title="Yüklenemedi" subtitle="Albümler okunamadı." />
      ) : albums && albums.length === 0 ? (
        <EmptyState
          icon="albums-outline"
          title="Albüm yok"
          subtitle="Galeride öğelere uzun basıp seçtiklerini bir albüme ekleyebilirsin."
          actionLabel="Albüm oluştur"
          onAction={() => setCreating(true)}
        />
      ) : (
        <FlatList
          data={albums ?? []}
          keyExtractor={(album) => album.id}
          contentContainerStyle={{ paddingHorizontal: spacing.md, paddingBottom: 96, gap: spacing.sm }}
          renderItem={({ item }) => (
            <Pressable style={styles.row} onPress={() => router.push(`/album/${item.id}`)}>
              <Ionicons name="albums-outline" size={22} color={colors.textDim} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={styles.rowMeta}>
                  {item.itemCount} öğe · {formatDate(item.updatedAt)}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
            </Pressable>
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
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  title: { color: colors.text, fontSize: 30, fontWeight: '700' },
  createRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  input: { flex: 1, color: colors.text, fontSize: 15, paddingVertical: 10 },
  action: { color: colors.accent, fontSize: 15, fontWeight: '600' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  rowTitle: { color: colors.text, fontSize: 16 },
  rowMeta: { color: colors.textDim, fontSize: 13, marginTop: 2 },
});
