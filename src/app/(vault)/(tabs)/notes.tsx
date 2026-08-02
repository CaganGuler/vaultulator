import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/empty-state';
import { useNotes } from '@/hooks/use-notes';
import { colors, formatDate, radius, spacing } from '@/theme';

export default function NotesScreen() {
  const { notes, loading, error } = useNotes();
  const [query, setQuery] = useState('');

  // Titles are already decrypted in memory by listNotes, so filtering costs
  // nothing. Bodies are not: searching those would mean decrypting every note
  // on every keystroke, so this deliberately searches titles only.
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('tr-TR');
    if (!needle) return notes;
    return notes.filter((n) => n.title.toLocaleLowerCase('tr-TR').includes(needle));
  }, [notes, query]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Notlar</Text>
      </View>
      {notes.length > 0 && (
        <View style={styles.searchBox}>
          <Ionicons name="search" size={16} color={colors.textDim} />
          <TextInput
            style={styles.searchInput}
            placeholder="Başlıklarda ara"
            placeholderTextColor={colors.textDim}
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Notlarda ara"
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery('')} accessibilityRole="button" accessibilityLabel="Aramayı temizle">
              <Ionicons name="close-circle" size={16} color={colors.textDim} />
            </Pressable>
          )}
        </View>
      )}
      {error ? (
        <EmptyState icon="alert-circle-outline" title="Yüklenemedi" subtitle="Notlar okunamadı. Kilitleyip tekrar açmayı dene." />
      ) : !loading && notes.length === 0 ? (
        <EmptyState
          icon="document-lock-outline"
          title="Henüz not yok"
          subtitle="Notların başlıklarıyla birlikte şifrelenir; veritabanı dosyasını açan biri bile okuyamaz."
        />
      ) : !loading && visible.length === 0 ? (
        <EmptyState icon="search-outline" title="Eşleşen not yok" subtitle="Farklı bir arama dene." />
      ) : (
        <FlatList
          data={visible}
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
      <Pressable
        style={styles.fab}
        onPress={() => router.push('/note/new')}
        accessibilityRole="button"
        accessibilityLabel="Yeni not"
      >
        <Ionicons name="add" size={30} color={colors.bg} />
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
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
