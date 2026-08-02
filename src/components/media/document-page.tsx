/**
 * One document in the pager.
 *
 * Like video, nothing decrypts until asked: a 400 MB PDF must not be written
 * to disk because the user swiped past it. Once opened, the plaintext lives in
 * `<cache>/decrypted/` — the one directory invariant #2 permits — and is wiped
 * on lock and on cold start, exactly as video temps are.
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Pdf from 'react-native-pdf';

import type { MediaItem } from '../../lib/db/media-repo';
import { decryptVideoToTemp, deleteDecryptedTemp } from '../../lib/media/viewer-cache';
import { requireCtx, useSession } from '../../stores/session';
import { colors, formatBytes, radius, spacing } from '../../theme';

interface DocumentPageProps {
  item: MediaItem;
  originalName: string;
  active: boolean;
}

export function DocumentPage({ item, originalName, active }: DocumentPageProps) {
  const { width } = useWindowDimensions();
  const [uri, setUri] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    if (!uri) return;
    return () => deleteDecryptedTemp(uri);
  }, [uri]);

  const isPdf = item.mime.includes('pdf');
  const shown = active ? uri : null;

  const open = () => {
    if (opening || uri) return;
    setOpening(true);
    setProgress(0);
    const release = useSession.getState().beginBusy();
    // Reuses the video path deliberately: it streams to a temp file rather
    // than pulling the whole thing through memory as the photo path does.
    void decryptVideoToTemp(requireCtx().dek, item, (p) =>
      setProgress(p.totalBytes > 0 ? p.processedBytes / p.totalBytes : null),
    )
      .then(setUri)
      .catch(() => setFailed(true))
      .finally(() => {
        release();
        setOpening(false);
        setProgress(null);
      });
  };

  if (shown && isPdf) {
    return (
      <View style={[styles.page, { width }]}>
        <Pdf source={{ uri: shown }} style={StyleSheet.absoluteFill} trustAllCerts={false} />
      </View>
    );
  }

  return (
    <View style={[styles.page, { width }]}>
      <Ionicons name={isPdf ? 'document-text-outline' : 'document-outline'} size={64} color={colors.textDim} />
      <Text style={styles.name} numberOfLines={2}>
        {originalName || 'Belge'}
      </Text>
      <Text style={styles.meta}>{formatBytes(item.sizeBytes)}</Text>

      {failed ? (
        <Text style={styles.meta}>Bu belge açılamadı.</Text>
      ) : isPdf ? (
        <Pressable
          style={styles.openButton}
          onPress={open}
          disabled={opening}
          accessibilityRole="button"
          accessibilityLabel="Belgeyi aç"
        >
          {opening ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.openText}>Aç</Text>}
        </Pressable>
      ) : (
        // Anything we cannot render in-app has to leave the vault to be read,
        // which is what the share confirm is for.
        <Text style={styles.meta}>Bu tür uygulama içinde açılamıyor. Okumak için dışa aktar.</Text>
      )}
      {progress != null && <Text style={styles.meta}>%{Math.round(progress * 100)}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.lg },
  name: { color: colors.text, fontSize: 16, fontWeight: '600', textAlign: 'center' },
  meta: { color: colors.textDim, fontSize: 13, textAlign: 'center' },
  openButton: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
  },
  openText: { color: colors.bg, fontSize: 15, fontWeight: '600' },
});
