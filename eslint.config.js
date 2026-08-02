// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

/**
 * Several rules below exist to make the invariants in CLAUDE.md mechanical
 * rather than a matter of remembering them. Each is annotated with the
 * invariant it enforces.
 */
module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', '.expo/*', 'coverage/*', 'ios/*', 'android/*', 'build/*'],
  },
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      // Invariant #1: plaintext keys must never reach a log. The code is clean
      // today; this is what keeps it that way.
      'no-console': 'error',

      // Expo's preset ships these as warnings. In a crypto codebase an unused
      // binding or a loose type assertion is worth stopping for.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-assertions': 'error',
      '@typescript-eslint/no-extra-non-null-assertion': 'error',
      eqeqeq: ['error', 'smart'],
    },
  },
  {
    // Invariant #3: gallery isolation is structural — expo-media-library is not
    // installed, so no write path to the device gallery exists. Adding one must
    // be a deliberate architectural decision, not an import someone slipped in.
    //
    // Invariant #7: every query touching vault content goes through a
    // VaultContext. The raw database handle lives in lib/db/connection and must
    // not escape the folder that owns the scoping helpers.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/lib/db/**', '**/__tests__/**', 'src/test/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'expo-media-library',
              message:
                'Gallery isolation is structural (CLAUDE.md invariant #3). A path to the device gallery is an architectural decision, not an import.',
            },
          ],
          patterns: [
            {
              group: ['**/lib/db/connection', '**/db/connection', './connection', '../connection'],
              message:
                'getDb() is internal to src/lib/db (CLAUDE.md invariant #7). Use a *-repo function that takes a VaultContext.',
            },
          ],
        },
      ],
    },
  },
  {
    // Tests cross these boundaries on purpose.
    files: ['**/__tests__/**', 'src/test/**'],
    rules: { 'no-console': 'off' },
  },
]);
