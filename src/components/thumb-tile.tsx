import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, View } from 'react-native';

import type { MediaItem } from '../lib/db/media-repo';
import { useThumbnail } from '../hooks/use-thumbnail';
import { colors, formatDate } from '../theme';

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
  const kind = item.type === 'video' ? 'Video' : 'Fotoğraf';
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={[styles.tile, { width: size, height: size }, selected && styles.tileSelected]}
      accessibilityRole={selecting ? 'checkbox' : 'imagebutton'}
      accessibilityState={selecting ? { checked: selected } : undefined}
      accessibilityLabel={`${kind}, ${formatDate(item.createdAt)}`}
    >
      {uri ? (
        <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={120} />
      ) : (
        <View style={styles.placeholder} />
      )}
      {item.type === 'video' && !selecting && (
        <View style={styles.badge}>
          <Ionicons name="play" size={14} color={colors.text} />
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
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 999,
    padding: 4,
  },
});
