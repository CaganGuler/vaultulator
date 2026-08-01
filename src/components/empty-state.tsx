import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing } from '../theme';

interface EmptyStateProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
}

export function EmptyState({ icon, title, subtitle }: EmptyStateProps) {
  return (
    <View style={styles.container}>
      <Ionicons name={icon} size={48} color={colors.textDim} />
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl },
  title: { color: colors.text, fontSize: 17, fontWeight: '600', marginTop: spacing.sm },
  subtitle: { color: colors.textDim, fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
