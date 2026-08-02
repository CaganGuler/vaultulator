import { Stack } from 'expo-router';
import * as ScreenCapture from 'expo-screen-capture';
import { useCallback } from 'react';
import { View } from 'react-native';

import { useInactivityLock } from '@/hooks/use-inactivity-lock';
import { usePanicGesture } from '@/hooks/use-panic-gesture';
import { useSession } from '@/stores/session';
import { colors } from '@/theme';

export default function VaultLayout() {
  // Android: FLAG_SECURE blocks screenshots/recording/recents thumbnail.
  // iOS cannot truly block screenshots — documented in docs/SECURITY.md.
  ScreenCapture.usePreventScreenCapture();
  const { onUserInteraction } = useInactivityLock();

  const lock = useCallback(() => useSession.getState().lock(), []);

  // iOS can't prevent a screenshot, but it does tell us one happened. Locking
  // immediately means whatever leaked is one frame, not a browsing session.
  ScreenCapture.useScreenshotListener(lock);

  usePanicGesture(lock);

  return (
    <View style={{ flex: 1 }} onStartShouldSetResponderCapture={onUserInteraction}>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="camera" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="media/[id]" options={{ presentation: 'fullScreenModal', animation: 'fade' }} />
        <Stack.Screen name="note/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="album/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="change-pin" options={{ presentation: 'modal' }} />
        <Stack.Screen name="decoy" options={{ presentation: 'modal' }} />
      </Stack>
    </View>
  );
}
