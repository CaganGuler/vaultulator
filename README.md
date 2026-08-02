# Vaultulator

[![CI](https://github.com/CaganGuler/vaultulator/actions/workflows/ci.yml/badge.svg)](https://github.com/CaganGuler/vaultulator/actions/workflows/ci.yml)

**A calculator that isn't.**

A PIN-protected, fully offline, encrypted media & notes vault for iOS and Android
(Expo / React Native). On the home screen it is a calculator — and while locked it
really *is* a working calculator. Type your PIN and press `=` to unlock. A wrong PIN
produces no reaction whatsoever: to anyone else, it's just a calculator.

## Features

- 🧮 **Calculator camouflage** — the lock screen is a fully functional calculator, not
  a PIN pad. Wrong input gives zero feedback; there is nothing that reveals a door.
- 🕵️ **Decoy vault (plausible deniability)** — a second PIN opens a separate,
  completely independent vault with its own key material. Someone browsing an unlocked
  decoy session cannot tell that a real vault exists.
- 🚨 **Duress PIN** — a last-resort panic PIN. Entering it atomically and irreversibly
  destroys the real vault's key material *inside the key layer*, then opens the decoy
  vault with no delay, as if it were a normal unlock.
- 📷 **In-app camera, gallery isolation** — photos and videos are encrypted straight
  from capture and **never touch the device gallery**. `expo-media-library` is not even
  installed; adding a gallery write-path would require a new dependency, visible in any PR.
- 🖼️ **Photos, videos, documents** — a swipeable viewer with pinch-to-zoom, in-app PDF
  and document viewing, albums, and searchable captions. Album membership is an
  encrypted id list stored inside the album's own row: a plaintext join table would
  partition the media table into per-vault equivalence classes and destroy the decoy's
  deniability.
- 📝 **Notes with checklists** — `- [ ]` is a plaintext convention, so the note body
  stays one opaque encrypted string and a checklist degrades to legible text.
- 🕰️ **Failed-attempt log** — timestamps of the last 16 wrong PINs, visible only from
  the real vault. Fixed-size record: a log that grew with the failure count would be a
  plaintext counter.
- 🔐 **Everything encrypted at rest** — media as chunked, streaming AES-256-GCM files
  (Tink / age STREAM construction: reordering, truncation, extension, and file-swap
  attacks are all rejected); note titles and bodies as field-level AES-256-GCM bound to
  their row and column.
- 🔑 **Device-bound key hierarchy** — PIN → Argon2id (64 MiB, t=3) with a 32-byte
  pepper that lives *only* in the Keychain/Keystore and never enters backups. Whoever
  steals your files or your backup cannot brute-force offline.
- 📵 **Fully offline** — no server, no account, no analytics, no network access.
  Your data lives on this device and nowhere else.
- 🛡️ **Active defenses** — screenshot blocking (Android `FLAG_SECURE`) or
  detect-and-lock (iOS), privacy cover that paints the calculator face over the app
  switcher snapshot, shake-to-lock panic gesture, inactivity auto-lock.

## ⚠️ There is no recovery

If you forget your PIN, your data is **permanently unrecoverable**. There is no
"forgot my PIN" flow, no recovery key, no cloud copy — by design. Restoring a device
backup does not bring the vault back either: part of the key (the pepper) lives only
in the device Keychain/Keystore and is never included in backups.

## Security model in one page

```
PIN (6 digits, NFKC-normalized)
  │
  ▼
Argon2id(salt, secret = pepper)      pepper: 32B, Keychain/Keystore only,
  │                                  WHEN_UNLOCKED_THIS_DEVICE_ONLY — never backed up
  ▼
KEK ──► all 4 key slots are tried, no early exit
          slot_i = IV ‖ AES-256-GCM(KEK, version ‖ role ‖ DEK)
        whichever slot authenticates yields that vault's DEK and role
  ▼
DEK (per-vault master key) ──HKDF──► file keys · database key · row-tag key
```

- PIN verification *is* the GCM tag check — there is no separate verifier blob, and
  every verification path goes through a single rate-limited gate with exponential
  backoff.
- The slot record has a fixed size, padding is indistinguishable from ciphertext, and
  the role byte sits inside the authenticated payload: how many PINs exist is not
  observable, and a decoy session cannot promote itself.
- The real vault can manage the decoy's PIN through a one-way escrow; nothing in the
  decoy session can reach the real vault's key.
- The panic PIN overwrites the real slot with random bytes before the unlock returns —
  the destruction lives in the key layer, not somewhere a caller could skip.
- Raising the Argon2id cost re-wraps the vault already on the device, on its next
  unlock. Since parameters and the slot record are two Keychain entries with no
  transaction between them, the old parameters are kept alongside the new ones until
  the re-wrap is confirmed — otherwise a crash mid-upgrade would brick the vault.

The full write-up — key hierarchy, multi-slot design, `.enc` wire format, threat
model, and platform hardening — is in [docs/SECURITY.md](docs/SECURITY.md).

### Honest limits

Deniability is honest about where it ends. The decoy withstands someone browsing the
unlocked app; it does **not** withstand a forensic disk image (file counts, timestamps,
and app size leak the real vault's existence). iOS screenshots cannot be blocked, only
detected. A rooted device reading the Keystore and process memory is out of scope.
Metadata (item counts, sizes, capture times) is stored in plaintext for querying —
content is not, and neither are captions, album names, or original filenames. Plaintext
media does touch disk while you are viewing it, under one wipe-on-lock directory; the
trade and who it helps are written out rather than glossed. The complete list, kept
deliberately blunt, lives in
[docs/SECURITY.md](docs/SECURITY.md#dürüst-sınırlar).

## ⚠️ Security status

This project has **not** been independently audited. The cryptographic design follows
well-studied constructions (Argon2id, AES-256-GCM, HKDF, Tink/age-style streaming AEAD)
and the crypto core carries an extensive round-trip and tamper test suite — but until a
third-party review happens, do not entrust it with data whose loss or exposure you
cannot afford.

## Development

The native crypto module (`react-native-quick-crypto`) means **Expo Go does not work**;
use a dev client.

> ⚠️ Installing a build signed with a **different team or bundle identifier** than the
> one already on the device makes the Keychain pepper unreachable and destroys that
> device's vault permanently. See [docs/BUILD.md](docs/BUILD.md) before installing.

```bash
npm install

# Generate native projects (ios/ and android/ — gitignored, app.json is the source of truth)
npx expo prebuild

# Run
npx expo run:ios        # iOS simulator / device
npx expo run:android    # Android emulator / device
```

| Command | Description |
|---|---|
| `npm run verify` | typecheck + lint + test (same as CI) |
| `npm test` | Jest unit tests (crypto core: round-trip, tamper, backoff) |
| `npm run typecheck` | TypeScript check (`tsc --noEmit`) |
| `npm run lint` | ESLint |
| `npm run prebuild` | Regenerate native projects (`ios/` and `android/` are generated, not committed) |

Tests run the crypto against a deterministic `node:crypto` shim and the database
against real SQL (`node:sqlite`), so migration, BLOB, and rollback behavior match the
device. Coverage thresholds force near-complete coverage of `src/lib/crypto` and
`src/lib/db` — crypto changes without tests do not merge.

## Documentation

> 📝 The in-depth docs are currently written in **Turkish**.

| Document | Contents |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Module map, media pipeline, lock state machine, route map |
| [docs/SECURITY.md](docs/SECURITY.md) | Threat model, key hierarchy, `.enc` format spec, honest limits |
| [docs/DATA-MODEL.md](docs/DATA-MODEL.md) | SQLite schema, file format byte layout, directory layout, SecureStore inventory |
| [docs/BUILD.md](docs/BUILD.md) | Build and prebuild semantics, and the signing rule that can destroy the vault |
| [CLAUDE.md](CLAUDE.md) | Repo rules and invariants |

## Tech

Expo SDK 57 · TypeScript (strict) · Expo Router · React Compiler · expo-camera ·
expo-video · expo-sqlite · expo-secure-store · expo-file-system (FileHandle stream I/O) ·
react-native-quick-crypto (JSI) · react-native-reanimated + gesture-handler ·
react-native-pdf · zustand

## License

[MIT](LICENSE) © Çağan Güler
