/**
 * Decoy vault management. Reachable ONLY from a primary session — the route is
 * rendered behind a role check in Settings and re-checks on mount, because the
 * whole point is that a coerced decoy session cannot discover this screen or
 * learn that the real vault exists.
 */
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { PIN_LENGTH, PinPad } from '@/components/pin-pad';
import {
  type DecoyState,
  disableDecoy,
  disableDuress,
  enableDecoy,
  enableDuress,
  getDecoyState,
  PinInUseError,
  resetDecoyPin,
  verifyPinForRole,
} from '@/lib/crypto/keys';
import { requireCtx, useSession } from '@/stores/session';
import { colors, radius, spacing } from '@/theme';

type Flow = 'menu' | 'create' | 'reset' | 'duress';

/** Steps differ per flow; duress opens with a primary-PIN authorisation step. */
type Step = 'auth' | 'new' | 'confirm';

const TITLES: Record<Flow, Partial<Record<Step, string>>> = {
  menu: {},
  create: { new: 'Yem kasa PIN’ini belirle', confirm: 'Yem kasa PIN’ini doğrula' },
  reset: { new: 'Yeni yem PIN’ini belirle', confirm: 'Yeni yem PIN’ini doğrula' },
  duress: {
    auth: 'Onay için kendi PIN’ini gir',
    new: 'Panik PIN’ini belirle',
    confirm: 'Panik PIN’ini doğrula',
  },
};

/**
 * Both PINs are exactly PIN_LENGTH digits, so "one digit off" is simply a
 * Hamming distance of 1 — the realistic fat-finger case for a PIN whose whole
 * job is to destroy the real vault.
 */
function tooCloseTo(a: string, b: string): boolean {
  let differing = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) differing++;
  return differing <= 1;
}

export default function DecoyScreen() {
  const [state, setState] = useState<DecoyState | null>(null);
  const [flow, setFlow] = useState<Flow>('menu');
  const [step, setStep] = useState<Step>('new');
  const [pin, setPin] = useState('');
  const [authPin, setAuthPin] = useState('');
  const [firstPin, setFirstPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [errorSignal, setErrorSignal] = useState(0);
  const [busy, setBusy] = useState(false);

  const isPrimary = useSession((s) => s.ctx?.role === 'primary');

  const refresh = useCallback(async () => {
    setState(await getDecoyState(requireCtx().dek));
  }, []);

  // Belt and braces: Settings already hides the entry point, but the route
  // itself must not survive being reached from a non-primary session.
  useEffect(() => {
    if (!isPrimary) router.back();
  }, [isPrimary]);

  useFocusEffect(
    useCallback(() => {
      if (isPrimary) void refresh();
    }, [isPrimary, refresh]),
  );

  const backToMenu = () => {
    setFlow('menu');
    setPin('');
    setAuthPin('');
    setFirstPin('');
    setError(null);
  };

  const fail = (message: string) => {
    setPin('');
    setError(message);
    setErrorSignal((n) => n + 1);
  };

  const startFlow = (next: Flow) => {
    setFlow(next);
    setStep(next === 'duress' ? 'auth' : 'new');
    setPin('');
    setAuthPin('');
    setFirstPin('');
    setError(null);
  };

  const commit = async (value: string) => {
    const { dek } = requireCtx();
    if (flow === 'create') await enableDecoy(dek, value);
    else if (flow === 'reset') await resetDecoyPin(dek, value);
    else if (flow === 'duress') await enableDuress(dek, value);
  };

  const handlePinChange = (value: string) => {
    setPin(value);
    if (value.length !== PIN_LENGTH || busy) return;
    setError(null);

    if (step === 'auth') {
      setBusy(true);
      void verifyPinForRole(value, 'primary')
        .then((ok) => {
          if (!ok) {
            fail('PIN yanlış');
            return;
          }
          setAuthPin(value);
          setPin('');
          setStep('new');
        })
        .finally(() => setBusy(false));
      return;
    }

    if (step === 'new') {
      if (flow === 'duress' && tooCloseTo(value, authPin)) {
        fail('Panik PIN’i kendi PIN’ine fazla benziyor. Yanlışlıkla girilmemesi için çok farklı olmalı.');
        return;
      }
      setFirstPin(value);
      setPin('');
      setStep('confirm');
      return;
    }

    if (value !== firstPin) {
      setFirstPin('');
      setStep('new');
      fail('PIN’ler eşleşmedi');
      return;
    }

    setBusy(true);
    void commit(value)
      .then(async () => {
        await refresh();
        backToMenu();
        Alert.alert('Tamam', flow === 'duress' ? 'Panik PIN’i kuruldu.' : 'Yem kasa hazır.');
      })
      .catch((e: unknown) => {
        setStep('new');
        setFirstPin('');
        fail(
          e instanceof PinInUseError
            ? 'Bu PIN zaten başka bir kasada kullanılıyor.'
            : 'İşlem tamamlanamadı.',
        );
      })
      .finally(() => setBusy(false));
  };

  const confirmDisableDecoy = () => {
    Alert.alert(
      'Yem kasayı sil',
      'Yem kasanın PIN’i ve içindeki her şey kalıcı olarak silinecek. Varsa panik PIN’i de kaldırılır.',
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'Sil',
          style: 'destructive',
          onPress: () => {
            void disableDecoy(requireCtx().dek)
              .then(refresh)
              .catch(() => Alert.alert('Hata', 'Yem kasa silinemedi.'));
          },
        },
      ],
    );
  };

  const confirmDisableDuress = () => {
    Alert.alert('Panik PIN’ini kaldır', 'Bu PIN artık hiçbir şey yapmayacak.', [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Kaldır',
        onPress: () => {
          void disableDuress(requireCtx().dek)
            .then(refresh)
            .catch(() => Alert.alert('Hata', 'Kaldırılamadı.'));
        },
      },
    ]);
  };

  const confirmEnableDuress = () => {
    Alert.alert(
      'Panik PIN’i',
      'Bu PIN girildiğinde gerçek kasanın anahtarı ANINDA ve KALICI olarak yok edilir; ardından yem kasa hiçbir şey olmamış gibi açılır.\n\nGeri dönüşü yoktur. Yanlışlıkla girilirse buradaki her şeyi kaybedersin.',
      [
        { text: 'Vazgeç', style: 'cancel' },
        { text: 'Anladım, kur', style: 'destructive', onPress: () => startFlow('duress') },
      ],
    );
  };

  if (!state) {
    return <SafeAreaView style={styles.container} />;
  }

  if (flow !== 'menu') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.pinHeader}>
          <Text style={styles.pinTitle}>{TITLES[flow][step]}</Text>
          {error && <Text style={styles.error}>{error}</Text>}
        </View>
        <PinPad value={pin} onChange={handlePinChange} disabled={busy} errorSignal={errorSignal} />
        <Button title="Vazgeç" variant="ghost" onPress={backToMenu} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.lg }}>
        <Text style={styles.title}>Yem kasa</Text>
        <Text style={styles.lede}>
          Farklı bir PIN, ayrı ve tamamen boş bir kasa açar. Zorlama altında o PIN’i verirsin; açılan kasada bu
          kasanın var olduğuna dair hiçbir iz yoktur.
        </Text>

        {state.decoyEnabled ? (
          <>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>YEM KASA</Text>
              <Pressable style={styles.row} onPress={() => startFlow('reset')}>
                <Ionicons name="key-outline" size={20} color={colors.text} />
                <Text style={styles.rowText}>Yem PIN’ini değiştir</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
              </Pressable>
              <Pressable style={styles.row} onPress={confirmDisableDecoy}>
                <Ionicons name="trash-outline" size={20} color={colors.danger} />
                <Text style={[styles.rowText, { color: colors.danger }]}>Yem kasayı sil</Text>
              </Pressable>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>PANİK PIN’İ</Text>
              <Pressable
                style={styles.row}
                onPress={state.duressEnabled ? confirmDisableDuress : confirmEnableDuress}
              >
                <Ionicons
                  name={state.duressEnabled ? 'alert-circle' : 'alert-circle-outline'}
                  size={20}
                  color={state.duressEnabled ? colors.danger : colors.text}
                />
                <Text style={styles.rowText}>{state.duressEnabled ? 'Panik PIN’ini kaldır' : 'Panik PIN’i kur'}</Text>
                {state.duressEnabled && <Text style={styles.rowValue}>Kurulu</Text>}
              </Pressable>
            </View>

            <Text style={styles.footnote}>
              Yem kasayı boş bırakma — boş bir kasa en çok şüphe çeken şeydir. Kilitleyip yem PIN’iyle girerek
              içine birkaç inandırıcı fotoğraf ve not koy.
            </Text>
          </>
        ) : (
          <>
            <Button title="Yem kasa oluştur" onPress={() => startFlow('create')} />
            <Text style={styles.footnote}>
              Yem PIN’i mevcut PIN’inden farklı olmalı. Kurduktan sonra kilitleyip yem PIN’iyle girerek içine
              inandırıcı içerik koymayı unutma.
            </Text>
          </>
        )}

        <Button title="Geri" variant="ghost" onPress={() => router.back()} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, justifyContent: 'space-between' },
  title: { color: colors.text, fontSize: 30, fontWeight: '700' },
  lede: { color: colors.textDim, fontSize: 14, lineHeight: 20 },
  section: { backgroundColor: colors.surface, borderRadius: radius.md, overflow: 'hidden' },
  sectionTitle: {
    color: colors.textDim,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.6,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  rowText: { color: colors.text, fontSize: 15, flex: 1 },
  rowValue: { color: colors.textDim, fontSize: 14 },
  footnote: { color: colors.textDim, fontSize: 12, lineHeight: 18, paddingHorizontal: spacing.xs },
  pinHeader: { alignItems: 'center', gap: spacing.sm, marginTop: spacing.xl * 2, paddingHorizontal: spacing.lg },
  pinTitle: { color: colors.text, fontSize: 22, fontWeight: '700', textAlign: 'center' },
  error: { color: colors.danger, fontSize: 14, textAlign: 'center' },
});
