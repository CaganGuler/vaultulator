/**
 * One photo in the pager: pinch, pan, double-tap.
 *
 * Compiler rules that apply here (CLAUDE.md): a shared value's `.value` is
 * never read or written during render, and no shared value is named `*Ref`
 * (the compiler treats such identifiers as refs). Gesture callbacks close over
 * shared values and module functions only — closing over React state makes the
 * detector re-attach on every state change.
 */
import { Image } from 'expo-image';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { noteActivity } from '../../lib/activity';
import { colors } from '../../theme';

const MIN_ZOOM = 1;
const MAX_ZOOM = 6;
const DOUBLE_TAP_ZOOM = 2.5;

const AnimatedImage = Animated.createAnimatedComponent(Image);

interface PhotoPageProps {
  /** Decrypted file URI, or null while it is being produced. */
  uri: string | null;
  /** Low-res stand-in from the grid's cache, shown until `uri` arrives. */
  placeholderUri: string | null;
  failed: boolean;
  /** Paging must be disabled while this page is zoomed in. */
  onZoomChange: (zoomed: boolean) => void;
  onSingleTap: () => void;
  /** Set by the pager so the gesture can yield to it when not zoomed. */
  pagerRef: React.RefObject<unknown>;
}

export function PhotoPage({
  uri,
  placeholderUri,
  failed,
  onZoomChange,
  onSingleTap,
  pagerRef,
}: PhotoPageProps) {
  const { width, height } = useWindowDimensions();

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const offsetX = useSharedValue(0);
  const offsetY = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);

  const reset = () => {
    'worklet';
    scale.value = withTiming(1);
    savedScale.value = 1;
    offsetX.value = withTiming(0);
    offsetY.value = withTiming(0);
    savedX.value = 0;
    savedY.value = 0;
    runOnJS(onZoomChange)(false);
  };

  // Leaving the page resets it, so coming back never shows a stale zoom.
  useEffect(
    () => () => {
      onZoomChange(false);
    },
    [onZoomChange],
  );

  const pinch = Gesture.Pinch()
    .onBegin(() => {
      runOnJS(noteActivity)();
    })
    .onUpdate((e) => {
      scale.value = Math.min(Math.max(savedScale.value * e.scale, MIN_ZOOM * 0.6), MAX_ZOOM);
    })
    .onEnd(() => {
      if (scale.value <= MIN_ZOOM) {
        reset();
        return;
      }
      savedScale.value = scale.value;
      runOnJS(onZoomChange)(true);
    });

  const pan = Gesture.Pan()
    .averageTouches(true)
    // Native, UI-thread arbitration. Mirroring zoom into React state to drive
    // scrollEnabled costs a frame or two, and a horizontal drag can page
    // during them.
    // gesture-handler types this as a component ref; a FlatList instance ref
    // is what it actually needs and accepts at runtime.
    .blocksExternalGesture(pagerRef as React.RefObject<React.ComponentType<object> | null | undefined>)
    .onBegin(() => {
      runOnJS(noteActivity)();
    })
    .onUpdate((e) => {
      if (scale.value <= MIN_ZOOM) return; // let the pager have it
      const maxX = ((scale.value - 1) * width) / 2;
      const maxY = ((scale.value - 1) * height) / 2;
      offsetX.value = Math.min(Math.max(savedX.value + e.translationX, -maxX), maxX);
      offsetY.value = Math.min(Math.max(savedY.value + e.translationY, -maxY), maxY);
    })
    .onEnd(() => {
      savedX.value = offsetX.value;
      savedY.value = offsetY.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      runOnJS(noteActivity)();
      if (scale.value > MIN_ZOOM) {
        reset();
        return;
      }
      scale.value = withTiming(DOUBLE_TAP_ZOOM);
      savedScale.value = DOUBLE_TAP_ZOOM;
      runOnJS(onZoomChange)(true);
    });

  const singleTap = Gesture.Tap()
    .numberOfTaps(1)
    .onEnd(() => {
      runOnJS(noteActivity)();
      runOnJS(onSingleTap)();
    });

  const gesture = Gesture.Race(
    Gesture.Exclusive(doubleTap, singleTap),
    Gesture.Simultaneous(pinch, pan),
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offsetX.value }, { translateY: offsetY.value }, { scale: scale.value }],
  }));

  if (failed) {
    return (
      <View style={[styles.page, { width }]}>
        <View style={styles.state}>
          <Text style={styles.stateText}>Bu içerik açılamadı.</Text>
        </View>
      </View>
    );
  }

  return (
    <GestureDetector gesture={gesture}>
      <View style={[styles.page, { width }]}>
        <AnimatedImage
          source={uri ? { uri } : placeholderUri ? { uri: placeholderUri } : null}
          style={[StyleSheet.absoluteFill, animatedStyle]}
          contentFit="contain"
          // Decrypted plaintext — memory only, never persisted (invariant #2).
          cachePolicy="memory"
        />
        {!uri && (
          <View style={styles.state} pointerEvents="none">
            <ActivityIndicator color={colors.accent} />
          </View>
        )}
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, justifyContent: 'center', overflow: 'hidden' },
  state: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', gap: 8 } as const,
  stateText: { color: colors.textDim, fontSize: 14 },
});
