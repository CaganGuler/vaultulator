# Güvenlik Tasarımı ve Tehdit Modeli

## Anahtar hiyerarşisi

```
PIN (kullanıcı, 6 hane, NFKC normalize)
  │
  ▼
Argon2id(salt = pinSalt[16B rastgele], secret = pepper, m = 64 MiB, t = 3, p = 4)
  │                    ▲
  │                    └── pepper: 32B rastgele; YALNIZCA Keychain/Keystore'da
  │                        (SecureStore, WHEN_UNLOCKED_THIS_DEVICE_ONLY — yedeklere taşınmaz)
  ▼
KEK (32B) ──► 4 slotun HEPSİ denenir (bkz. "Çok slotlu kasa")
                slot_i = IV(12B) ‖ AES-256-GCM(KEK, fmtVer ‖ role ‖ DEK)
              hangisi doğrularsa o kasanın DEK'i ve rolü elde edilir

DEK = 32B rastgele master key — kasa başına bir tane (gerçek ve yem ayrı)

Alt anahtarlar (domain separation):
  fileKey = HKDF-SHA256(DEK, salt = dosya başına fileSalt, info = "vault/file/v1")
  K_db    = HKDF-SHA256(DEK, info = "vault/db/v1")
  tagKey  = HKDF-SHA256(DEK, info = "vault/tag/v1")
```

**Pepper asıl savunma hattıdır.** 6 haneli bir PIN'in (10⁶ olasılık) hiçbir KDF ile offline
brute-force'a dayanması mümkün değildir. Pepper, Keychain/Keystore dışında hiçbir yerde var
olmadığından, uygulama dosyalarını veya bir yedeği ele geçiren saldırgan salt + ciphertext'e
sahip olsa bile KEK'i türetemez — kaba kuvvet fiziksel, kilidi açılabilir cihaz olmadan
imkânsızdır.

**PIN doğrulaması = GCM tag kontrolü.** Slot yanlış KEK ile açılınca auth tag tutmaz →
`WrongPinError`. Ayrı bir doğrulayıcı blob yoktur. Çok slotlu kasayı doğal kılan da bu:
"PIN doğru mu" sorusu zaten "hangi slot açılıyor" sorusuyla aynı şey.

**PIN unutulursa veri kurtarılamaz — bilinçli tasarım.** Escrow/kurtarma anahtarı yoktur.
Onboarding'de açıkça onaylatılır. "Kasayı sıfırla" yolu her şeyi siler.

**PIN değiştirme** aynı DEK'i yeni KEK ile yeniden sarar; medya asla yeniden şifrelenmez.
Yalnızca oturumun kendi slotu değişir (`changePin(old, new, requiredRole)`).

**`pinSalt` kasa ömrü boyunca sabittir.** Slotlar tek bir KEK türetmesini paylaştığı için
salt döndürmek diğer slotları kilitlerdi. Slot-başına-salt alternatifi kilit açarken slot
sayısı kadar Argon2id (4 × 64 MiB) koşmayı gerektirir; hem yavaş hem de hangi slotun
açıldığını ele veren bir zamanlama kanalıdır.

Bu **küçük ama gerçek bir gerileme**: eskiden her PIN değişimi salt'ı döndürdüğü için,
pepper + salt bir kez çalınmışsa (root'lu cihaz — zaten kapsam dışı) önceden hesaplanmış
bir KEK sözlüğü geçersizleşiyordu. Sabit salt'ta o sözlük kalıcı olarak geçerli kalır.
Asıl duvar hâlâ pepper: onsuz sözlük hiç kurulamaz.

## Çok slotlu kasa: yem (honeypot) ve panik PIN'i

Zorlama altında verilecek ikinci bir PIN, ayrı ve tamamen bağımsız bir kasa açar. Kayıt
düzeni `docs/DATA-MODEL.md`'de; buradaki konu güvenlik özellikleri.

| Slot | Rol | Sarar |
|---|---|---|
| 0 | primary | `DEK_primary` |
| 1 | decoy | `DEK_decoy` |
| 2 | duress | `DEK_decoy` (üçüncü bir DEK değil) |
| 3 | rezerve | — (her zaman rastgele dolgu) |

**Escrow tek yönlüdür.** `escrow = AES-GCM(HKDF(DEK_primary, "vault/decoy-escrow/v1"),
DEK_decoy)`. Gerçek oturum yemin PIN'ini, yemin PIN'ini bilmeden değiştirebilir; yem
oturumunda ters bir escrow yoktur, yani `DEK_primary`'ye hiçbir yoldan ulaşılamaz. İstenen
asimetri budur: yem yalnızca kendi PIN'ini değiştirir, gerçek kasa ikisini de yönetir.

**Rol, ayar değil anahtar malzemesidir.** Rol baytı GCM ile doğrulanan payload'ın içindedir
ve slot konumuyla eşleşmek zorundadır; yem oturumundaki biri onu değiştiremez. Arayüzün
sorabileceği tek soru `role === 'primary'`'dir — `decoy` ile `duress`'i ayıran bir ekran,
panik PIN'inin varlığını sızdırırdı.

**Aynı PIN iki role atanamaz.** Paylaşılan salt yüzünden aynı PIN aynı KEK'i üretir; iki
slot birden açılırsa hangi kasanın açılacağı slot sırasına kalırdı. Her PIN kurma akışı
diğer dolu slotları dener ve çakışmayı reddeder; kilit açmada birden fazla slot doğrularsa
`VaultCorruptError` ile fail-closed olunur.

**Zamanlama.** Kilit açarken erken çıkış yoktur, dört slot da denenir. Argon2id (64 MiB,
t=3) dört adet ~50 baytlık AES-GCM işlemini beş büyüklük mertebesi domine ediyor; JS
zamanlama gürültüsü farkı zaten yutuyor.

**Panik (duress) PIN'i.** Girildiğinde `unlockVault` içinde, dönmeden önce, tek bir yazımla
primary slot ve escrow rastgeleyle ezilir — anlık, atomik ve geri dönüşsüz. Ardından yem
kasa hiçbir gecikme olmadan açılır ve deneme sayacı normal bir başarı gibi sıfırlanır.
İmha çağıranın atlayabileceği bir yerde değil, anahtar katmanındadır.

Dosyalar **silinmez**: zorlanmış bir kilit açma sırasında gigabaytlarca dosya silmek görünür
saniyeler alır ve bu başlı başına bir ipucudur. DEK gittiği için şifreli kabuk zaten
kurtarılamaz. Kalıntının forensic olarak görünür kalması bilinçli bir takastır.

**Yem oturumunda "kasayı sıfırla"** yalnızca yemin satırlarını ve dosyalarını siler;
anahtarlara dokunmaz ve `uninitialized`'a geçmez. Yem PIN'i bundan sonra boş bir kasa açar
— kendi içinde tutarlı bir "her şeyi sildim" hikâyesi.

## Dosya formatı (`*.enc`)

```
Header (33B): "SVLT" | ver(1B)=0x01 | fileSalt(16B) | noncePrefix(7B) | chunkSize(4B BE) | rezerve(1B)
Gövde: N × [ AES-256-GCM(chunk) ‖ tag(16B) ]
  IV_i  = noncePrefix(7B) ‖ chunkIndex(4B BE) ‖ sonChunkBayrağı(1B: 0x00|0x01)
  AAD_i = header(33B) ‖ utf8(mediaItemId)
```

Tink `AES-GCM-HKDF-STREAMING` / age STREAM tasarımının birebir uygulamasıdır:

| Saldırı | Savunma |
|---|---|
| Chunk'ları yeniden sıralama | IV'deki chunk sayacı |
| Dosyayı kırpma (truncation) | Son chunk bayrağı IV'de doğrulanır |
| Sona veri ekleme | Son chunk bayrağı + sayaç |
| Dosyaları birbiriyle değiştirme (file swap) | AAD'deki `mediaItemId` DB satırına bağlar |
| Header oynama | Header, her chunk'ın AAD'sinde |

Test kapsamı: `src/lib/crypto/__tests__/stream.test.ts` bu saldırıların her birinin
reddedildiğini doğrular.

## DB alan şifrelemesi

Not başlığı/gövdesi: `iv(12B) ‖ ct ‖ tag(16B)` BLOB'u, anahtar `K_db`,
AAD = `"notes:<rowId>:<kolon>"` — bir satırın ciphertext'i başka satıra/kolona
taşınırsa doğrulama tutmaz.

## Tehdit modeli

| Saldırgan | Yeteneği | Sonuç |
|---|---|---|
| Telefonu eline alan kişi (kilitli kasa) | Uygulamayı açar | PIN pad + üstel backoff; içerik görünmez |
| Dosya sistemi erişimi (yedek, adb, iTunes yedeği, çalıntı disk imajı) | Tüm `.enc` dosyaları + SQLite + salt okur | **Okuyamaz.** Pepper yedekte/dosya sisteminde yok → KEK türetilemez; içerik AES-256-GCM |
| Cihaz yedeğini geri yükleyen kişi | Yedekten dosyalar döner | Kasa açılamaz (pepper taşınmadı) — "yalnızca bu cihaz" vaadinin ters yüzü |
| Root/jailbreak'li CANLI cihaz | Keystore'u ve süreç belleğini okur | Pepper'ı alabilir → PIN brute-force artık Argon2id hızında; kasa AÇIKKEN DEK bellekte dump edilebilir. **Kapsam dışı** — dürüstçe belirtilir |
| Omuz sörfü / ekran kaydı | Ekranı izler | Android: FLAG_SECURE ekran görüntüsü/kaydı/son uygulamalar küçük resmini engeller. iOS: ekran görüntüsü ENGELLENEMEZ ama ALGILANIR → anında kilit |
| Uygulama değiştirici (app switcher) | Snapshot görür | Gizlilik örtüsü hesap makinesi yüzünü çizer; snapshot'ta kasaya dair hiçbir şey yok |
| **Zorlama (coercion)** | Kullanıcıyı PIN vermeye zorlar | Yem PIN'i inandırıcı ama ayrı bir kasa açar; yem oturumundan gerçek kasanın varlığı görünmez. Son çare panik PIN'i gerçek kasanın anahtarını imha eder. **Sınırları aşağıda** |
| Uygulamayı açan meraklı | Uygulamaya bakar | Çalışan bir hesap makinesi görür; yanlış PIN + `=` hiçbir tepki üretmez |

## Dürüst sınırlar

1. **iOS ekran görüntüsü engellenemez.** İşletim sistemi buna izin vermez; Android'deki
   FLAG_SECURE eşdeğeri yoktur.
2. **Root'lu cihazda canlı saldırı kapsam dışıdır.** Keystore + süreç belleği okunabilir.
3. **Bellek sıfırlama best-effort'tur.** JS motoru `Uint8Array` içeriğini kopyalamış
   olabilir; garanti edilen değişmez, DEK'in *diske* asla yazılmamasıdır.
4. **Flash wear-leveling gerçek güvenli silmeyi engeller.** Temp dosyalar silinir ama
   fiziksel hücrelerde iz kalabilir. Hafifletme: temp ömrü saniyeler mertebesinde, iOS
   `NSFileProtectionComplete` cihaz kilitliyken dosyaları ayrıca şifreler.
5. **Metadata sızıntısı:** öğe sayısı, boyutları, çekim zamanları SQLite'ta düz durur
   (sıralama/sorgu için). İçerik değil, varlık bilgisi sızar.
6. **Backoff sayacı UI caydırıcısıdır.** Root'lu cihaz SecureStore'daki sayacı
   sıfırlayabilir; asıl duvar pepper + Argon2id'dir.
7. **Yem kasanın inkâr edilebilirliği arayüz düzeyindedir, forensic düzeyde değildir.**
   Doğru iddia şudur: *kilidi açılmış bir yem kasayı arayüzden inceleyen biri gerçek
   kasanın varlığını göremez.* Cihazın imajını alan biri için durum farklıdır:

   Gerçekten sağlam olan — sabit 326 baytlık `vault.slots` kaydı. Dolgu ile GCM şifreli
   metni ayırt edilemez, rol şifreli payload'ın içinde, boy sabit ve her işlem aynı Keychain
   girdisini yeniden yazıyor; kaç PIN tanımlı olduğu görülemez. Satır başına HMAC etiketi de
   DB'den kasa sayısını çıkarmayı engelliyor.

   Sağlam OLMAYAN — işletim sistemi uygulamanın 2 GB yer kapladığını gösterirken yem kasa üç
   fotoğraf gösterir; düz dizinlerdeki dosya sayısı yemin satır sayısıyla uyuşmaz; tek
   oturumda doldurulmuş yem içeriğinin `created_at` kümelenmesi parmak izi bırakır; panik
   PIN'inden sonra ölü satırlar ve çözülemez dosyalar yerinde kalır. Hiçbiri VeraCrypt tarzı
   önceden ayrılmış gizli bölüm olmadan giderilemez ve bu uygulamada pratik değildir.

8. **Boş bir yem kasa en büyük ele veren şeydir.** Kripto burada yardım edemez: yemi
   inandırıcı içerikle doldurmak kullanıcının işidir. Arayüz bunu hatırlatır.
9. **Panik PIN'inin geri dönüşü yoktur.** Yanlışlıkla girilirse gerçek kasa gider. Kurulumda
   çift giriş, kendi PIN'iyle onay ve gerçek PIN'e bir hane uzaklıktaki PIN'lerin reddi
   var; bunlar riski azaltır, ortadan kaldırmaz.
10. **Kamuflajın sınırı var.** Hesap makinesi kamera ve mikrofon izni istiyor ve iOS
    Ayarlar → Gizlilik altında öyle görünüyor. İzin metinleri "fiş/belge tarama" gerekçesine
    çevrildi; bu makul kılar, tamamen gizlemez.
11. **Hesap makinesi yanlış PIN'de sessizdir.** Bunun bedeli gerçek kullanıcıya çıkar:
    "yanlış mı yazdım yoksa backoff kilidinde miyim" ayrımını göremez. Bu ayrımı gösteren
    her şey, yabancıya da hesap makinesinin bir kapı olduğunu söylerdi.

## Platform yapılandırması

- **Android:** `allowBackup=false` (AndroidManifest) — `adb backup` / auto-backup kasa
  verisi içermez. FLAG_SECURE vault rotalarında aktif.
- **iOS:** `com.apple.developer.default-data-protection = NSFileProtectionComplete`
  entitlement'ı; Keychain girdileri `WHEN_UNLOCKED_THIS_DEVICE_ONLY`.
- **Galeri izolasyonu yapısaldır:** `expo-media-library` paketi kurulu bile değildir;
  koda galeriye yazma yolu eklemek bağımlılık eklemeyi gerektirir (PR'da görünür).
- **Kimlik:** uygulama ana ekranda "Hesap Makinesi" adı ve hesap makinesi ikonuyla durur;
  kilitli durum çalışan bir hesap makinesidir, PIN yazıp `=` ile açılır.
  `bundleIdentifier` bilinçli olarak DEĞİŞMEDİ — değiştirmek iOS'ta yeni bir uygulama
  demektir ve Keychain'deki pepper erişilemez hale gelir, yani mevcut kasa kaybolur.
  Aynı sebeple yeniden imzalama **aynı sertifika/team** ile yapılmalıdır.
- **Ekran görüntüsü tepkisi:** iOS'ta `useScreenshotListener` ile anında kilit.
- **Panik hareketi:** kasa içindeyken sallamak anında kilitler (`expo-sensors`, izin
  gerektirmez; yalnızca kasa açıkken dinlenir).

## Kripto değişiklik kuralları

- `.enc` düzeninde her değişiklik header'daki versiyon baytını artırmak ve eski sürümü
  okuyabilen migration yazmak zorundadır.
- KDF parametre değişikliği `vault.kdfParams`'ta sürümlüdür; kilit açılışında eski
  parametrelerle türetip yenisiyle yeniden sarmak yeterlidir (ileride Argon2id maliyet
  artırımı için hazır).
- `info` string'leri (`vault/file/v1`, `vault/db/v1`, `vault/tag/v1`,
  `vault/decoy-escrow/v1`) ve AAD string'leri (`vault/slot/v1`, `vault/escrow/v1`)
  sabittir; değiştirmek tüm veriyi okunamaz kılar.
- `vault.slots` düzenindeki her değişiklik kayıt versiyon baytını artırmalı ve eski kaydı
  okuyabilen bir migration getirmelidir. Mevcut örnek: tek slotlu v1 (`vault.wrappedDek`)
  → çok slotlu kayıt dönüşümü, kilit açma anında, aynı KEK ile, ekstra Argon2id olmadan.
