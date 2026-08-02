# Kasa — Repo Kuralları

PIN korumalı, tamamen offline, şifreli medya/not kasası. Expo SDK 57 + TypeScript (strict) +
Expo Router. Native kripto (react-native-quick-crypto) nedeniyle **Expo Go çalışmaz** —
`npx expo run:ios|android` (dev-client) kullan.

Uygulama ana ekranda **"Hesap Makinesi"** olarak durur ve kilitliyken gerçekten çalışan bir
hesap makinesidir; PIN yazıp `=` ile açılır. Ayrı bir PIN **yem kasayı** (honeypot) açar.

## Komutlar

```bash
npm run verify        # typecheck + lint + test (coverage eşikleriyle) — CI ile aynı komut
npm test              # jest (kripto testleri node:crypto shim'iyle koşar)
npm run typecheck     # tsc --noEmit
npm run lint          # eslint
npx expo prebuild     # native projeleri üret/güncelle
```

Commit öncesi `npm run verify` geçmeli; husky pre-commit (değişen dosyalarda lint +
typecheck) ve pre-push (tam verify) bunu zorluyor, GitHub Actions da aynısını koşuyor.

## Değişmezler (invariants) — asla ihlal etme

1. **Düz DEK/dbKey asla persist edilmez.** Yalnızca `stores/session.ts` içindeki bellekte
   yaşar; kilitte sıfırlanır. Log'a, DB'ye, dosyaya, SecureStore'a düz anahtar yazma.
2. **Düz medya diske yalnızca `<cache>/decrypted/` altına yazılabilir** (video oynatma ve
   paylaşım). Bu dizin kilitte + açılışta silinir. Başka konuma düz içerik yazma.
3. **`expo-media-library` kurulmaz.** Galeri izolasyonu yapısal güvencedir; galeriye yazma
   yolu ekleyen her değişiklik bilinçli mimari karardır, sessizce yapılmaz.
4. **Kripto format değişikliği = versiyon artışı + migration.** `.enc` düzenine dokunan her
   değişiklik `format.ts`'teki versiyon baytını artırmalı ve eski dosyaları okuyabilmelidir.
   HKDF `info` (`vault/file/v1`, `vault/db/v1`, `vault/tag/v1`, `vault/decoy-escrow/v1`) ve
   AAD (`vault/slot/v1`, `vault/escrow/v1`) string'leri sabittir — değiştirmek tüm veriyi
   kilitler. `vault.slots` düzeni değişirse kayıt versiyon baytı artar + migration yazılır.
5. **Büyük dosyalar asla belleğe/base64'e alınmaz.** Medya şifreleme/çözme yalnızca
   `lib/crypto/stream.ts` üzerinden, FileHandle chunk I/O ile yapılır. `file.bytes()` /
   base64 round-trip'i medya için yasaktır (OOM).
6. **Kripto değişikliği testsiz merge edilmez.** `src/lib/crypto/__tests__/` round-trip +
   tamper (bit çevirme, sıralama, kırpma, ekleme, yanlış anahtar/id) senaryolarını kapsar;
   yeni davranış eklerken aynı düzeyde test ekle.
7. **Kasa verisine dokunan her sorgu `VaultContext` alır.** İki kasa tek `vault.db`'yi ve tek
   düz medya dizinini paylaşıyor; kapsamı unutmak çapraz sızıntıdır. Filtreleme yalnızca
   `src/lib/db/scope.ts`'teki `ownedRows()`/`owns()` üzerinden yapılır ve `getDb`
   `lib/db/index.ts`'ten dışa açılmaz. Satır etiketi **satır başına** HMAC'tir; kasa başına
   sabit bir etiket ikinci kasanın varlığını düz metinde kanıtlardı.
8. **Rol asla arayüz metnine sızmaz.** Arayüzün sorabileceği tek soru `useIsPrimary()`'dir.
   `decoy` ile `duress` oturumları ekranda birebir aynı görünmek zorundadır — ikisini ayıran
   herhangi bir ekran, panik PIN'inin varlığını ele verir. Aynı sebeple kilitli ekran yanlış
   PIN'de hiçbir geri bildirim vermez.
9. **Her PIN doğrulaması `attemptPin`'den geçer.** Backoff kapısı ve deneme sayacı
   `keys.ts`'te tek bir yerdedir. PIN doğrulayan yeni bir yol eklerken onu atlama —
   ölçülmeyen bir yol, kilidi açılmış bir oturumda sınırsız tahmin oracle'ıdır.
10. **`bundleIdentifier` değiştirilmez.** Değiştirmek iOS'ta yeni bir uygulama demektir;
   Keychain'deki pepper erişilemez hale gelir ve cihazdaki kasa kalıcı olarak kaybolur.
   Yeniden imzalama da **aynı sertifika/team** ile yapılmalıdır.

## Yapı

- `src/app/` yalnızca rota dosyaları (Expo Router). Ekran gövdesi büyürse `src/screens/`e taşı.
- Veri erişimi `src/lib/db/*-repo.ts` sade async fonksiyonları (ilk parametre `VaultContext`);
  zustand yalnızca oturum/ayarlar için. react-query/redux ekleme.
- Stil: `src/theme.ts` sabitleri; koyu tema tek kaynak.
- Dosya adları kebab-case; path alias `@/* → src/*`.

## Jest kurulumu

`package.json → jest.moduleNameMapper`: `react-native-quick-crypto` → `src/test/quick-crypto-node-shim.ts`
(node:crypto; argon2 yerine DETERMİNİSTİK scrypt taklidi — güvenlik değil mantık testi),
`expo-secure-store` → bellek içi mock, `expo-sqlite` →
`node:sqlite` (GERÇEK SQL, böylece migration/BLOB/rollback davranışı cihazdakiyle aynı),
`expo-crypto` → `node:crypto`, `expo-sharing` → çağrı kaydeden mock. **`expo-file-system`
bellek içi bir dosya sistemidir** (gerçek okuma/yazma, dizin listeleme, kısmi okuma
simülasyonu) — inert bir stub, `sweepOrphanFiles` gibi testleri sessizce boşa geçirir.
Stream testleri hem bellek adaptörlerini hem dosya adaptörlerini kapsar.

Coverage `collectCoverageFrom` ile bütün `src`'yi sayar (mock'lar hariç) ve dizin başına
eşikler vardır: `src/lib/crypto` ve `src/lib/db` neredeyse tam kapsam tutmak zorundadır —
invariant #6'yı zorunlu kılan mekanizma budur.

## Dokümantasyon senkronu

Şu değişiklikler ilgili dokümanı da güncellemelidir:
- Anahtar hiyerarşisi / KDF / format / slot kaydı → `docs/SECURITY.md` + `docs/DATA-MODEL.md`
- SQLite şeması (migration) → `docs/DATA-MODEL.md`
- Rota/modül ekleme → `docs/ARCHITECTURE.md`
- Kamuflajı ya da inkâr edilebilirliği etkileyen her şey → `docs/SECURITY.md` "Dürüst
  sınırlar". Yeni bir sızıntı kanalı kapatılamıyorsa sessizce bırakılmaz, yazılır.
