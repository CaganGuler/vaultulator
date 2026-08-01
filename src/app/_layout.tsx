import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { View } from 'react-native';

import { PrivacyCover } from '@/components/privacy-cover';
import { useAutoLock } from '@/hooks/use-auto-lock';
import { useSession } from '@/stores/session';
import { useSettings } from '@/stores/settings';
import { colors } from '@/theme';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const status = useSession((s) => s.status);
  const { covered } = useAutoLock();

  useEffect(() => {
    void useSession
      .getState()
      .init()
      .then(() => useSettings.getState().load())
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
