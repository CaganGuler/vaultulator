import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '../theme';

interface ProgressOverlayProps {
  visible: boolean;
  label: string;
  /** 0..1, or null for indeterminate. */
  progress: number | null;
}

export function ProgressOverlay({ visible, label, progress }: ProgressOverlayProps) {
  if (!visible) return null;
  return (
    <View style={styles.backdrop} pointerEvents="auto">
      <View style={styles.card}>
        <Text style={styles.label}>{label}</Text>
        <View style={styles.track}>
          <View
            style={[
              styles.fill,
              progress == null ? styles.fillIndeterminate : { width: `${Math.round(progress * 100)}%` },
            ]}
          />
        </View>
        {progress != null && <Text style={styles.percent}>%{Math.round(progress * 100)}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 500,
  },
  card: {
    width: '78%',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    alignItems: 'center',
  },
  label: { color: colors.text, fontSize: 15, fontWeight: '600' },
  track: { alignSelf: 'stretch', height: 6, borderRadius: 3, backgroundColor: colors.surfaceAlt, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: colors.accent, borderRadius: 3 },
  fillIndeterminate: { width: '40%' },
  percent: { color: colors.textDim, fontSize: 13 },
});
