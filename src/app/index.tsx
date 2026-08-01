import { Redirect } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useSession } from '@/stores/session';
import { colors } from '@/theme';

export default function Gate() {
  const status = useSession((s) => s.status);

  if (status === 'loading') {
    return (
      <View style={styles.container}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }
  if (status === 'uninitialized') return <Redirect href="/onboarding" />;
  if (status === 'locked') return <Redirect href="/lock" />;
  return <Redirect href="/(vault)/(tabs)" />;
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
});
