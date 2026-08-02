# Derleme, İmzalama ve Cihaza Kurulum

Bu depoda **en yüksek riskli işlem derleme değil, imzalamadır.** Yanlış imza kimliğiyle
kurulan bir sürüm, cihazdaki kasayı kalıcı olarak erişilemez hale getirir. Sebep aşağıda;
önce çalıştırma.

## Neden Expo Go çalışmaz

`react-native-quick-crypto` bir JSI/Nitro native modülüdür ve Expo Go'nun sabit binary'sinde
yok. Argon2id, AES-256-GCM ve HKDF oradan geliyor — yani Expo Go'da uygulama açılmaz, kilit
ekranı bile çizilmez. Her zaman dev-client / prebuild yolu kullanılır.

```bash
nvm use                 # .nvmrc → Node 24
npm install
npx expo prebuild       # ios/ + android/ üretir (ikisi de .gitignore'da)
npx expo run:ios        # simülatör
npx expo run:android    # emülatör
```

## `ios/` ve `android/` neden depoda yok

İkisi de **üretilmiş** dizinlerdir; doğruluk kaynağı `app.json`. `.gitignore` onları bilerek
dışlıyor, çünkü depoda tutulan bir native proje ile `app.json` sessizce ayrışır ve sonra hangi
tarafın doğru olduğu belirsiz kalır.

Bunun bedeli: **`npx expo prebuild --clean` native tarafta elle yapılmış her değişikliği
siler.** Native bir şey gerekiyorsa `app.json` içindeki config plugin'lerine yazılır, Xcode'da
tıklanmaz. Bugün gereken her şey (entitlement, izin metinleri, `allowBackup=false`, splash,
adaptive icon) zaten orada.

## Yeni rota eklediysen

Tipli rota tanımları (`.expo/types/router.d.ts`) dev server ilk açılışta üretilir. `npx expo
start` bir kez koşmadan `router.push('/yeni-rota')` **typecheck'ten geçmez** —
`npx expo export` bunu üretmez, sadece dev server üretir. Belirti: var olan bir rotaya
"not assignable to parameter of type" hatası.

## 🔴 İmzalama: kasayı kaybettiren yol

Kasanın anahtarı iki parçadır: PIN'den türeyen KEK ve Keychain'de duran 32 baytlık **pepper**.
Pepper, iOS'un Keychain erişim grubuna — yani `bundleIdentifier` + imzalayan **team**'e —
bağlıdır. Şu iki şeyden biri değişirse iOS bunu *başka bir uygulama* sayar:

| Değişen | Sonuç |
|---|---|
| `bundleIdentifier` (`com.caganguler.secretvault`) | Yeni uygulama. Pepper'a erişilemez. **Kasa kalıcı olarak gider.** |
| İmzalayan sertifika / team ID | Keychain erişim grubu değişir. Aynı sonuç. |

`.enc` dosyaları ve `vault.db` cihazda durmaya devam eder ama pepper olmadan hiçbir PIN onları
açamaz — kurtarma yolu yoktur, tasarım gereği (`docs/SECURITY.md`). CLAUDE.md invariant #10
bu yüzden var.

**Kural: cihaza kurulan her sürüm, öncekiyle AYNI bundle id ve AYNI team/sertifika ile
imzalanmalıdır.** Emin değilsen kurmadan önce doğrula:

```bash
# Cihazda kurulu olanı (Xcode → Devices) ya da eldeki .ipa'yı kontrol et
codesign -dvvv --entitlements - /path/to/Kasa.app 2>&1 | grep -E "TeamIdentifier|Identifier="
```

`TeamIdentifier` iki sürümde farklıysa **kurma.** Kurarsan geri dönüş yok.

Güncellemeden önce içeriği kaybetmeyi göze alamıyorsan: kasada kritik veri varken imza
kimliğini değiştirme senaryosu için tek güvenli yol, önce içeriği uygulama içinden dışa
aktarmaktır (`Paylaş`, iOS). Yedekleme özelliği bilerek yok — bir yedek, kasanın tüm tehdit
modelini yedeğin güvenliğine indirirdi.

## Derleme çıktısı

`build/` ve `*.ipa` `.gitignore`'da: Xcode DerivedData gigabaytlar tutar ve IPA içindeki
payload imzalanmış bir binary'dir, uzak bir depoya hiç gitmemeli.

`build/ipa/Payload/*.app` **imzasız** bir yapıdır (`codesign -dv` → "not signed at all").
İmzalama ve cihaza kurma adımı bu depoda otomatik değildir; Xcode ile ya da bir sideload
aracıyla, yukarıdaki kimlik kuralına uyarak elle yapılır.

### Kurulu sürümün kimliğini doğrulama

`app.json → name` uygulamanın ana ekranda görünen adıdır (`CFBundleDisplayName`). Kamuflaj
adı **"Hesap Makinesi"**. Eldeki bir yapının bunu gerçekten taşıdığını kontrol et:

```bash
plutil -extract CFBundleDisplayName raw build/ipa/Payload/*.app/Info.plist
```

`Kasa` çıkıyorsa o yapı kamuflaj değişikliğinden **önceye** aittir; cihazda o duruyorsa
uygulama ana ekranda hâlâ "Kasa" olarak görünüyor demektir ve kamuflajın yarısı yok.

## Kolay kırılan bağımlılıklar

- **`expo-system-ui` kaldırılmaz.** `app.json → backgroundColor` onu gerektiriyor; olmadan
  prebuild uyarı verir ve arka plan rengi uygulanmaz. Bir kez "kullanılmıyor" diye kaldırıldı,
  geri konuldu.
- **`expo-media-library` kurulmaz** (invariant #3). Galeri izolasyonu, paketin *yokluğuyla*
  garanti ediliyor; eslint ayrıca importunu engelliyor.
- **Native modül eklemek prebuild gerektirir.** `react-native-pdf` ve
  `expo-document-picker` eklendikten sonra `npx expo prebuild` koşuldu; Podfile.lock'ta
  görünmeyen bir modül çalışma zamanında "undefined is not an object" olarak patlar.

## Kurulum sonrası duman testi

Bir sürümü cihaza attıktan sonra, sırayla:

1. Ana ekranda ad ve ikon **hesap makinesi** mi?
2. Uygulama açılıyor ve hesap makinesi gerçekten hesap yapıyor mu? (Açılmıyorsa native
   kripto bağlanmamış demektir.)
3. Mevcut PIN kasayı açıyor mu? — **Açmıyorsa hemen dur.** Yanlış imza kimliği olabilir;
   uygulamayı silmek pepper'ı da siler ve geri dönüşü olmayan adımı tamamlar.
4. Fotoğraf/video/not/albüm sayıları güncellemeden önceki gibi mi? (Şema göçü kontrolü —
   `docs/DATA-MODEL.md` v3 bölümü.)
5. Kilitle, yem PIN'iyle gir: gerçek kasanın içeriği görünmemeli.
