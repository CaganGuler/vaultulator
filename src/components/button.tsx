import { ActivityIndicator, Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';

import { colors, radius, spacing } from '../theme';

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'danger' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}

export function Button({ title, onPress, variant = 'primary', disabled, loading, style }: ButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        variant === 'primary' && styles.primary,
        variant === 'danger' && styles.danger,
        variant === 'ghost' && styles.ghost,
        (pressed || isDisabled) && styles.dimmed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? colors.bg : colors.text} />
      ) : (
        <Text
          style={[
            styles.text,
            variant === 'primary' && styles.textOnAccent,
            variant === 'danger' && styles.textDanger,
          ]}
        >
          {title}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: { backgroundColor: colors.accent },
  danger: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.danger },
  ghost: { backgroundColor: colors.surface },
  dimmed: { opacity: 0.6 },
  text: { color: colors.text, fontSize: 16, fontWeight: '600' },
  textOnAccent: { color: colors.bg },
  textDanger: { color: colors.danger },
});
