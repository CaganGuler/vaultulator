import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { PIN_LENGTH, PinPad } from '@/components/pin-pad';
import { useSession } from '@/stores/session';
import { colors, spacing } from '@/theme';

type Step = 'current' | 'new' | 'confirm';

const TITLES: Record<Step, string> = {
  current: 'Mevcut PIN’i gir',
  new: 'Yeni PIN’i belirle',
  confirm: 'Yeni PIN’i doğrula',
};

export default function ChangePinScreen() {
  const [step, setStep] = useState<Step>('current');
  const [pin, setPin] = useState('');
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [errorSignal, setErrorSignal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [lockedOut, setLockedOut] = useState(false);

  const handlePinChange = (value: string) => {
    setPin(value);
    if (value.length !== PIN_LENGTH || busy) return;

    if (step === 'current') {
      setCurrentPin(value);
      setPin('');
      setStep('new');
      return;
    }
    if (step === 'new') {
      setNewPin(value);
      setPin('');
      setStep('confirm');
      return;
    }
    if (value !== newPin) {
      setPin('');
      setNewPin('');
      setStep('new');
      setErrorSignal((n) => n + 1);
      return;
    }
    setBusy(true);
    void useSession
      .getState()
      .changePin(currentPin, value)
      .then((result) => {
        if (result === 'ok') {
          setPin('');
          setCurrentPin('');
          setNewPin('');
          Alert.alert('Tamam', 'PIN değiştirildi.');
          router.back();
          return;
        }
        // Anything else restarts the flow with the same message. A decoy
        // session must not be able to tell "this PIN belongs to the other
        // vault" apart from "this PIN is wrong" — see docs/SECURITY.md.
        setPin('');
        setCurrentPin('');
        setNewPin('');
        setStep('current');
        setErrorSignal((n) => n + 1);
        setLockedOut(result === 'locked');
      })
      .catch(() => Alert.alert('Hata', 'PIN değiştirilemedi.'))
      .finally(() => setBusy(false));
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{TITLES[step]}</Text>
        {step === 'current' && errorSignal > 0 && (
          <Text style={styles.error}>
            {lockedOut ? 'Çok fazla yanlış deneme. Biraz sonra tekrar dene.' : 'Mevcut PIN yanlış'}
          </Text>
        )}
      </View>
      <PinPad value={pin} onChange={handlePinChange} disabled={busy} errorSignal={errorSignal} />
      <Button title="Vazgeç" variant="ghost" onPress={() => router.back()} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: spacing.lg, justifyContent: 'space-between' },
  header: { alignItems: 'center', gap: spacing.sm, marginTop: spacing.xl },
  title: { color: colors.text, fontSize: 22, fontWeight: '700' },
  error: { color: colors.danger, fontSize: 14 },
});
