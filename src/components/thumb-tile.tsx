import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { MediaItem } from '../lib/db/media-repo';
import { useThumbnail } from '../hooks/use-thumbnail';
import { colors, formatDate, formatDuration } from '../theme';

interface ThumbTileProps {
  item: MediaItem;
  size: number;
  onPress: () => void;
  onLongPress?: () => void;
  selecting?: boolean;
  selected?: boolean;
}

export function ThumbTile({ item, size, onPress, onLongPress, selecting, selected }: ThumbTileProps) {
  const uri = useThumbnail(item);
  const kind = item.type === 'video' ? 'Video' : item.type === 'document' ? 'Belge' : 'Fotoğraf';
  const length = item.type === 'video' && item.durationMs != null ? `, ${formatDuration(item.durationMs)}` : '';
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={[styles.tile, { width: size, height: size }, selected && styles.tileSelected]}
      accessibilityRole={selecting ? 'checkbox' : 'imagebutton'}
      accessibilityState={selecting ? { checked: selected } : undefined}
      accessibilityLabel={`${kind}${length}, ${formatDate(item.createdAt)}`}
    >
      {/* Decrypted plaintext below: memory-only, never persisted (invariant #2). */}
      {item.type === 'document' ? (
        // Documents have no thumbnail: rendering a PDF's first page needs a
        // native rasteriser, and putting secret content through one to make a
        // preview is not a trade worth taking.
        <View style={styles.documentTile}>
          <Ionicons name="document-text-outline" size={Math.min(36, size / 3)} color={colors.textDim} />
        </View>
      ) : uri ? (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={120}
          cachePolicy="memory"
        />
      ) : (
        <View style={styles.placeholder} />
      )}
      {item.type === 'video' && !selecting && (
        <View style={styles.badge}>
          <Ionicons name="play" size={12} color={colors.text} />
          {item.durationMs != null && <Text style={styles.badgeText}>{formatDuration(item.durationMs)}</Text>}
        </View>
      )}
      {selecting && (
        <View style={[styles.check, selected && styles.checkOn]}>
          {selected && <Ionicons name="checkmark" size={14} color={colors.bg} />}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: { backgroundColor: colors.surface, overflow: 'hidden', borderRadius: 4 },
  tileSelected: { opacity: 0.6 },
  documentTile: { flex: 1, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  check: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    width: 22,
    height: 22,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: colors.text,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  placeholder: { flex: 1, backgroundColor: colors.surfaceAlt },
  badge: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 999,
    paddingVertical: 3,
    paddingHorizontal: 6,
  },
  badgeText: { color: colors.text, fontSize: 11, fontVariant: ['tabular-nums'] },
});
