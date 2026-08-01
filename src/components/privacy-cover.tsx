import { StyleSheet, View } from 'react-native';

import { Calculator } from './calculator';
import { colors } from '../theme';

/**
 * Opaque cover rendered above everything while the app is inactive or
 * backgrounded, so the OS app-switcher snapshot reveals nothing.
 *
 * It renders the calculator rather than a lock icon: the snapshot lives on in
 * the app switcher where anyone scrolling past can see it, and a padlock there
 * would undo the disguise every time the app is backgrounded.
 */
export function PrivacyCover({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <View style={styles.cover} pointerEvents="auto">
      <Calculator interactive={false} />
    </View>
  );
}

const styles = StyleSheet.create({
  cover: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: colors.bg,
    zIndex: 1000,
  },
});
