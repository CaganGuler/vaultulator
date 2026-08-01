import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '../theme';

export const PIN_LENGTH = 6;

interface PinPadProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Increment to trigger the error shake + clear. */
  errorSignal?: number;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'back'] as const;

export function PinPad({ value, onChange, disabled, errorSignal }: PinPadProps) {
  const [shake] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!errorSignal) return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    Animated.sequence(
      [12, -12, 8, -8, 4, 0].map((toValue) =>
        Animated.timing(shake, { toValue, duration: 50, useNativeDriver: true }),
      ),
    ).start();
  }, [errorSignal, shake]);

  const press = (key: (typeof KEYS)[number]) => {
    if (disabled || key === '') return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (key === 'back') {
      onChange(value.slice(0, -1));
    } else if (value.length < PIN_LENGTH) {
      onChange(value + key);
    }
  };

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.dots, { transform: [{ translateX: shake }] }]}>
        {Array.from({ length: PIN_LENGTH }, (_, i) => (
          <View key={i} style={[styles.dot, i < value.length && styles.dotFilled]} />
        ))}
      </Animated.View>
      <View style={styles.grid}>
        {KEYS.map((key, index) => (
          <Pressable
            key={index}
            onPress={() => press(key)}
            disabled={disabled || key === ''}
            style={({ pressed }) => [styles.key, key === '' && styles.keyHidden, pressed && styles.keyPressed]}
          >
            {key === 'back' ? (
              <Ionicons name="backspace-outline" size={26} color={colors.text} />
            ) : (
              <Text style={styles.keyText}>{key}</Text>
            )}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', gap: spacing.xl },
  dots: { flexDirection: 'row', gap: spacing.md },
  dot: {
    width: 14,
    height: 14,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.textDim,
  },
  dotFilled: { backgroundColor: colors.accent, borderColor: colors.accent },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    width: 3 * 72 + 2 * spacing.lg,
    gap: spacing.lg,
    justifyContent: 'center',
  },
  key: {
    width: 72,
    height: 72,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyHidden: { backgroundColor: 'transparent' },
  keyPressed: { backgroundColor: colors.surfaceAlt },
  keyText: { color: colors.text, fontSize: 26, fontWeight: '500' },
});
