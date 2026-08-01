import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/empty-state';
import { useNotes } from '@/hooks/use-notes';
import { colors, formatDate, radius, spacing } from '@/theme';

export default function NotesScreen() {
  const { notes, loading } = useNotes();

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Notlar</Text>
      </View>
      {!loading && notes.length === 0 ? (
        <EmptyState
          icon="document-lock-outline"
          title="Henüz not yok"
          subtitle="Notların başlıklarıyla birlikte şifrelenir; veritabanı dosyasını açan biri bile okuyamaz."
        />
      ) : (
        <FlatList
          data={notes}
          keyExtractor={(note) => note.id}
          contentContainerStyle={{ paddingHorizontal: spacing.md, paddingBottom: 96, gap: spacing.sm }}
          renderItem={({ item }) => (
            <Pressable style={styles.row} onPress={() => router.push(`/note/${item.id}`)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {item.title || 'Başlıksız not'}
                </Text>
                <Text style={styles.rowDate}>{formatDate(item.updatedAt)}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
            </Pressable>
          )}
        />
      )}
      <Pressable style={styles.fab} onPress={() => router.push('/note/new')}>
        <Ionicons name="add" size={30} color={colors.bg} />
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  title: { color: colors.text, fontSize: 30, fontWeight: '700' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  rowTitle: { color: colors.text, fontSize: 16, fontWeight: '600' },
  rowDate: { color: colors.textDim, fontSize: 12, marginTop: 2 },
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
