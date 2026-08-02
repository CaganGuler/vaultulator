# Kasa

This is an offline, PIN-protected encrypted vault with a decoy (honeypot) vault
and a calculator disguise. It has security invariants that are easy to break by
accident.

**Read `CLAUDE.md` before writing any code.** It lists nine invariants — plaintext
keys never persisted, plaintext media only under `<cache>/decrypted/`, no
`expo-media-library`, versioned crypto formats, streamed file I/O, no crypto
change without tests, every vault query scoped by `VaultContext`, the vault role
never leaking into UI text, and a `bundleIdentifier` that must not change.

Then read `docs/SECURITY.md` for the threat model and the honest limits.

Run `npm run verify` (typecheck + lint + tests with coverage floors) before
proposing a change. Expo Go does not work here — native crypto means
`npx expo run:ios` or `run:android`.
