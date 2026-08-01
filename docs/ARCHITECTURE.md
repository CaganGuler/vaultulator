# Mimari

## Genel bakış

Tamamen cihaz-içi (offline) bir kasa uygulaması. Üç katman:

```
┌─────────────────────────────────────────────────────┐
│  UI (Expo Router ekranları, src/app + src/components)│
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
    onboarding.tsx        # PIN belirleme + "kurtarma yok" onayı (yalnızca ilk açılış)
    lock.tsx              # ÇALIŞAN HESAP MAKİNESİ — kamuflaj + giriş yüzeyi
    (vault)/
      _layout.tsx         # FLAG_SECURE, ekran görüntüsü tepkisi, panik hareketi,
                          # hareketsizlik kilidi, vault Stack
      (tabs)/             # Galeri (index) / Notlar / Ayarlar
      camera.tsx          # tam ekran modal kamera (foto+video)
      media/[id].tsx      # tam ekran görüntüleyici (paylaş / sil)
      note/[id].tsx       # not editörü ('new' = yeni not)
      change-pin.tsx      # PIN değiştirme (modal) — oturumun KENDİ slotunu değiştirir
      decoy.tsx           # yem kasa + panik PIN yönetimi (modal, YALNIZCA primary)
  components/             # calculator, pin-pad, privacy-cover, thumb-tile, progress-overlay…
  hooks/                  # use-auto-lock, use-inactivity-lock, use-panic-gesture,
                          # use-media-items, use-notes, use-thumbnail
  lib/
    crypto/               # primitives (quick-crypto sarmalayıcı), keys (KDF/slot kaydı/escrow),
                          # format (.enc header), stream (chunked AEAD), fields (DB alanları)
    db/                   # connection (open/migrate, dışa açılmaz), index (meta),
                          # schema, scope (VaultContext), backfill, media-repo, notes-repo
    media/                # capture (ingest), viewer-cache (decrypt yaşam döngüsü), share
    base64.ts, paths.ts
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

- Ayarlar → "Yem kasa" satırı yalnızca primary oturumda render edilir; `decoy.tsx` ayrıca
  mount'ta rolü yeniden kontrol edip geri döner.
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
- **Hareketsizlik:** vault kökündeki capture-phase responder her dokunuşta 5 dk'lık
  zamanlayıcıyı sıfırlar (`use-inactivity-lock`).
- **Elle:** Ayarlar → "Şimdi kilitle".
- **Ekran görüntüsü:** iOS'ta `useScreenshotListener` (engelleyemiyoruz, algılıyoruz).
- **Panik hareketi:** sallamak (`use-panic-gesture`; 700 ms içinde iki kez > 2.4 g).
  İvmeölçer yalnızca kasa açıkken dinlenir.

Uygulama `inactive/background` olduğunda `PrivacyCover` (opak kapak) çizilir; uygulama
değiştirici ekran görüntüsünde içerik görünmez.

## Medya hattı

### Çekim (ingest) — `lib/media/capture.ts`

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
| Thumbnail (grid) | Belleğe çöz → base64 data-URI → `expo-image`; 80 girdilik LRU | Küçük (30-60 KB); düz veri diske hiç değmez |
| Tam boy fotoğraf | Belleğe çöz → data-URI (tek seferde bir tane, cache'lenmez) | Düz fotoğraf diske değmez |
| Video | `<cache>/decrypted/<id>.<ext>`'e çöz (ilerleme çubuğu) → `expo-video` | expo-video'ya stream-decrypt beslenemez; temp dosya zorunlu |

### Temp dosya yaşam döngüsü

`<cache>/decrypted/` şu anlarda **tamamen** silinir:
1. Her kilitlemede (`session.lock()`)
2. Her soğuk açılışta (`session.init()`) — çökme/zorla kapatma artıklarını temizler
3. Video görüntüleyici kapanırken (best effort, tekil dosya)

### Dışa aktarma — `lib/media/share.ts`

Açık onay ("bu içerik kasadan çıkıyor") → temp'e çöz → OS paylaşım ekranı → temp sil.

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
