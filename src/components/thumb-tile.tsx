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
}

export function ThumbTile({ item, size, onPress }: ThumbTileProps) {
  const uri = useThumbnail(item);
  return (
    <Pressable
      onPress={onPress}
      style={[styles.tile, { width: size, height: size }]}
      accessibilityRole="imagebutton"
      accessibilityLabel={`${item.type === 'video' ? 'Video' : 'Fotoğraf'}, ${formatDate(item.createdAt)}`}
    >
      {uri ? (
        <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={120} />
      ) : (
        <View style={styles.placeholder} />
      )}
      {item.type === 'video' && (
        <View style={styles.badge}>
          <Ionicons name="play" size={14} color={colors.text} />
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: { backgroundColor: colors.surface, overflow: 'hidden', borderRadius: 4 },
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
