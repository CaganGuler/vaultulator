/**
 * Fallback for any route that does not exist.
 *
 * Without this, an unmatched deep link lands on Expo Router's built-in
 * "Unmatched Route" screen — a developer-looking page showing the raw path.
 * That screen is not a calculator, so the disguise would be one link away from
 * failing. Show the calculator face and get back to the real entry point.
 */
import { Redirect } from 'expo-router';

import { Calculator } from '@/components/calculator';

export default function NotFound() {
  return (
    <>
      <Calculator interactive={false} />
      <Redirect href="/" />
    </>
  );
}
