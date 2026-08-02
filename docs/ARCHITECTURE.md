# Mimari

## Genel bakış

Tamamen cihaz-içi (offline) bir kasa uygulaması. Üç katman:

```
┌─────────────────────────────────────────────────────┐
│  UI (rotalar src/app · ekran gövdeleri src/screens ·  │
│      bileşenler src/components)                      │
├─────────────────────────────────────────────────────┤
│  Oturum & durum (zustand: stores/session, settings)  │
├──────────────┬──────────────┬───────────────────────┤
│ lib/crypto   │ lib/db       │ lib/media             │
│ anahtarlar,  │ SQLite repo  │ çekim, thumbnail,     │
│ stream, alan │ katmanı      │ görüntüleme, paylaşım │
├──────────────┴──────────────┴───────────────────────┤
│ SecureStore (anahtarlar) · SQLite (metadata+notlar)  │
│ Dosya sistemi (şifreli *.enc medya)                  │
└─────────────────────────────────────────────────────┘
```

## Modül haritası

```
src/
  app/                    # Expo Router rotaları (yalnızca rota dosyaları)
    _layout.tsx           # kök Stack + Stack.Protected guard'ları + gizlilik örtüsü
    index.tsx             # yönlendirme kapısı (loading → onboarding|lock|vault)
    +not-found.tsx        # eşleşmeyen rota → hesap makinesi (kamuflaj koruması)
    onboarding.tsx        # PIN belirleme + "kurtarma yok" onayı (yalnızca ilk açılış)
    lock.tsx              # ÇALIŞAN HESAP MAKİNESİ — kamuflaj + giriş yüzeyi
    (vault)/
      _layout.tsx         # FLAG_SECURE, ekran görüntüsü tepkisi, panik hareketi,
                          # hareketsizlik kilidi, vault Stack
      (tabs)/             # Galeri (index) / Albümler / Notlar / Ayarlar
      camera.tsx          # tam ekran modal kamera (foto+video)
      media/[id].tsx      # kaydırmalı görüntüleyici — gövdesi src/screens/media-viewer
      note/[id].tsx       # not editörü ('new' = yeni not) + kontrol listesi modu
      album/[id].tsx      # tek albüm (yeniden adlandır / sil / öğe çıkar)
      change-pin.tsx      # PIN değiştirme (modal) — oturumun KENDİ slotunu değiştirir
      decoy.tsx           # yem kasa + panik PIN yönetimi (modal, YALNIZCA primary)
      attempts.tsx        # başarısız deneme günlüğü (modal, YALNIZCA primary)
  screens/                # rota dosyasına sığmayan ekran gövdeleri (media-viewer)
  components/             # calculator, pin-pad, privacy-cover, thumb-tile, progress-overlay,
                          # empty-state, media/{photo,video,document}-page
  hooks/                  # use-auto-lock, use-inactivity-lock, use-panic-gesture,
                          # use-media-items, use-notes, use-thumbnail
  lib/
    crypto/               # primitives (quick-crypto sarmalayıcı), keys (KDF/slot kaydı/escrow),
                          # attempt-log (kilitliyken yazılan günlük),
                          # format (.enc header), stream (chunked AEAD), fields (DB alanları)
    db/                   # connection (open/migrate, dışa açılmaz), index (meta), schema,
                          # scope (VaultContext), backfill, media-repo, notes-repo, albums-repo
    media/                # capture (ingest), import (sistem seçicisi), photo-cache (fotoğraf
                          # LRU'su), gallery-order (filtre/sıra, saf), viewer-cache, share
    notes/                # checklist (saf '- [ ]' ayrıştırıcısı)
    activity.ts, base64.ts, paths.ts
  stores/                 # session (kilit durum makinesi + VaultContext), settings
  test/                   # jest shim'leri (quick-crypto→node:crypto, SecureStore, FS,
                          # SQLite→node:sqlite, expo-crypto)
  theme.ts
```

## Kamuflaj: hesap makinesi giriş rotası

Kilitli durum bir PIN pad değil, gerçekten hesap yapan bir hesap makinesidir
(`components/calculator.tsx`). Sade 6 haneli bir sayı girip `=` tuşuna basmak kilidi açar;
başka her şey normal hesap makinesi davranışıdır. **Yanlış PIN hiçbir tepki üretmez** —
titreşim, hata metni, spinner yok; bunlardan herhangi biri sayının bir şeyle
karşılaştırıldığını ele verirdi.

Aynı bileşen `interactive={false}` ile `PrivacyCover`'ı da çizer, böylece uygulama
değiştirici snapshot'ında da hesap makinesi görünür (eskiden orada bir asma kilit ikonu
vardı — arka plana her geçişte kamuflajı bozardı).

Rota yapısı değişmedi: `Stack.Protected guard={status === 'locked'}` hâlâ `lock.tsx`'i
çiziyor, yalnızca içeriği değişti. `onboarding.tsx` hesap makinesinin arkasına saklanmaz:
ilk açılışta saklanacak bir şey henüz yoktur ve kullanıcının "kurtarma yok" uyarısını
görmesi gerekir.

## Rol duyarlı arayüz

`session.ctx.role` GCM ile doğrulanmış anahtar malzemesinden gelir (bkz. SECURITY.md).
Arayüzün sorabileceği **tek** soru `useIsPrimary()`'dir; `decoy` ile `duress` oturumları
ekranda birbirinden ayırt edilemez olmak zorundadır.

- Ayarlar → "Yem kasa" ve "Başarısız denemeler" satırları yalnızca primary oturumda render
  edilir; `decoy.tsx` ayrıca mount'ta rolü yeniden kontrol edip geri döner.
- **Albümler ve belgeler iki oturumda birebir aynıdır** — bu özelliklerin hiçbir yerinde
  `useIsPrimary()` yok. Albüm oluşturamayan bir yem kasa, tam olarak invariant #8'in
  yasakladığı ipucudur.
- Ayarlar → "Kasayı sıfırla" iki oturumda birebir aynı metni ve akışı gösterir; yalnızca
  sonucu farklıdır (primary: `destroy()`, yem: `wipeOwnContent()`).
- `change-pin.tsx` değişmedi — `session.changePin` rolü kendi içinde kapsıyor.

## Kilit durum makinesi (`stores/session.ts`)

```
loading ──init()──► uninitialized          (SecureStore'da kasa yok)
                 └► locked                 (kasa var)
uninitialized ──create(pin)──► unlocked
locked ──unlock(pin) doğru──► unlocked     { ctx = dek, dbKey, tagKey, role }
       ──unlock(pin) yanlış──► locked      (deneme sayacı + backoff)
unlocked ──lock()──► locked
```

Hangi kasanın açıldığını girilen PIN belirler. **Yerinde kasa değişimi yoktur** — her rol
geçişi `lock()` yolundan geçer.

`unlock()` başarıda, `status` `unlocked`'a dönmeden **önce**, primary oturum için şema v2
backfill'ini `await` eder (bkz. DATA-MODEL.md); aksi halde kullanıcı güncelleme sonrası ilk
açılışta boş bir kasa görürdü. Ayrıca thumbnail LRU'su burada da boşaltılır: panik PIN'iyle
giriş, öncesinde bir `lock()` olmadan yem oturumuna düşüyor.

`lock()` sırasıyla: `decrypted/` temp dizinini siler → thumbnail LRU'sunu boşaltır →
`ctx` içindeki bütün `Uint8Array`'leri sıfırlar → durumu `locked` yapar. Rota koruması
`Stack.Protected guard={status === 'unlocked'}` ile merkezidir; kilitlenince vault
rotaları otomatik olarak erişilmez olur.

Kilit tetikleyicileri:
- **Arka plan:** `AppState` dinleyicisi (`use-auto-lock`). `autoLockSeconds = 0` ⇒ arka
  plana geçer geçmez kilit; aksi halde dönüşte geçen süreye bakılır.
- **Hareketsizlik:** son etkinlik damgası artık `lib/activity.ts`'te, modül seviyesinde.
  Vault kökündeki capture-phase responder **ve** her gesture-handler jesti (`onBegin` →
  `runOnJS(noteActivity)`) onu tazeler. Damga hook'un içindeyken kaydırmanın onu tazelemesi
  garanti değildi: RNGH dokunuşları native tarafta sahiplenince RN responder'ı hiç
  çalışmayabiliyor, yani fotoğraflar arasında gezinmek hareketsizlik gibi görünüp kasayı
  gezinirken kilitleyebiliyordu. `use-inactivity-lock` 15 sn'de bir süreyi kontrol eder. Süre
  Ayarlar'dan seçilir (`meta.inactivity_seconds`, varsayılan 5 dk).
  **`session.busy > 0` iken bu sayaç beklemeye alınır** — büyük bir video şifrelemesi
  dakikalarca sürüyor ve hiç dokunma üretmiyor, araya girmek pipeline'ın hâlâ kullandığı
  anahtarları sıfırlardı. Kasıtlı kilitler (elle, sallama, ekran görüntüsü, arka plan)
  etkilenmez.
- **Elle:** Ayarlar → "Şimdi kilitle".
- **Ekran görüntüsü:** iOS'ta `useScreenshotListener` (engelleyemiyoruz, algılıyoruz).
- **Panik hareketi:** sallamak (`use-panic-gesture`; 700 ms içinde iki kez > 2.4 g).
  İvmeölçer yalnızca kasa açıkken dinlenir.

Uygulama `inactive/background` olduğunda `PrivacyCover` (opak kapak) çizilir; uygulama
değiştirici ekran görüntüsünde içerik görünmez.

## Hata sınırı

`_layout.tsx` bir `ErrorBoundary` export ediyor: altındaki her render hatasında önce
`lock()` çağırıp içeriği ekrandan kaldırıyor, sonra hesap makinesini çiziyor ve bir kez
otomatik retry deniyor. Kırmızı kutu ya da stack trace göstermek kamuflajı anında bozardı.
`+not-found.tsx` aynı işi eşleşmeyen deep link'ler için yapıyor.

## Medya hattı

### Çekim (ingest) — `lib/media/capture.ts`

`insertMediaItem`'dan hemen önce `assertStillCurrent(ctx)` çağrılır: `lock()` context'in
tamponlarını yerinde sıfırladığı için, araya giren bir kilit satırı sıfır anahtarla
etiketlenmiş halde yazardı — hiçbir kasaya ait olmayan, görünmez ve kurtarılamaz bir öğe.
Şimdi temiz bir iptalle sonuçlanıyor ve mevcut `catch` yazılmış ciphertext'i siliyor.


```
CameraView.takePictureAsync({exif:false}) / recordAsync()
  → temp dosya (uygulama cache'i; galeriye ASLA yazılmaz, expo-media-library kurulu değil)
  → thumbnail üret (foto: ImageManipulator 512px JPEG; video: VideoThumbnails + resize)
  → orijinali stream-encrypt et  → vault/media/<uuid>.enc
  → thumbnail'i encrypt et       → vault/thumbs/<uuid>.thumb.enc
  → bütünlük kontrolü (şifreli dosya var ve > 0 bayt)
  → media_items satırı ekle
  → finally: temp orijinal + temp thumbnail silinir
```

Hata durumunda yarım kalan `.enc` dosyaları temizlenir (DB satırı en son yazıldığı için
yarım kayıt oluşmaz).

### Görüntüleme — `lib/media/viewer-cache.ts`

| İçerik | Yöntem | Neden |
|---|---|---|
| Thumbnail (grid) | Belleğe çöz → base64 data-URI → `expo-image`; 300 girdilik LRU | Küçük (~40 KB); düz veri diske hiç değmez |
| Tam boy fotoğraf | `<cache>/decrypted/p-<id>.<ext>`'e çöz → `expo-image` diskten okur; 7 girdi / 96 MiB LRU, seri kuyruk (`lib/media/photo-cache.ts`) | Data-URI yolu 20 MB'lık bir fotoğrafta ~100 MB tepe bellek yapıyordu; dosya yolunda tepe ~2 MiB. Bedeli SECURITY.md sınır #4'te |
| Video | `<cache>/decrypted/<id>.<ext>`'e çöz (ilerleme çubuğu) → `expo-video` | expo-video'ya stream-decrypt beslenemez; temp dosya zorunlu |
| Belge | `<cache>/decrypted/<id>.<ext>`'e çöz → `react-native-pdf` | Aynı gerekçe; **yalnızca basınca** çözülür |

**Her `<Image>` `cachePolicy="memory"` kullanmak zorunda** ve `useImage()`/`Image.loadAsync()`
kullanılmaz — `cachePolicy: .disk` orada sabit kodlu. Statik bir test
(`components/__tests__/image-cache-policy.test.ts`) her ikisini de zorluyor. Gerekçe:
SECURITY.md tehdit tablosundaki "görüntü önbelleği" satırı.

**Önden yükleme yalnızca fotoğrafları çözer** (`prefetchPhotos`, `type !== 'photo'` süzgeci).
Bir videonun yanından kaydırıp geçmek 500 MB'ı diske çözmeye başlamamalı; bu kural tek bir
yerde zorlanıyor.

### Temp dosya yaşam döngüsü

`<cache>/decrypted/` şu anlarda **tamamen** silinir:
1. Her kilitlemede (`session.lock()`) — dönüş değeri kontrol edilir ve bir kez yeniden
   denenir; hayatta kalan bir dosya invariant #2 ihlalidir, sessizce geçilemez
2. Her soğuk açılışta (`session.init()`) — çökme/zorla kapatma artıklarını temizler

Tekil silmeler (best effort):
3. Video/belge sayfası render penceresinden çıkarken
4. Fotoğraf LRU'sundan tahliye olurken; viewer kapanınca tüm `p-*` dosyaları
   (`wipeDecryptedDir()` **değil** — uçan bir paylaşım `export-*` yazıyor olabilir)
5. Paylaşım bittiğinde (`share.ts`, `finally`)

### Dışa aktarma — `lib/media/share.ts`

Açık onay ("bu içerik kasadan çıkıyor") → temp'e çöz → OS paylaşım ekranı → temp sil.
Toplu paylaşmada onay **öğe başına** korunur. **Android'de kapalı** (`canShareOut()`):
`shareAsync` uygulamayı arka plana düşürüyor, otomatik kilit devreye giriyor ve
`wipeDecryptedDir()` alıcının okuyacağı dosyayı siliyor.

## Veri erişim deseni

Ağır bir state kütüphanesi yok. Veri, `lib/db/*-repo.ts` içindeki sade async fonksiyonlarla
okunur; ekranlar `useFocusEffect` tabanlı küçük hook'larla (`use-media-items`, `use-notes`)
tazelenir. zustand yalnızca oturum/kilit ve ayarlar için kullanılır.

**Her içerik sorgusu ilk parametre olarak `VaultContext` alır** (`lib/db/scope.ts`).
İki kasa aynı DB'yi paylaştığı için kapsamı unutmak sessiz bir çapraz sızıntı olurdu; zorunlu
parametre bunu derleme hatasına çeviriyor. `getDb` bilerek `lib/db/index.ts`'ten dışa
açılmaz — yalnızca repo modülleri `./connection`'a erişir.

## Neden bu teknolojiler?

- **react-native-quick-crypto (JSI/Nitro):** Node `crypto` API'si; donanım hızlandırmalı
  AES-GCM; `Uint8Array`'ler köprüden kopyasız geçer (base64 yok). Argon2id desteği içinde —
  tek kripto bağımlılığıyla KDF + AEAD + HKDF + CSPRNG karşılanır.
- **expo-file-system FileHandle:** `readBytes/writeBytes` ile 1 MiB'lik parçalar halinde
  akış; 500 MB video için tepe JS belleği ~2-3 MiB (bkz. SECURITY.md → OOM riski).
- **expo-secure-store:** Keychain/Keystore erişimi. Yalnızca ~100 baytlık sarılı anahtarlar
  saklanır; 2048 bayt limiti sorun değildir.
- **Expo Router Stack.Protected:** Kilit garanti altında — `unlocked` olmayan durumda vault
  rotaları ağaçta bile yer almaz.
