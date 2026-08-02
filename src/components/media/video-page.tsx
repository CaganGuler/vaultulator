/**
 * One video in the pager.
 *
 * Nothing decrypts until the user presses play. decryptVideoToTemp writes the
 * whole file to disk before the first frame, so swiping past a 500 MB video
 * must not start that — the poster is the grid thumbnail, which is already
 * decrypted and cached.
 */
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEventListener } from 'expo';
import { useKeepAwake } from 'expo-keep-awake';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { setDurationMs, type MediaItem } from '../../lib/db/media-repo';
import { decryptVideoToTemp, deleteDecryptedTemp } from '../../lib/media/viewer-cache';
import { requireCtx, useSession } from '../../stores/session';
import { colors, radius } from '../../theme';

interface VideoPageProps {
  item: MediaItem;
  placeholderUri: string | null;
  /** False while this page is off-screen; playback tears down when it flips. */
  active: boolean;
}

export function VideoPage({ item, placeholderUri, active }: VideoPageProps) {
  const { width } = useWindowDimensions();
  const [uri, setUri] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [busyDecrypting, setBusyDecrypting] = useState(false);

  // Swiping away unmounts the player but keeps the temp file, so swiping back
  // is instant. The plaintext goes when the page leaves the render window, and
  // in any case when the vault locks.
  useEffect(() => {
    if (!uri) return;
    return () => deleteDecryptedTemp(uri);
  }, [uri]);

  const shown = active ? uri : null;

  const start = () => {
    if (busyDecrypting || uri) return;
    setBusyDecrypting(true);
    setProgress(0);
    const release = useSession.getState().beginBusy();
    void decryptVideoToTemp(requireCtx().dek, item, (p) =>
      setProgress(p.totalBytes > 0 ? p.processedBytes / p.totalBytes : null),
    )
      .then(setUri)
      .catch(() => setFailed(true))
      .finally(() => {
        release();
        setBusyDecrypting(false);
        setProgress(null);
      });
  };

  if (failed) {
    return (
      <View style={[styles.page, { width }]}>
        <Text style={styles.stateText}>Bu video açılamadı.</Text>
      </View>
    );
  }

  if (shown) return <PlayingVideo uri={shown} width={width} item={item} />;

  return (
    <View style={[styles.page, { width }]}>
      {placeholderUri && (
        <Image
          source={{ uri: placeholderUri }}
          style={StyleSheet.absoluteFill}
          contentFit="contain"
          cachePolicy="memory"
        />
      )}
      <Pressable
        style={styles.playButton}
        onPress={start}
        disabled={busyDecrypting}
        accessibilityRole="button"
        accessibilityLabel="Videoyu oynat"
      >
        {busyDecrypting ? (
          <ActivityIndicator color={colors.bg} />
        ) : (
          <Ionicons name="play" size={30} color={colors.bg} />
        )}
      </Pressable>
      {progress != null && <Text style={styles.progress}>%{Math.round(progress * 100)}</Text>}
    </View>
  );
}

/**
 * `busy` is held only while playback is actually running — never for as long
 * as the screen is open, which would be an unbounded way to stop the vault
 * locking. A leaked releaser means it never idle-locks again, so the unmount
 * cleanup releases unconditionally.
 */
function PlayingVideo({ uri, width, item }: { uri: string; width: number; item: MediaItem }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
    p.play();
  });

  useKeepAwake();

  // Rows ingested before durations were recorded get theirs the first time
  // they are watched. Fire and forget: a missing length is cosmetic.
  useEventListener(player, 'sourceLoad', ({ duration }) => {
    if (item.durationMs != null || !duration) return;
    void setDurationMs(requireCtx(), item.id, duration * 1000).catch(() => undefined);
  });

  const release = useRef<(() => void) | null>(null);
  useEventListener(player, 'playingChange', ({ isPlaying }) => {
    if (isPlaying) {
      release.current ??= useSession.getState().beginBusy();
      return;
    }
    release.current?.();
    release.current = null;
  });

  useEffect(
    () => () => {
      release.current?.();
      release.current = null;
    },
    [],
  );

  return (
    <View style={[styles.page, { width }]}>
      <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  playButton: {
    width: 72,
    height: 72,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progress: { color: colors.text, marginTop: 12, fontSize: 13 },
  stateText: { color: colors.textDim, fontSize: 14 },
});
