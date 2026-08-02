import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { ProgressOverlay } from '@/components/progress-overlay';
import { ingestCapturedPhoto, ingestCapturedVideo } from '@/lib/media/capture';
import { requireCtx, SessionChangedError, useSession } from '@/stores/session';
import { colors, radius, spacing } from '@/theme';

type CaptureMode = 'picture' | 'video';

export default function CameraScreen() {
  const cameraRef = useRef<CameraView>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();
  const [mode, setMode] = useState<CaptureMode>('picture');
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);

  useEffect(() => {
    if (!recording) return;
    const interval = setInterval(() => setRecordSeconds((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, [recording]);

  if (!cameraPermission?.granted) {
    return (
      <SafeAreaView style={styles.permissionContainer}>
        <Ionicons name="camera-outline" size={48} color={colors.textDim} />
        <Text style={styles.permissionText}>
          Çekim yapabilmek için kamera izni gerekiyor. Görüntüler yalnızca uygulama içinde, şifreli saklanır.
        </Text>
        <Button title="Kamera iznini ver" onPress={() => void requestCameraPermission()} />
        <Button title="Vazgeç" variant="ghost" onPress={() => router.back()} />
      </SafeAreaView>
    );
  }

  /**
   * Ingest holds the session context across minutes of encryption, so it is
   * marked busy: the idle timer must not lock and zeroize those buffers
   * mid-write. Deliberate locks still apply, and ingest re-checks the session
   * before committing, so the worst case is a clean abort rather than an item
   * that silently belongs to no vault.
   */
  const runIngest = async (work: (ctx: ReturnType<typeof requireCtx>) => Promise<void>) => {
    const release = useSession.getState().beginBusy();
    setSaving(true);
    try {
      await work(requireCtx());
      router.back();
    } finally {
      release();
      setSaving(false);
      setProgress(null);
    }
  };

  const takePhoto = async () => {
    const camera = cameraRef.current;
    if (!camera || saving) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const photo = await camera.takePictureAsync({ exif: false });
    setProgress(null);
    await runIngest(async (ctx) => {
      await ingestCapturedPhoto({ ctx, sourceUri: photo.uri, width: photo.width, height: photo.height });
    });
  };

  const toggleRecording = async () => {
    const camera = cameraRef.current;
    if (!camera || saving) return;
    if (recording) {
      camera.stopRecording();
      return;
    }
    if (!micPermission?.granted) {
      const result = await requestMicPermission();
      if (!result.granted) return; // sessiz video istemiyoruz; izin şart
    }
    setRecordSeconds(0);
    setRecording(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    let video: { uri: string } | undefined;
    try {
      video = await camera.recordAsync();
    } finally {
      setRecording(false);
    }
    if (!video?.uri) return;
    setProgress(0);
    const uri = video.uri;
    await runIngest(async (ctx) => {
      await ingestCapturedVideo({
        ctx,
        sourceUri: uri,
        onProgress: (p) => setProgress(p.totalBytes > 0 ? p.processedBytes / p.totalBytes : null),
      });
    });
  };

  /** Nothing below may reject silently — a lost capture must be visible. */
  const runCapture = (work: () => Promise<void>) => {
    void work().catch((e: unknown) => {
      Alert.alert(
        'Kaydedilemedi',
        e instanceof SessionChangedError
          ? 'Kasa işlem sırasında kilitlendi, çekim kaydedilmedi. Tekrar dene.'
          : 'Çekim kaydedilemedi. Cihazda yer kalmamış olabilir.',
      );
    });
  };

  const formattedTimer = `${String(Math.floor(recordSeconds / 60)).padStart(2, '0')}:${String(recordSeconds % 60).padStart(2, '0')}`;

  return (
    <View style={styles.container}>
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing={facing} mode={mode} />
      <SafeAreaView style={styles.controls}>
        <View style={styles.topRow}>
          <Pressable
            style={styles.iconButton}
            onPress={() => router.back()}
            disabled={recording}
            accessibilityRole="button"
            accessibilityLabel="Kapat"
          >
            <Ionicons name="close" size={26} color={colors.text} />
          </Pressable>
          {recording && (
            <View style={styles.timerBadge}>
              <View style={styles.recDot} />
              <Text style={styles.timerText}>{formattedTimer}</Text>
            </View>
          )}
          <Pressable
            style={styles.iconButton}
            onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))}
            disabled={recording}
            accessibilityRole="button"
            accessibilityLabel="Ön/arka kamera değiştir"
          >
            <Ionicons name="camera-reverse-outline" size={26} color={colors.text} />
          </Pressable>
        </View>
        <View style={styles.bottomArea}>
          {!recording && (
            <View style={styles.modeRow}>
              {(['picture', 'video'] as const).map((m) => (
                <Pressable key={m} onPress={() => setMode(m)}>
                  <Text style={[styles.modeText, mode === m && styles.modeTextActive]}>
                    {m === 'picture' ? 'FOTOĞRAF' : 'VİDEO'}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
          <Pressable
            onPress={() => runCapture(mode === 'picture' ? takePhoto : toggleRecording)}
            style={[styles.shutter, mode === 'video' && styles.shutterVideo]}
            accessibilityRole="button"
            accessibilityLabel={
              mode === 'picture' ? 'Fotoğraf çek' : recording ? 'Kaydı durdur' : 'Video kaydını başlat'
            }
          >
            {mode === 'video' && <View style={[styles.shutterInner, recording && styles.shutterInnerRecording]} />}
          </Pressable>
        </View>
      </SafeAreaView>
      <ProgressOverlay
        visible={saving}
        label={mode === 'picture' ? 'Fotoğraf şifreleniyor…' : 'Video şifreleniyor…'}
        progress={progress}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  permissionContainer: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'stretch',
    justifyContent: 'center',
    padding: spacing.lg,
    gap: spacing.md,
  },
  permissionText: { color: colors.textDim, fontSize: 15, textAlign: 'center', lineHeight: 22 },
  controls: { flex: 1, justifyContent: 'space-between' },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  timerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.full,
  },
  recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.danger },
  timerText: { color: colors.text, fontVariant: ['tabular-nums'], fontSize: 15 },
  bottomArea: { alignItems: 'center', gap: spacing.md, paddingBottom: spacing.lg },
  modeRow: { flexDirection: 'row', gap: spacing.lg },
  modeText: { color: colors.textDim, fontSize: 13, fontWeight: '600', letterSpacing: 1 },
  modeTextActive: { color: colors.accent },
  shutter: {
    width: 74,
    height: 74,
    borderRadius: radius.full,
    borderWidth: 4,
    borderColor: '#fff',
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterVideo: { backgroundColor: 'transparent' },
  shutterInner: { width: 30, height: 30, borderRadius: radius.full, backgroundColor: colors.danger },
  shutterInnerRecording: { borderRadius: 6, width: 26, height: 26 },
});
