import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ProgressOverlay } from '@/components/progress-overlay';
import { deleteMediaItem, getMediaItem, type MediaItem } from '@/lib/db/media-repo';
import { shareMediaItem } from '@/lib/media/share';
import { decryptVideoToTemp, deleteDecryptedTemp, getPhotoDataUri } from '@/lib/media/viewer-cache';
import { requireCtx } from '@/stores/session';
import { colors, formatBytes, formatDate, radius, spacing } from '@/theme';

export default function MediaViewer() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [item, setItem] = useState<MediaItem | null>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [decryptProgress, setDecryptProgress] = useState<number | null>(null);
  const [decrypting, setDecrypting] = useState(true);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let tempUri: string | null = null;
    void (async () => {
      const ctx = requireCtx();
      const loaded = await getMediaItem(ctx, id);
      if (!loaded || cancelled) return;
      setItem(loaded);
      const { dek } = ctx;
      if (loaded.type === 'photo') {
        const uri = await getPhotoDataUri(dek, loaded);
        if (!cancelled) setPhotoUri(uri);
      } else {
        const uri = await decryptVideoToTemp(dek, loaded, (p) =>
          setDecryptProgress(p.totalBytes > 0 ? p.processedBytes / p.totalBytes : null),
        );
        tempUri = uri;
        if (!cancelled) setVideoUri(uri);
        else deleteDecryptedTemp(uri);
      }
      if (!cancelled) setDecrypting(false);
    })().catch(() => {
      if (!cancelled) {
        setDecrypting(false);
        Alert.alert('Hata', 'İçerik açılamadı.');
      }
    });
    return () => {
      cancelled = true;
      if (tempUri) deleteDecryptedTemp(tempUri);
    };
  }, [id]);

  const confirmShare = () => {
    if (!item) return;
    Alert.alert('Kasadan dışarı paylaş', 'Bu içerik şifresi çözülerek kasanın DIŞINA paylaşılacak. Emin misin?', [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Paylaş',
        style: 'destructive',
        onPress: () => {
          setSharing(true);
          const { dek } = requireCtx();
          void shareMediaItem(dek, item)
            .catch(() => Alert.alert('Hata', 'Paylaşım başarısız oldu.'))
            .finally(() => setSharing(false));
        },
      },
    ]);
  };

  const confirmDelete = () => {
    if (!item) return;
    Alert.alert('Kalıcı olarak sil', 'Bu içerik geri getirilemez şekilde silinecek.', [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Sil',
        style: 'destructive',
        onPress: () => {
          void deleteMediaItem(requireCtx(), item).then(() => router.back());
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      {item?.type === 'photo' && photoUri && (
        <Image source={{ uri: photoUri }} style={StyleSheet.absoluteFill} contentFit="contain" />
      )}
      {item?.type === 'video' && videoUri && <VideoPlayerView uri={videoUri} />}
      {decrypting && item?.type !== 'video' && (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      )}
      <SafeAreaView style={styles.chrome} pointerEvents="box-none">
        <View style={styles.topRow}>
          <Pressable style={styles.iconButton} onPress={() => router.back()}>
            <Ionicons name="close" size={24} color={colors.text} />
          </Pressable>
          {item && (
            <Text style={styles.meta}>
              {formatDate(item.createdAt)} · {formatBytes(item.sizeBytes)}
            </Text>
          )}
        </View>
        <View style={styles.bottomRow}>
          <Pressable style={styles.iconButton} onPress={confirmShare} disabled={decrypting || sharing}>
            <Ionicons name="share-outline" size={24} color={colors.text} />
          </Pressable>
          <Pressable style={styles.iconButton} onPress={confirmDelete}>
            <Ionicons name="trash-outline" size={24} color={colors.danger} />
          </Pressable>
        </View>
      </SafeAreaView>
      <ProgressOverlay
        visible={decrypting && item?.type === 'video'}
        label="Videonun şifresi çözülüyor…"
        progress={decryptProgress}
      />
      <ProgressOverlay visible={sharing} label="Paylaşım için hazırlanıyor…" progress={null} />
    </View>
  );
}

function VideoPlayerView({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
    p.play();
  });
  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls />;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  loading: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  chrome: { flex: 1, justifyContent: 'space-between' },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  meta: { color: colors.textDim, fontSize: 13 },
  bottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingBottom: spacing.md,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
