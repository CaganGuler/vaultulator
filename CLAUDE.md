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

Derleme, cihaza kurulum ve **imzalama** için `docs/BUILD.md`. Orada tek bir kural var ki
ihlali geri alınamaz: cihaza giden her sürüm aynı `bundleIdentifier` ve aynı team/sertifika
ile imzalanmalı, yoksa Keychain'deki pepper erişilemez olur ve kasa kalıcı olarak gider.

## Commit kuralları

Commit'ler yalnızca repo sahibinin adıyla atılır: commit mesajlarına ve PR açıklamalarına
`Co-Authored-By: Claude ...` gibi bir AI/araç imzası **eklenmez**.
(`.claude/settings.json → attribution` bunu Claude Code için otomatik kapatıyor;
kural diğer araçlar için de geçerli.)

## Otomatik korumalar (bunlara çarpınca "düzeltme" değil, tasarım)

Invariant'ların çoğu hatırlamaya bırakılmadı; araçlar zorluyor. Bir kurala çarptığında
çözüm onu susturmak değil, kuralın işaret ettiği yolu kullanmaktır.

| Araç | Ne zorluyor |
|---|---|
| `no-console: error` | Invariant #1 — düz anahtar materyali log'a sızmasın. Test dizinlerinde kapalı |
| `no-restricted-imports: expo-media-library` | Invariant #3 — galeriye yazma yolu bir import'la eklenemez |
| `no-restricted-imports: **/db/connection` | Invariant #7 — `getDb()` `src/lib/db` dışına çıkmaz; `VaultContext` alan bir repo fonksiyonu kullan (`src/lib/db/**` ve testler muaf) |
| `image-cache-policy.test.ts` | Invariant #2 — her `<Image>` `cachePolicy` vermek zorunda, `useImage`/`Image.loadAsync` yasak. Statik kaynak taraması (yorumları soyup arar; yorum içindeki kelimeyi sayan ilk sürümü prop yokken de geçiyordu) |
| Dizin başına coverage tabanı | Invariant #6 — `src/lib/crypto` ≥ %90/95, `src/lib/db` ≥ %88, `src/stores` ≥ %55; global taban %28 |
| husky pre-commit → `lint-staged` | Değişen dosyalarda eslint (`--max-warnings=0 --fix`) + tam typecheck |
| husky pre-push → `npm run verify` | CI ile birebir aynı komut, kırmızı build sürpriz olmasın |
| `.github/workflows/ci.yml` | `verify` + `expo-doctor`. `npm audit` ayrı ve **bilerek gate değil**: mevcut uyarılar bundle'a girmeyen bir build-time transitive bağımlılıktan (uuid ← xcode ← @expo/config-plugins) geliyor ve `audit fix --force` expo'yu on bir major sürüm geriye alıyor |

**Kapsam boşlukları kasıtlı.** `src/app` coverage'a hiç dahil değil (rota dosyaları ince).
`src/components/media` ve `src/screens` %0'da duruyor ve **öyle kalmalı** — worklet/jest
mock'larıyla yazılacak test, mock'un kurulduğunu doğrular, yakınlaştırmanın çalıştığını
değil. Bu boşluğu "kapatmak" için yazılan test negatif değerlidir.

## Değişmezler (invariants) — asla ihlal etme

1. **Düz DEK/dbKey asla persist edilmez.** Yalnızca `stores/session.ts` içindeki bellekte
   yaşar; kilitte sıfırlanır. Log'a, DB'ye, dosyaya, SecureStore'a düz anahtar yazma.
2. **Düz medya diske yalnızca `<cache>/decrypted/` altına yazılabilir** (fotoğraf/video
   görüntüleme, belge, paylaşım). Bu dizin kilitte + açılışta silinir. Başka konuma düz
   içerik yazma. Bu, **görüntü önbelleklerini de kapsar**: her `<Image>` `cachePolicy="memory"`
   vermek zorunda ve `useImage()`/`Image.loadAsync()` kullanılmaz (`cachePolicy: .disk` orada
   sabit kodlu, geçersiz kılınamıyor). `components/__tests__/image-cache-policy.test.ts`
   bunu zorluyor.
3. **`expo-media-library` kurulmaz.** Galeri izolasyonu yapısal güvencedir; galeriye yazma
   yolu ekleyen her değişiklik bilinçli mimari karardır, sessizce yapılmaz.
4. **Kripto format değişikliği = versiyon artışı + migration.** `.enc` düzenine dokunan her
   değişiklik `format.ts`'teki versiyon baytını artırmalı ve eski dosyaları okuyabilmelidir.
   HKDF `info` (`vault/file/v1`, `vault/db/v1`, `vault/tag/v1`, `vault/decoy-escrow/v1`,
   `vault/log/v1`) ve
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
11. **Sabit boyutlu SecureStore kayıtları sabit kalır.** `vault.slots` (326 B) ve `vault.log`
   (156 B) uzunlukları inkâr edilebilirliğin parçasıdır: büyüyen bir kayıt düz metin bir
   sayaç, koşullu var olan bir kayıt düz metin bir bayrak olur. Boş alan rastgele dolgu
   (`vault.slots`) ya da şifreli sıfır (`vault.log`) ile doldurulur. İkisinin de testi var.

## Yapı

- `src/app/` yalnızca rota dosyaları (Expo Router). Ekran gövdesi büyürse `src/screens/`e taşı
  (`media-viewer` böyle taşındı). Yeni rota eklerken tipli rota tanımları dev server ilk
  açılışta yeniden üretilir — `npx expo start` bir kez koşmadan `router.push('/yeni')`
  typecheck'ten geçmez.
- **Mantık `src/lib/**`'te, bileşenler ince.** Coverage `src/app`'i hariç tutuyor ama
  `components`/`hooks`/`screens`'i tutuyor; ayrıştırıcı/hesap gibi şeyleri saf modüle
  koymak hem test edilebilir hem eşikleri aşağı çekmez (`lib/notes/checklist.ts`,
  `lib/media/gallery-order.ts` bu yüzden ayrı).
- Veri erişimi `src/lib/db/*-repo.ts` sade async fonksiyonları (ilk parametre `VaultContext`);
  zustand yalnızca oturum/ayarlar için. react-query/redux ekleme.
- Stil: `src/theme.ts` sabitleri; koyu tema tek kaynak.
- Dosya adları kebab-case; path alias `@/* → src/*`.
- `PIN_LENGTH` (`lib/crypto/keys.ts`) tek kaynaktır ve **iki tüketicisi anlaşmak zorunda**:
  `pin-pad` o kadar nokta çiziyor, `calculator` tam o kadar çıplak haneyi kilit denemesi
  sayıyor. Birini değiştirip diğerini bırakmak ön kapıyı sessizce çalışmaz hale getirir.

## Reanimated / gesture-handler kuralları

React Compiler açık (`experiments.reactCompiler`) ve lint kuralları error seviyesinde:

- Render gövdesinde **asla** `sharedValue.value` okuma/yazma (`react-hooks/purity`).
- Shared value'ya `*Ref` adı verme — `enableTreatRefLikeIdentifiersAsRefs` açık, kural onu
  ref sanır.
- Jest callback'leri yalnızca shared value ve modül fonksiyonlarını kapatsın, React state'ini
  değil: state kapatan bir jest her değişimde `GestureDetector`'ı yeniden bağlar.
- Bileşen içinde bileşen tanımlama.
- Yakınlaştırılmışken pager'ı durdurmak `.blocksExternalGesture(pagerRef)` ile yapılır —
  ilişki native tarafta değerlendirilir. Shared value'yu state'e yansıtıp `scrollEnabled`
  sürmek bir-iki kare gecikir ve o arada sayfalama olur; `scrollEnabled` yalnızca yedek.
- **Jest/worklet için bileşen testi yazılmaz.** RNGH/Reanimated mock'larıyla worklet'ler
  koşmuyor ve jest callback'leri hiç çağrılmıyor; test bir mock'un kurulduğunu doğrular,
  yakınlaştırmanın çalıştığını değil. Negatif değerli kapsam.

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
- Rota/modül ekleme, temp dosya yaşam döngüsü → `docs/ARCHITECTURE.md`
- Kamuflajı ya da inkâr edilebilirliği etkileyen her şey → `docs/SECURITY.md` "Dürüst
  sınırlar". Yeni bir sızıntı kanalı kapatılamıyorsa sessizce bırakılmaz, yazılır.
- Native bağımlılık, `app.json`, imza/kurulum yordamı → `docs/BUILD.md`
- Invariant sayısı ya da listesi değişirse → `CLAUDE.md` **ve** `AGENTS.md` (AGENTS.md sayıyı
  metin olarak yazıyor, ikisi ayrışabiliyor)
