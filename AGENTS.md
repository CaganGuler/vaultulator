# Kasa

This is an offline, PIN-protected encrypted vault with a decoy (honeypot) vault
and a calculator disguise. It has security invariants that are easy to break by
accident.

**Read `CLAUDE.md` before writing any code.** It lists eleven invariants —
plaintext keys never persisted, plaintext media only under `<cache>/decrypted/`
(image caches included), no `expo-media-library`, versioned crypto formats,
streamed file I/O, no crypto change without tests, every vault query scoped by
`VaultContext`, the vault role never leaking into UI text, every PIN check going
through `attemptPin`, a `bundleIdentifier` that must not change, and fixed-length
SecureStore records that must stay fixed-length.

CLAUDE.md also explains which of those the tooling enforces for you — eslint
rules, a static image-cache test, and per-directory coverage floors. Hitting one
of them is the design working, not an obstacle to silence.

Then read `docs/SECURITY.md` for the threat model and the honest limits. The docs
are in Turkish; the code and its comments are in English.

| Document | When you need it |
|---|---|
| `CLAUDE.md` | Invariants, repo layout, tooling, Reanimated rules |
| `docs/SECURITY.md` | Threat model, key hierarchy, what deniability does *not* cover |
| `docs/DATA-MODEL.md` | SQLite schema and migrations, `.enc` byte layout, SecureStore inventory |
| `docs/ARCHITECTURE.md` | Module map, lock state machine, media pipeline, temp-file lifecycle |
| `docs/BUILD.md` | Building, prebuild semantics, and the signing rule that can destroy the vault |

Run `npm run verify` (typecheck + lint + tests with coverage floors) before
proposing a change. Expo Go does not work here — native crypto means
`npx expo run:ios` or `run:android`.

**Two things to be careful with even when asked.** Changing the iOS
`bundleIdentifier` or signing with a different team makes the Keychain pepper
unreachable and permanently destroys the vault on the device — there is no
recovery path, by design. And a wrong PIN must stay completely silent: any
feedback on the lock screen reveals that the calculator is a door.
