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

DEK'ten TÜREMEYEN tek anahtar — pepper'dan gelir, çünkü kasa KİLİTLİYKEN gerekir:
  logKey  = HKDF-SHA256(pepper, info = "vault/log/v1")   (başarısız deneme günlüğü)
```

**Pepper asıl savunma hattıdır.** 6 haneli bir PIN'in (10⁶ olasılık) hiçbir KDF ile offline
brute-force'a dayanması mümkün değildir. Pepper, Keychain/Keystore dışında hiçbir yerde var
olmadığından, uygulama dosyalarını veya bir yedeği ele geçiren saldırgan salt + ciphertext'e
sahip olsa bile KEK'i türetemez — kaba kuvvet fiziksel, kilidi açılabilir cihaz olmadan
imkânsızdır.

**Her PIN doğrulaması ölçülür.** Backoff kapısı ve deneme sayacı `keys.ts` içindeki tek
bir `attemptPin()`'de; `unlockVault`, `changePin` ve `verifyPinForRole` üçü de oradan geçer.
Çağıranın atlayabileceği bir yerde olsaydı, kilidi açılmış bir oturum sınırsız tahmin
oracle'ı olurdu — zorlama altındaki bir yem oturumu için tam da olmaması gereken şey.

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

Tek istisna: **KDF yeniden sarma** (aşağıda) salt'ı da döndürür — ama yalnızca tek slot
doluyken çalıştığı için kilitleyecek başka slot yoktur.

## KDF parametrelerini yükseltme

Argon2id maliyetini artırmak, yalnızca yeni kurulan kasalara uygularsa işe yaramaz;
telefonda **duran** kasaya ulaşması gerekir. `DEFAULT_KDF_PARAMS.v` arttığında ilk başarılı
kilit açılışında kayıt yeni parametrelerle (ve yeni bir salt'la) yeniden sarılır. Medya
yeniden şifrelenmez — değişen tek şey DEK'in sarımı.

**Yem ya da panik PIN'i kuruluysa parametreler donar.** Her slotu yeniden sarmak her PIN'i
bilmeyi gerektirir ve yem PIN'i bizim isteyeceğimiz bir şey değil. Gerçek bir sınır; üç PIN
soran bir akışla gizlenmiyor.

**İki kayıt, tek işlem yok.** Parametreler `vault.kdfParams`'ta, sarım `vault.slots`'ta ve
SecureStore'da transaction yok — aradaki bir çökme kasayı tuğlalaştırırdı, çünkü yeni
parametreler eski sarımı açamaz. Bu yüzden yeni parametreler yazılırken eskisi `fallback`
alanında **yanına** yazılır: `attemptPin` açamazsa fallback'le bir kez daha dener, sonraki
başarılı açılış da yarım kalan işi tamamlar veya fallback'i düşürür. Fallback varken yanlış
PIN iki Argon2id koşusu kadar sürer — yani "bekleyen bir yükseltme var" bilgisi zamanlamadan
okunabilir; kimsenin işine yaramayacak bir bilgi.

## Başarısız deneme günlüğü

Backoff sayacı her başarılı açılışta sıfırlanır, dolayısıyla asıl soruyu yanıtlayamaz:
*telefon elimde değilken biri denedi mi?* `vault.log` son 16 başarısız denemenin zaman
damgasını tutar; yazan tek yer `recordFailedAttempt`.

Denemeler kasa **kilitliyken** olduğu için ortada DEK yok — anahtar pepper'dan türer. Bunun
dürüst sonucu: bu günlük kasanın anahtar hiyerarşisinin **dışında** ve yem oturumunu tutan
şey kriptografi değil, arayüz (sınır #17).

Kayıt **sabit boyutludur** ve kasa kurulurken yazılır. Büyüyen bir günlük düz metin bir
sayaç, yalnızca ilk hatadan sonra var olan bir kayıt ise düz metin bir "burada bir şey oldu"
biti olurdu. Bu özellikten önce kurulmuş kasalarda ilk açılışta geriye dönük oluşturulur.
Yazma hatası yutulur: bir denetim izi, kimsenin kendi kasasına erişememesinin sebebi olamaz.

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

**Yem oturumu "PIN değiştir" ekranından hiçbir şey öğrenemez.** Yeni PIN başka bir slota
aitse bu, sıradan bir yanlış PIN olarak raporlanır ve iki KEK de karar verilmeden önce
türetilir, yani ret her durumda aynı süreyi alır. Aksi halde ekran üç ayırt edilebilir
cevap verirdi ve bu tek başına gerçek kasanın varlığını kanıtlar, PIN'ini sayarak
buldurtur ve panik PIN'inin kurulu olduğunu açık ederdi. Ana kasada çakışma açıkça
söylenir — orada gizlenecek bir şey yok.

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
| Görüntü önbelleği (kapatıldı) | `<cache>` altındaki SDWebImage/Glide dizinlerini okur | **Kapatıldı.** `expo-image`'ın `cachePolicy` varsayılanı `'disk'` ve hiçbir yerde ayarlanmamıştı: baktığın her küçük resim ve her fotoğraf düz olarak `<cache>/decrypted/` DIŞINA yazılıyordu; o dizinler ne kilitte ne açılışta siliniyordu. Artık her `<Image>` `cachePolicy="memory"` kullanıyor, kilitte `Image.clearMemoryCache()`, açılışta bir kez `Image.clearDiskCache()` (eski sürümlerin sızdırdığını temizler). `useImage()`/`Image.loadAsync()` **kullanılmaz** — `cachePolicy: .disk` orada sabit kodlu, geçersiz kılınamıyor. Statik bir test bunu koruyor |
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
   fiziksel hücrelerde iz kalabilir. **Bu sınır büyüdü:** fotoğraflar da artık
   `<cache>/decrypted/` altına çözülüyor (base64 data URI'si 20 MB'lık bir fotoğrafta
   ~100 MB tepe bellek yapıyordu — invariant #5'in lafzen ihlali ve OOM'da kasayı
   gezinirken kilitleyen bir çökme). Yani düz görüntü artık "saniyeler" değil, **görüntüleme
   oturumu boyunca** (dakikalar mertebesinde) diskte duruyor; pencere dışına çıkan sayfalar,
   viewer'ın kapanışı ve kilit onu siler.

   Kime yarar? Canlı root'lu saldırgan zaten kapsam dışı ve DEK'i bellekten okuyabiliyor;
   soğuk imaj için dosya yalnızca kasa açık ve uygulama ön plandayken var, o durumda cihaz
   zaten ele geçmiş; iOS'ta `NSFileProtectionComplete` cihaz kilitliyken dosyayı ayrıca
   şifreliyor. Gerçekten kötüleşen tek şey bu maddenin kendisi: wear-leveling penceresi
   uzadı.
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

   Kapatamadığımız iki kanal daha: **(a)** kapsam JS tarafında yapıldığı için galeri her
   açılışta *her iki* kasanın satırlarını çekip süzüyor — yani yem oturumunun yüklenme
   süresi gerçek kasanın satır sayısıyla birlikte artıyor ve diğer kasanın id/boyut/zaman
   verisi (içeriği değil) o an yem oturumunun JS heap'inde bulunuyor. **(b)** pepper
   SecureStore'dan JS **string** olarak geliyor; string'ler sıfırlanamaz.

8. **İçe aktarılan içeriğin orijinali galeride kalır.** İçe aktarma sistem seçicisini
   (`expo-image-picker`) kullanır; bu `expo-media-library` değildir, galeriye yazma yolu
   açmaz ve iOS'ta galeri izni istemez — ama aynı sebeple uygulama **orijinali silemez**.
   Kullanıcı galeriden kendisi silmediği sürece kasadaki kopya bir sır değildir. Arayüz
   içe aktarma sonrası bunu açıkça söyler.
9. **Boş bir yem kasa en büyük ele veren şeydir.** Kripto burada yardım edemez: yemi
   inandırıcı içerikle doldurmak kullanıcının işidir. Arayüz bunu hatırlatır.
10. **Panik PIN'inin geri dönüşü yoktur.** Yanlışlıkla girilirse gerçek kasa gider. Kurulumda
   çift giriş, kendi PIN'iyle onay ve gerçek PIN'e bir hane uzaklıktaki PIN'lerin reddi
   var; bunlar riski azaltır, ortadan kaldırmaz.
11. **Kamuflajın sınırı var.** Hesap makinesi kamera ve mikrofon izni istiyor ve iOS
    Ayarlar → Gizlilik altında öyle görünüyor. İzin metinleri "fiş/belge tarama" gerekçesine
    çevrildi; bu makul kılar, tamamen gizlemez.
12. **Hesap makinesi yanlış PIN'de sessizdir.** Bunun bedeli gerçek kullanıcıya çıkar:
    "yanlış mı yazdım yoksa backoff kilidinde miyim" ayrımını göremez. Bu ayrımı gösteren
    her şey, yabancıya da hesap makinesinin bir kapı olduğunu söylerdi.

13. **Albüm sayısı yem kasanın en zayıf noktası.** `COUNT(*) FROM albums` düz okunabiliyor.
    2000 dosya "çöp birikmiş" diye savuşturulabilir; yem 1 albüm gösterirken tabloda 31
    satır olması kasıtlı bir düzenlemenin kanıtıdır. Üyelik listesi satırın içinde şifreli
    (`items_enc`) olduğu için *hangi* öğenin hangi albümde olduğu görünmez — ama satır
    sayısı görünür.
14. **`length(items_enc)` albüm boyutunu ±26 öğeye kadar sızdırır** (1024 baytlık kova).
    `name_enc`, `caption_enc` ve `orig_name_enc` için kova 64 bayt. Dolgu her satıra
    yazıldığı için "bu öğenin açıklaması var mı" biti kalkıyor; kalan şey uzunluk sınıfı.
15. **`type='document'` ve belge MIME'ları sınır #5'in genişlemesidir.** `image/jpeg` az şey
    söyler, `application/x-keepass` çok şey. Ayrıca **`vault/media` ile `vault/thumbs`
    dosya sayısı farkı belge sayısını veriyor** — belgelerin küçük resmi yok, yani bu sayı
    veritabanına hiç dokunmadan okunabiliyor.
16. **Dışa aktarma adları.** Viewer geçicisi `<id>.<ext>` kullanır, yalnızca kullanıcının
    onayladığı paylaşım orijinal adı taşır. Sınır #4 dizin girdileri için de geçerli: silinen
    bir dosya adı fiziksel olarak kalabilir.
17. **Başarısız deneme günlüğünü yem oturumundan gizleyen şey arayüzdür.** Anahtar
    pepper'dan türüyor (kasa kilitliyken yazmak zorunda), dolayısıyla süreç içinde yem
    oturumu da teknik olarak çözebilir; yalnızca ekran gösterilmiyor. Pepper'a erişen biri
    zaten zaman damgalarını okuyabilir — bu, sınır #2'nin (canlı root) bir alt kümesi.
18. **Yem oturumunun albüm sekmesi de gerçek kasanın albüm sayısıyla yavaşlar.** Sınır
    #7(a)'daki JS tarafı kapsamlama kanalı yeni bir yüzey kazandı: `ownedRows()` her iki
    kasanın albüm satırlarını çekip süzüyor.
19. **Android'de kasadan dışarı paylaşma kapalıdır.** `Sharing.shareAsync` uygulamayı arka
    plana düşürüyor → otomatik kilit → `wipeDecryptedDir()` alıcının okuyacağı dosyayı
    siliyor. Kilidi ertelemek bir güvenlik özelliğini paylaşma uğruna devre dışı bırakmak
    olurdu, o yüzden düğme iOS'ta gösteriliyor, Android'de gösterilmiyor. Toplu paylaşmada
    öğe başına onay korunuyor — 40 dosya için tek bir toptan onay, tek öğe yolunun verdiği
    sözden daha zayıf bir söz olurdu.

## Platform yapılandırması

- **Android:** `allowBackup=false` (AndroidManifest) — `adb backup` / auto-backup kasa
  verisi içermez. FLAG_SECURE vault rotalarında aktif.
- **iOS:** `com.apple.developer.default-data-protection = NSFileProtectionComplete`
  entitlement'ı; Keychain girdileri `WHEN_UNLOCKED_THIS_DEVICE_ONLY`.
- **Kasadan dışarı paylaşma yalnızca iOS'ta.** Android'de sistem seçicisi ayrı bir
  activity; uygulama arka plana düşüyor, kasa kilitleniyor (varsayılan ayar "Hemen") ve
  `wipeDecryptedDir()` tam da alıcı uygulamanın okumak üzere olduğu düz dosyayı siliyor.
  Alternatif — paylaşım uçarken kilidi ertelemek — kasayı bir uygulama geçişi boyunca açık
  tutmak demekti; oysa tam o an kapanması gereken an. Özelliği yarım bırakmayı, güvenlik
  özelliğini delmeye tercih ettik.
- **Görüntü önbelleği bellekte tutulur.** `expo-image`'ın `cachePolicy` varsayılanı
  `'disk'` ve bu, çözülmüş küçük resimlerle fotoğrafların SDWebImage (iOS) / Glide
  (Android) önbelleklerine — yani `<cache>/decrypted/` **dışına**, kilitte ve açılışta
  silinmeyen bir yere — yazılması demekti. Bir sürüm boyunca öyle gitti ve invariant #2'nin
  doğrudan ihlaliydi. Artık her `<Image>` `cachePolicy="memory"` kullanıyor, `lock()`
  bellek önbelleğini de boşaltıyor ve açılışta bir kez `clearDiskCache()` çağrılarak eski
  sürümlerin bıraktığı ne varsa temizleniyor. `useImage()` / `Image.loadAsync()`
  kullanılmıyor: onlar disk önbelleğini sabit kodluyor ve geçersiz kılınamıyor.
  Bir test (`src/components/__tests__/image-cache-policy.test.ts`) her `<Image>`'ın bu
  prop'u taşıdığını doğruluyor.
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
