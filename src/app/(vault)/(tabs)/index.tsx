import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { FlatList, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/empty-state';
import { ThumbTile } from '@/components/thumb-tile';
import { useMediaItems } from '@/hooks/use-media-items';
import { colors, radius, spacing } from '@/theme';

const COLUMNS = 3;
const GAP = 2;

export default function GalleryScreen() {
  const { items, loading } = useMediaItems();
  const { width } = useWindowDimensions();
  const tileSize = (width - GAP * (COLUMNS - 1)) / COLUMNS;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Galeri</Text>
        <Text style={styles.count}>{items.length > 0 ? `${items.length} öğe` : ''}</Text>
      </View>
      {!loading && items.length === 0 ? (
        <EmptyState
          icon="images-outline"
          title="Burası boş"
          subtitle="Kamera düğmesiyle ilk fotoğrafını veya videonu çek. Çekilenler cihaz galerisine hiç düşmeden şifrelenir."
        />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          numColumns={COLUMNS}
          columnWrapperStyle={{ gap: GAP }}
          contentContainerStyle={{ gap: GAP, paddingBottom: 96 }}
          renderItem={({ item }) => (
            <ThumbTile item={item} size={tileSize} onPress={() => router.push(`/media/${item.id}`)} />
          )}
        />
      )}
      <Pressable style={styles.fab} onPress={() => router.push('/camera')}>
        <Ionicons name="camera" size={28} color={colors.bg} />
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  title: { color: colors.text, fontSize: 30, fontWeight: '700' },
  count: { color: colors.textDim, fontSize: 14 },
  fab: {
    position: 'absolute',
    right: spacing.lg,
    bottom: spacing.lg,
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
});
