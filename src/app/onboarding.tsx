import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { PIN_LENGTH, PinPad } from '@/components/pin-pad';
import { useSession } from '@/stores/session';
import { colors, radius, spacing } from '@/theme';

type Step = 'intro' | 'setPin' | 'confirmPin';

export default function Onboarding() {
  const [step, setStep] = useState<Step>('intro');
  const [pin, setPin] = useState('');
  const [firstPin, setFirstPin] = useState('');
  const [errorSignal, setErrorSignal] = useState(0);
  const [creating, setCreating] = useState(false);

  const handlePinChange = (value: string) => {
    setPin(value);
    if (value.length !== PIN_LENGTH) return;
    if (step === 'setPin') {
      setFirstPin(value);
      setPin('');
      setStep('confirmPin');
      return;
    }
    if (value !== firstPin) {
      setPin('');
      setFirstPin('');
      setStep('setPin');
      setErrorSignal((n) => n + 1);
      return;
    }
    setCreating(true);
    void useSession
      .getState()
      .create(value)
      .catch(() => setCreating(false));
    // success flips status → unlocked; Stack.Protected routes take over
  };

  if (step === 'intro') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.intro}>
          <Ionicons name="shield-checkmark" size={64} color={colors.accent} />
          <Text style={styles.title}>Gizli alan</Text>
          <Text style={styles.subtitle}>
            Fotoğrafların, videoların ve notların yalnızca bu cihazda, uçtan uca şifreli olarak saklanır.
            İnternete hiçbir şey gönderilmez.
          </Text>
          <View style={styles.warningCard}>
            <Ionicons name="warning" size={22} color={colors.danger} />
            <Text style={styles.warningText}>
              PIN&apos;ini unutursan verilerin KURTARILAMAZ. Kurtarma yolu, &quot;şifremi unuttum&quot; seçeneği
              veya yedek yoktur. Bu bilinçli bir güvenlik tasarımıdır.
            </Text>
          </View>
        </View>
        <Button title="Anladım, kurtarma yok — PIN belirle" onPress={() => setStep('setPin')} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.pinHeader}>
        <Text style={styles.title}>{step === 'setPin' ? 'PIN belirle' : 'PIN’i doğrula'}</Text>
        <Text style={styles.subtitle}>
          {step === 'setPin'
            ? `${PIN_LENGTH} haneli bir PIN seç. Tahmin edilmesi kolay PIN’lerden kaçın.`
            : 'Aynı PIN’i bir kez daha gir.'}
        </Text>
      </View>
      <PinPad value={pin} onChange={handlePinChange} disabled={creating} errorSignal={errorSignal} />
      <View style={{ height: spacing.xl }} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: spacing.lg, justifyContent: 'space-between' },
  intro: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  pinHeader: { alignItems: 'center', gap: spacing.sm, marginTop: spacing.xl },
  title: { color: colors.text, fontSize: 28, fontWeight: '700' },
  subtitle: { color: colors.textDim, fontSize: 15, textAlign: 'center', lineHeight: 22 },
  warningCard: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.lg,
  },
  warningText: { color: colors.text, fontSize: 14, lineHeight: 20, flex: 1 },
});
