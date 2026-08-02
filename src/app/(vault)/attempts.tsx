/**
 * Failed-unlock history.
 *
 * Primary session only — see docs/SECURITY.md for why that gate is a UI
 * decision rather than a cryptographic one.
 */
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/empty-state';
import { clearFailedAttemptLog, getFailedAttemptLog, LOG_CAPACITY } from '@/lib/crypto/keys';
import { useIsPrimary } from '@/stores/session';
import { colors, formatDate, radius, spacing } from '@/theme';

export default function AttemptsScreen() {
  const isPrimary = useIsPrimary();
  const [stamps, setStamps] = useState<number[] | null>(null);

  const refresh = useCallback(() => {
    void getFailedAttemptLog()
      .then((log) => setStamps([...log].reverse()))
      .catch(() => setStamps([]));
  }, []);

  useEffect(refresh, [refresh]);

  const confirmClear = () => {
    Alert.alert('Geçmişi temizle', 'Kayıtlı başarısız deneme zamanları silinecek.', [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Temizle',
        style: 'destructive',
        onPress: () => {
          void clearFailedAttemptLog()
            .then(refresh)
            .catch(() => Alert.alert('Hata', 'Temizlenemedi.'));
        },
      },
    ]);
  };

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
        <Text style={styles.title}>Başarısız denemeler</Text>
        {stamps && stamps.length > 0 && (
          <Pressable
            style={styles.iconButton}
            onPress={confirmClear}
            accessibilityRole="button"
            accessibilityLabel="Geçmişi temizle"
          >
            <Ionicons name="trash-outline" size={20} color={colors.danger} />
          </Pressable>
        )}
      </View>

      {!isPrimary || (stamps && stamps.length === 0) ? (
        <EmptyState
          icon="shield-checkmark-outline"
          title="Kayıt yok"
          subtitle="Yanlış PIN girilen bir zaman kaydedilmemiş."
        />
      ) : (
        <FlatList
          data={stamps ?? []}
          keyExtractor={(stamp, i) => `${stamp}-${i}`}
          contentContainerStyle={{ paddingHorizontal: spacing.md, paddingBottom: spacing.lg, gap: spacing.xs }}
          ListHeaderComponent={
            <Text style={styles.intro}>
              Kasa kilitliyken girilen yanlış PIN&apos;lerin zamanı. Son {LOG_CAPACITY} deneme saklanır; daha eskiler
              düşer.
            </Text>
          }
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Ionicons name="close-circle-outline" size={18} color={colors.danger} />
              <Text style={styles.rowText}>{formatDate(item)}</Text>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm },
  title: { color: colors.text, fontSize: 20, fontWeight: '700', flex: 1 },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  intro: { color: colors.textDim, fontSize: 13, lineHeight: 19, paddingVertical: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  rowText: { color: colors.text, fontSize: 15 },
});
