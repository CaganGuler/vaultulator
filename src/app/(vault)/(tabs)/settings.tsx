import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getFailedAttemptLog } from '@/lib/crypto/keys';
import { getVaultStats, type VaultStats } from '@/lib/db/media-repo';
import { countNotes } from '@/lib/db/notes-repo';
import { requireCtx, useIsPrimary, useSession } from '@/stores/session';
import { AUTO_LOCK_OPTIONS, INACTIVITY_OPTIONS, useSettings } from '@/stores/settings';
import { colors, formatBytes, radius, spacing } from '@/theme';

export default function SettingsScreen() {
  const autoLockSeconds = useSettings((s) => s.autoLockSeconds);
  const inactivitySeconds = useSettings((s) => s.inactivitySeconds);
  // The ONLY role question the UI may ask. A decoy session and a post-duress
  // session must render byte-identical screens.
  const isPrimary = useIsPrimary();
  const [stats, setStats] = useState<VaultStats | null>(null);
  const [noteCount, setNoteCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);

  useFocusEffect(
    useCallback(() => {
      const ctx = requireCtx();
      void getVaultStats(ctx)
        .then(setStats)
        .catch(() => setStats(null));
      void countNotes(ctx)
        .then(setNoteCount)
        .catch(() => setNoteCount(0));
      if (isPrimary) {
        void getFailedAttemptLog()
          .then((log) => setFailedCount(log.length))
          .catch(() => setFailedCount(0));
      }
    }, [isPrimary]),
  );

  // Identical copy and identical flow in both sessions. Only the outcome
  // differs: a decoy session wipes its own rows and files and stays unlocked on
  // an empty vault — a self-consistent "I deleted everything" story that leaves
  // the real vault untouched.
  const confirmDestroy = () => {
    Alert.alert('Kasayı sıfırla', 'TÜM fotoğraflar, videolar ve notlar kalıcı olarak silinecek. Bu işlem geri alınamaz.', [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Devam',
        style: 'destructive',
        onPress: () =>
          Alert.alert('Emin misin?', 'Son onay: kasadaki her şey geri getirilemez şekilde yok edilecek.', [
            { text: 'Vazgeç', style: 'cancel' },
            {
              text: 'Her şeyi sil',
              style: 'destructive',
              onPress: () => {
                const session = useSession.getState();
                if (isPrimary) {
                  // Unmounts this screen: status flips to 'uninitialized'.
                  void session.destroy().catch(() => Alert.alert('Hata', 'Silinemedi.'));
                  return;
                }
                void session
                  .wipeOwnContent()
                  .then(() => {
                    setStats({
                      photoCount: 0,
                      videoCount: 0,
                      documentCount: 0,
                      totalBytes: 0,
                      bytesByType: { photo: 0, video: 0, document: 0 },
                    });
                    setNoteCount(0);
                  })
                  .catch(() => Alert.alert('Hata', 'Silinemedi.'));
              },
            },
          ]),
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.lg }}>
        <Text style={styles.title}>Ayarlar</Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>GÜVENLİK</Text>
          <Pressable style={styles.row} onPress={() => router.push('/change-pin')}>
            <Ionicons name="key-outline" size={20} color={colors.text} />
            <Text style={styles.rowText}>PIN değiştir</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
          </Pressable>
          <Pressable style={styles.row} onPress={() => useSession.getState().lock()}>
            <Ionicons name="lock-closed-outline" size={20} color={colors.text} />
            <Text style={styles.rowText}>Şimdi kilitle</Text>
          </Pressable>
          {isPrimary && (
            <>
              <Pressable style={styles.row} onPress={() => router.push('/decoy')}>
                <Ionicons name="albums-outline" size={20} color={colors.text} />
                <Text style={styles.rowText}>Yem kasa</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
              </Pressable>
              <Pressable style={styles.row} onPress={() => router.push('/attempts')}>
                <Ionicons name="time-outline" size={20} color={colors.text} />
                <Text style={styles.rowText}>Başarısız denemeler</Text>
                {failedCount > 0 && <Text style={styles.rowValue}>{failedCount}</Text>}
                <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
              </Pressable>
            </>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>OTOMATİK KİLİT (ARKA PLANA GEÇİNCE)</Text>
          {AUTO_LOCK_OPTIONS.map((option) => (
            <Pressable
              key={option.seconds}
              style={styles.row}
              onPress={() =>
                void useSettings
                  .getState()
                  .setAutoLockSeconds(option.seconds)
                  .catch(() => Alert.alert('Hata', 'Ayar kaydedilemedi.'))
              }
            >
              <Text style={styles.rowText}>{option.label}</Text>
              {autoLockSeconds === option.seconds && <Ionicons name="checkmark" size={20} color={colors.accent} />}
            </Pressable>
          ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>HAREKETSİZLİK KİLİDİ (UYGULAMA AÇIKKEN)</Text>
          {INACTIVITY_OPTIONS.map((option) => (
            <Pressable
              key={option.seconds}
              style={styles.row}
              onPress={() =>
                void useSettings
                  .getState()
                  .setInactivitySeconds(option.seconds)
                  .catch(() => Alert.alert('Hata', 'Ayar kaydedilemedi.'))
              }
            >
              <Text style={styles.rowText}>{option.label}</Text>
              {inactivitySeconds === option.seconds && <Ionicons name="checkmark" size={20} color={colors.accent} />}
            </Pressable>
          ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>KASA</Text>
          <View style={styles.row}>
            <Ionicons name="stats-chart-outline" size={20} color={colors.text} />
            <Text style={styles.rowText}>
              {stats
                ? `${stats.photoCount} fotoğraf · ${stats.videoCount} video · ${stats.documentCount} belge · ${noteCount} not`
                : '…'}
            </Text>
            <Text style={styles.rowValue}>{stats ? formatBytes(stats.totalBytes) : ''}</Text>
          </View>
          {stats &&
            (['photo', 'video', 'document'] as const)
              .filter((type) => stats.bytesByType[type] > 0)
              .map((type) => (
                <View key={type} style={styles.row}>
                  <Text style={styles.rowText}>
                    {type === 'photo' ? 'Fotoğraflar' : type === 'video' ? 'Videolar' : 'Belgeler'}
                  </Text>
                  <Text style={styles.rowValue}>{formatBytes(stats.bytesByType[type])}</Text>
                </View>
              ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>TEHLİKELİ BÖLGE</Text>
          <Pressable style={styles.row} onPress={confirmDestroy}>
            <Ionicons name="trash-outline" size={20} color={colors.danger} />
            <Text style={[styles.rowText, { color: colors.danger }]}>Kasayı sıfırla (her şeyi sil)</Text>
          </Pressable>
        </View>

        <Text style={styles.footnote}>
          Tüm içerik yalnızca bu cihazda, AES-256-GCM ile şifreli saklanır. PIN unutulursa veriler kurtarılamaz;
          cihaz yedeğinden de geri gelmez.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  title: { color: colors.text, fontSize: 30, fontWeight: '700' },
  section: { backgroundColor: colors.surface, borderRadius: radius.md, overflow: 'hidden' },
  sectionTitle: {
    color: colors.textDim,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.6,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  rowText: { color: colors.text, fontSize: 15, flex: 1 },
  rowValue: { color: colors.textDim, fontSize: 14 },
  footnote: { color: colors.textDim, fontSize: 12, lineHeight: 18, textAlign: 'center', paddingHorizontal: spacing.md },
});
