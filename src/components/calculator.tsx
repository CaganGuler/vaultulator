/**
 * A calculator that actually calculates — and is also the vault's front door.
 *
 * Entering the PIN as a plain 6-digit number and pressing `=` unlocks. Anything
 * else behaves exactly like a calculator, including a *wrong* PIN: no shake, no
 * error text, no spinner. Silence is what a real calculator does when you press
 * `=` on a bare number, and any feedback would give away that the number was
 * checked against something.
 *
 * The same component renders the app-switcher cover (with `interactive={false}`)
 * so the OS snapshot shows a calculator rather than anything vault-shaped.
 */
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radius, spacing } from '../theme';

import { PIN_LENGTH } from '../lib/crypto/keys';

type Op = '+' | '−' | '×' | '÷';

interface Pending {
  op: Op;
  value: number;
}

function apply({ op, value }: Pending, operand: number): number {
  switch (op) {
    case '+':
      return value + operand;
    case '−':
      return value - operand;
    case '×':
      return value * operand;
    case '÷':
      return operand === 0 ? NaN : value / operand;
  }
}

const MAX_DIGITS = 12;

function format(n: number): string {
  if (!Number.isFinite(n)) return 'Hata';
  // Trim the float noise 0.1 + 0.2 leaves behind before measuring length.
  const rounded = Math.round(n * 1e10) / 1e10;
  const plain = String(rounded);
  return plain.replace('-', '').replace('.', '').length > MAX_DIGITS ? rounded.toExponential(6) : plain;
}

/** A bare, unsigned 6-digit entry — the only thing treated as a PIN. */
function isPinEntry(display: string, pending: Pending | null): boolean {
  return pending === null && new RegExp(`^\\d{${PIN_LENGTH}}$`).test(display);
}

interface KeyProps {
  label: string;
  onPress: () => void;
  tone?: 'digit' | 'function' | 'operator';
  wide?: boolean;
}

function CalcKey({ label, onPress, tone = 'digit', wide }: KeyProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.key,
        tone === 'function' && styles.keyFunction,
        tone === 'operator' && styles.keyOperator,
        wide && styles.keyWide,
        pressed && styles.keyPressed,
      ]}
    >
      <Text style={[styles.keyLabel, tone === 'operator' && styles.keyLabelOperator]}>{label}</Text>
    </Pressable>
  );
}

interface CalculatorProps {
  /** Called when a bare PIN_LENGTH-digit entry is submitted with `=`. */
  onPinEntry?: (pin: string) => void;
  /** False renders a non-interactive copy for the app-switcher cover. */
  interactive?: boolean;
}

export function Calculator({ onPinEntry, interactive = true }: CalculatorProps) {
  const [display, setDisplay] = useState('0');
  const [pending, setPending] = useState<Pending | null>(null);
  const [overwrite, setOverwrite] = useState(true);

  const tap = () => {
    if (interactive) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const pressDigit = (digit: string) => {
    tap();
    if (overwrite) {
      setDisplay(digit);
      setOverwrite(false);
      return;
    }
    if (display.replace('-', '').replace('.', '').length >= MAX_DIGITS) return;
    setDisplay(display === '0' ? digit : display + digit);
  };

  const pressDot = () => {
    tap();
    if (overwrite) {
      setDisplay('0.');
      setOverwrite(false);
      return;
    }
    if (!display.includes('.')) setDisplay(`${display}.`);
  };

  const pressClear = () => {
    tap();
    setDisplay('0');
    setPending(null);
    setOverwrite(true);
  };

  const pressSign = () => {
    tap();
    if (display === '0') return;
    setDisplay(display.startsWith('-') ? display.slice(1) : `-${display}`);
  };

  const pressPercent = () => {
    tap();
    setDisplay(format(Number(display) / 100));
    setOverwrite(true);
  };

  const pressOperator = (op: Op) => {
    tap();
    const operand = Number(display);
    if (pending && !overwrite) {
      const result = apply(pending, operand);
      setDisplay(format(result));
      setPending({ op, value: result });
    } else {
      setPending({ op, value: operand });
    }
    setOverwrite(true);
  };

  const pressEquals = () => {
    tap();
    if (isPinEntry(display, pending)) {
      // Deliberately no visible change either way — the caller opens the vault
      // on success and does nothing at all on failure.
      onPinEntry?.(display);
      return;
    }
    if (!pending) return;
    setDisplay(format(apply(pending, Number(display))));
    setPending(null);
    setOverwrite(true);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.displayArea}>
        <Text style={styles.display} numberOfLines={1} adjustsFontSizeToFit>
          {display}
        </Text>
      </View>

      {/* One gate for the whole pad: the app-switcher copy renders identically but inert. */}
      <View style={styles.keypad} pointerEvents={interactive ? 'auto' : 'none'}>
        <View style={styles.row}>
          <CalcKey label="C" tone="function" onPress={pressClear} />
          <CalcKey label="±" tone="function" onPress={pressSign} />
          <CalcKey label="%" tone="function" onPress={pressPercent} />
          <CalcKey label="÷" tone="operator" onPress={() => pressOperator('÷')} />
        </View>
        <View style={styles.row}>
          <CalcKey label="7" onPress={() => pressDigit('7')} />
          <CalcKey label="8" onPress={() => pressDigit('8')} />
          <CalcKey label="9" onPress={() => pressDigit('9')} />
          <CalcKey label="×" tone="operator" onPress={() => pressOperator('×')} />
        </View>
        <View style={styles.row}>
          <CalcKey label="4" onPress={() => pressDigit('4')} />
          <CalcKey label="5" onPress={() => pressDigit('5')} />
          <CalcKey label="6" onPress={() => pressDigit('6')} />
          <CalcKey label="−" tone="operator" onPress={() => pressOperator('−')} />
        </View>
        <View style={styles.row}>
          <CalcKey label="1" onPress={() => pressDigit('1')} />
          <CalcKey label="2" onPress={() => pressDigit('2')} />
          <CalcKey label="3" onPress={() => pressDigit('3')} />
          <CalcKey label="+" tone="operator" onPress={() => pressOperator('+')} />
        </View>
        <View style={styles.row}>
          <CalcKey label="0" wide onPress={() => pressDigit('0')} />
          <CalcKey label="," onPress={pressDot} />
          <CalcKey label="=" tone="operator" onPress={pressEquals} />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, justifyContent: 'flex-end' },
  displayArea: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, alignItems: 'flex-end' },
  display: { color: colors.text, fontSize: 68, fontWeight: '300', letterSpacing: -1 },
  keypad: { padding: spacing.sm, gap: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm },
  key: {
    flex: 1,
    aspectRatio: 1.15,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyWide: { flex: 2.08, aspectRatio: undefined },
  keyFunction: { backgroundColor: colors.surface },
  keyOperator: { backgroundColor: colors.accent },
  keyPressed: { opacity: 0.6 },
  keyLabel: { color: colors.text, fontSize: 30, fontWeight: '400' },
  keyLabelOperator: { color: colors.bg, fontWeight: '500' },
});
