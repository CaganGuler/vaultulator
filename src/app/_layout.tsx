import { Stack, type ErrorBoundaryProps } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { View } from 'react-native';

import { Calculator } from '@/components/calculator';
import { PrivacyCover } from '@/components/privacy-cover';
import { useAutoLock } from '@/hooks/use-auto-lock';
import { useSession } from '@/stores/session';
import { useSettings } from '@/stores/settings';
import { colors } from '@/theme';

SplashScreen.preventAutoHideAsync();

/**
 * Catches any render error below the root.
 *
 * Two jobs, in order: get the decrypted content off the screen, and never show
 * a red box or a stack trace — that would announce this is not a calculator.
 * One automatic retry lands the user back on the lock screen; if the error
 * repeats, the static calculator stays, which reads as a frozen app rather
 * than a crashed vault.
 */
export function ErrorBoundary({ retry }: ErrorBoundaryProps) {
  const retried = useRef(false);

  useEffect(() => {
    useSession.getState().lock();
    if (retried.current) return;
    retried.current = true;
    void retry();
  }, [retry]);

  return <Calculator interactive={false} />;
}

export default function RootLayout() {
  const status = useSession((s) => s.status);
  const { covered } = useAutoLock();

  useEffect(() => {
    void useSession
      .getState()
      .init()
      .then(() => useSettings.getState().load())
      // A failed init would otherwise leave `status` on 'loading' forever —
      // an app stuck on a spinner with no way out and no diagnostic.
      .catch(() => useSession.setState({ status: 'locked' }))
      .finally(() => SplashScreen.hideAsync());
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
          animation: 'fade',
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Protected guard={status === 'uninitialized'}>
          <Stack.Screen name="onboarding" />
        </Stack.Protected>
        <Stack.Protected guard={status === 'locked'}>
          <Stack.Screen name="lock" />
        </Stack.Protected>
        <Stack.Protected guard={status === 'unlocked'}>
          <Stack.Screen name="(vault)" />
        </Stack.Protected>
      </Stack>
      <PrivacyCover visible={covered} />
    </View>
  );
}
