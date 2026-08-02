# Kasa — Şifreli Özel Medya & Not Kasası

PIN korumalı, **tamamen offline** bir kişisel kasa uygulaması (iOS + Android, Expo / React Native).

- 📷 Uygulama içi kameradan fotoğraf ve video çekilir; **cihaz galerisine asla düşmez**.
- 🔐 Tüm içerik (medya + notlar) cihazda **AES-256-GCM** ile şifreli saklanır (encrypted at rest).
- 📝 Notlar başlıklarıyla birlikte alan bazında şifrelenir.
- 📵 Sunucu, hesap, analitik, internet erişimi yok. Veri yalnızca bu cihazda yaşar.

## ⚠️ Kurtarma yoktur

PIN unutulursa veriler **kalıcı olarak kurtarılamaz**. "Şifremi unuttum" akışı, yedek anahtar
veya bulut kopyası bilinçli olarak yoktur; anahtar hiyerarşisi buna göre tasarlanmıştır
(bkz. [docs/SECURITY.md](docs/SECURITY.md)). Ayrıca cihaz yedeğinden geri yükleme de kasayı
geri getirmez: anahtarın bir parçası (pepper) yalnızca cihazın Keychain/Keystore'unda yaşar
ve yedeklere taşınmaz.

## Geliştirme

Native kripto modülü (react-native-quick-crypto) kullanıldığı için **Expo Go çalışmaz**;
dev-client / prebuild gerekir.

```bash
npm install

# Native projeleri üret (ios/ ve android/)
npx expo prebuild

# Çalıştır
npx expo run:ios        # iOS simülatör / cihaz
npx expo run:android    # Android emülatör / cihaz
```

### Komutlar

| Komut | Açıklama |
|---|---|
| `npm run verify` | typecheck + lint + test (CI ile aynı) |
| `npm test` | Jest birim testleri (kripto çekirdeği: round-trip, tamper, backoff) |
| `npm run typecheck` | TypeScript kontrolü (`tsc --noEmit`) |
| `npm run lint` | ESLint |
| `npm run prebuild` | Native projeleri yeniden üret |

## Dokümantasyon

| Doküman | İçerik |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Modül haritası, medya hattı, kilit durum makinesi, rota haritası |
| [docs/SECURITY.md](docs/SECURITY.md) | Tehdit modeli, anahtar hiyerarşisi, `.enc` format speci, dürüst sınırlar |
| [docs/DATA-MODEL.md](docs/DATA-MODEL.md) | SQLite şeması, dosya formatı bayt düzeni, dizin yapısı, SecureStore envanteri |
| [CLAUDE.md](CLAUDE.md) | Repo kuralları ve değişmezler (invariants) |

## Teknoloji

Expo SDK 57 · TypeScript (strict) · Expo Router · expo-camera · expo-video · expo-sqlite ·
expo-secure-store · expo-file-system (FileHandle stream I/O) · react-native-quick-crypto (JSI) · zustand
