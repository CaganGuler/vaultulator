# Veri Modeli

## Dizin düzeni

```
<Paths.document>/vault/media/        şifreli orijinaller        <uuid>.enc
<Paths.document>/vault/thumbs/       şifreli küçük resimler     <uuid>.thumb.enc
<Paths.document>/SQLite/vault.db     expo-sqlite veritabanı
<Paths.cache>/decrypted/             GEÇİCİ düz içerik — tek izinli konum (invariant #2)
                                     p-<id>.<ext>      fotoğraf (viewer, LRU: 7 girdi / 96 MiB)
                                     <id>.<ext>        video / belge (basınca çözülür)
                                     export-<id>.<ext> onaylı paylaşım
                                     → kilitte + arka plan kilidinde + her açılışta silinir
```

Kamera çekim temp'leri expo-camera'nın kendi cache konumuna düşer ve ingest sonunda
`finally` bloğunda silinir.

## SQLite şeması (v3)

Şema `PRAGMA user_version` ile sürümlenir; migration listesi `src/lib/db/schema.ts`'dedir.

```sql
CREATE TABLE meta (            -- düz key-value: schema dışı ayarlar
  key   TEXT PRIMARY KEY,      -- autolock_seconds, inactivity_seconds
  value TEXT NOT NULL
);

CREATE TABLE media_items (
  id            TEXT PRIMARY KEY,        -- uuidv4 (expo-crypto randomUUID)
  type          TEXT NOT NULL CHECK (type IN ('photo','video','document')),
  file_name     TEXT NOT NULL,           -- vault/media/ altındaki ad: '<id>.enc'
  thumb_name    TEXT,                    -- vault/thumbs/ altındaki ad; belgelerde NULL
  mime          TEXT NOT NULL,           -- image/jpeg | video/mp4 | application/pdf | …
  size_bytes    INTEGER NOT NULL,        -- DÜZ (şifresiz) içerik boyutu
  width         INTEGER,
  height        INTEGER,
  duration_ms   INTEGER,                 -- yalnızca video; eski satırlar ilk oynatmada dolar
  created_at    INTEGER NOT NULL,        -- epoch ms
  vault_tag     BLOB,                    -- v2: HMAC(tagKey, id)[0..16] — sahiplik
  caption_enc   BLOB,                    -- v3: 64 B kovaya dolgulu, AAD '<id>:caption'
  orig_name_enc BLOB                     -- v3: 64 B kovaya dolgulu, AAD '<id>:orig_name'
);
CREATE INDEX idx_media_created ON media_items(created_at DESC);

CREATE TABLE albums (                    -- v3
  id         TEXT PRIMARY KEY,
  name_enc   BLOB NOT NULL,              -- AAD 'albums:<id>:name',  64 B kovaya dolgulu
  items_enc  BLOB NOT NULL,              -- AAD 'albums:<id>:items', 1024 B kovaya dolgulu
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  vault_tag  BLOB NOT NULL               -- tablo boş yaratıldı → ihlal edecek satır yok
);
CREATE INDEX idx_albums_updated ON albums(updated_at DESC);

CREATE TABLE notes (
  id         TEXT PRIMARY KEY,           -- uuidv4
  title_enc  BLOB NOT NULL,              -- iv(12) ‖ ct ‖ tag(16), anahtar K_db
  body_enc   BLOB NOT NULL,              -- aynı düzen
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  vault_tag  BLOB                        -- v2: HMAC(tagKey, id)[0..16] — sahiplik
);
CREATE INDEX idx_notes_updated ON notes(updated_at DESC);
```

### v2: satır sahiplik etiketi

İki kasa (gerçek + yem) tek `vault.db`'yi ve tek düz medya dizinini paylaşır. Ayrı dosya
ya da ayrı dizin kullanmak, cihazın imajını alan birine "burada iki kasa var" diye
bağırırdı.

```
vault_tag = HMAC-SHA256(tagKey, utf8(rowId))[0..16]
tagKey    = HKDF-SHA256(DEK, info = "vault/tag/v1")
```

**Kasa başına sabit bir etiket kullanılamaz.** Tekrar eden bir sabit, tabloyu düz metinde
ikiye bölerdi — yani ikinci kasanın varlığının kanıtı DB'de dururdu. Satır başına HMAC ile
her etiket benzersiz ve anahtar olmadan birbirine bağlanamaz; ne kasa sayısı ne de kasa
başına satır sayısı çıkarılabilir.

Bedeli: kapsam SQL `WHERE` ile verilemez. Satırlar çekilir ve `src/lib/db/scope.ts`
içindeki tek bir `ownedRows()` yardımcısıyla JS tarafında süzülür; `getVaultStats` ve
`countNotes` de JS'te toplanır (yoksa yem oturumu iki kasanın toplam boyutunu görürdü).
Tek çıkış noktası olması, kapsamı unutmayı da imkânsız kılıyor.

**Migration ve backfill.** v2 migration'ı yalnızca DDL'dir (`ALTER TABLE … ADD COLUMN`),
çünkü uygulama açılışta kilit açılmadan `getDb()` çağırıyor ve o noktada `tagKey` yok.
Mevcut satırlar ilk *primary* kilit açılışında, `status` `unlocked`'a dönmeden önce
etiketlenir (`src/lib/db/backfill.ts`). Bayrak tutulmaz: "NULL etiket kalmadı" koşulu
verinin kendisinde durur, tek transaction'dır ve geri sarılırsa bir sonraki açılışta
yeniden koşar.

Kolon `NULL` olabilir olmak zorunda — SQLite sabit bir varsayılan olmadan NOT NULL kolon
ekleyemez ve sabit varsayılan tam da olmaması gereken şeydir.

Tasarım kararları:
- **Kripto parametreleri DB'de tutulmaz** — her `.enc` dosyası kendi header'ını taşır.
  DB bozulsa bile dosyalar (DEK + itemId bilindiği sürece) çözülebilir kalır.
- **Sayısal metadata düz kalır** (sıralama/istatistik sorguları için). Sızan bilgi:
  öğe sayısı/boyutu/zamanı. İçerik sızmaz. (SECURITY.md → sınırlar #5)
- **Alan şifreleme AAD'si** `"notes:<rowId>:<kolon>"` — BLOB başka satıra/kolona
  kopyalanırsa açılmaz.
- **`meta` kasalar arasında paylaşılır.** İçinde yalnızca kilit süreleri var
  (`autolock_seconds`, `inactivity_seconds`) ve iki kasada aynı davranmaları *istenen*
  şeydir: farklı bir kilit süresi bir ipucu olurdu.
- **`PRAGMA secure_delete = ON`** — silinen satırlar freelist/WAL sayfalarında kalmasın
  (silinmiş bir yem kasa dosyadan kurtarılabilmemeli).

### v3: belge, açıklama, albüm

**`media_items` yeniden inşa edildi.** SQLite bir `CHECK` kısıtını `ALTER TABLE` ile
değiştiremez, `'document'` ise CHECK'in içinde. Migration `media_items_v3`'ü yaratır,
satırları **`vault_tag` dahil, NULL'lar dahil** kopyalar, eskiyi düşürür, yeniyi
adlandırır, dizini yeniden kurar. Yeni `type` değerleri eskinin üst kümesi olduğu için
kopyalama CHECK'e çarpmaz.

**En kritik nokta: NULL `vault_tag` yeniden inşadan sağ çıkmalı.** v1'de kalmış ve hiç kilidi
açılmamış bir cihaz v3'e her etiketi NULL olarak ulaşır; `backfillRowTags` onları ilk primary
açılışta sahiplenir. Kolonu NOT NULL yapmak tam da en eski veriyi taşıyan cihazlarda
migration'ı patlatırdı. `albums.vault_tag` ise NOT NULL — tablo boş yaratılıyor, ihlal edecek
satır yok. Bu asimetri kasıtlıdır ve `migration-v3.test.ts` onu sabitler.

**Albüm üyeliği birleşim tablosu DEĞİL.** `album_items(album_id, item_id, …)` `vault_tag`'in
var olma sebebini ortadan kaldırırdı: düz bir `album_id` eklendiği anda `GROUP BY album_id`
medya tablosunu denklik sınıflarına ayırıyor ve çoktan-çoğa ilişkide bağlı bileşenler
dosyalanmış her öğenin kasa dağılımını geri veriyor. Kabul ettiğimiz metadata sızıntısından
(SECURITY.md #5) nitelik olarak daha kötü. Üyelik bu yüzden albüm satırının **içinde**,
şifreli ve dolgulu bir id listesi olarak durur. Yan fayda: sıra bedava (dizinin kendisi
sıra), öğe sayısı bedava, 200 öğeyi toplu eklemek tek satır yazımı — ve `ownedRows()` tek
kapsamlama ilkesi olarak kalıyor.

**Dolgu sözleşmesi.** Metin, kovaya kadar NUL (`\u0000`) ile doldurulur; NUL aynı zamanda
sonlandırıcıdır. Kova: `items_enc` 1024 B, diğerleri 64 B. Bu bir *düz metin* sözleşmesidir,
kripto formatı değişikliği değil — invariant #4 tetiklenmiyor. Boşluk yerine NUL kullanılıyor,
yoksa boşluk içeren ilk açıklama kırpılırdı.

**Notlar bilerek dolgusuz.** Geriye dönük yeniden şifreleme `dbKey` ister, yani ikinci bir
anahtarlı backfill — `vault_tag` backfill'inin yanına ikinci bir "ilk açılışta koşan
migration" koymak, kazandırdığından fazlasını riske atardı. Not gövdesi uzunluğu bu yüzden
hâlâ bir uzunluk sınıfı sızdırıyor.

**Açıklamalar galeri sorgusunda çözülmez.** `listMediaItems` 2000 satırda sıfır kripto
yapıyor ve öyle kalması gerekiyor. Arama alanı açılınca `loadCaptionIndex(ctx)` bir kez
koşar (2000 GCM ≈ 10-40 ms), gerisi saf JS; `lock()` indeksi temizler. FTS5 reddedildi: düz
metin indeksi açıklamaları doğrudan `vault.db`'ye yazar, deterministik kelime hash'i ise
"bu iki satır kelime paylaşıyor mu" sorusunu cevaplanabilir kılar — tam da kaçındığımız
bölme fonksiyonu.

## `.enc` dosya formatı (bayt düzeni, v1)

```
offset  boyut  alan
0       4      magic "SVLT" (0x53 0x56 0x4C 0x54)
4       1      format versiyonu = 0x01
5       16     fileSalt   — HKDF salt'ı; fileKey = HKDF(DEK, fileSalt, "vault/file/v1")
21      7      noncePrefix
28      4      chunkSize (uint32 BE, düz bayt/chunk; varsayılan 1 MiB)
32      1      rezerve = 0x00
33      …      chunk'lar: her biri (chunkSize düz → chunkSize+16 şifreli; son chunk kısa olabilir)

Chunk i için:
  IV  = noncePrefix ‖ uint32BE(i) ‖ (sonChunk ? 0x01 : 0x00)
  AAD = header[0..33) ‖ utf8(mediaItemId)
  alg = AES-256-GCM(fileKey)
```

Boş dosya bile 1 (boş) chunk üretir — "boşluk" da doğrulanır.

## SecureStore envanteri

Hepsi `WHEN_UNLOCKED_THIS_DEVICE_ONLY` ile; 2048B/anahtar limitinin çok altında.

| Anahtar | İçerik | Boyut |
|---|---|---|
| `vault.pepper` | 32B rastgele, base64 — Argon2id `secret` girdisi | ~44 B |
| `vault.kdfParams` | JSON `{v, alg:'argon2id', memoryKiB, passes, parallelism}` + yükseltme sırasında geçici `fallback` | ~80 B (fallback varken ~160 B) |
| `vault.slots` | Kasa kaydı (aşağıda), base64 — **her zaman 326 B ham** | ~436 B |
| `vault.attempts` | JSON `{count, lockUntil}` — backoff durumu | ~40 B |
| `vault.log` | `iv(12) ‖ AES-256-GCM(logKey, 16 × float64 zaman damgası)` — **her zaman 156 B ham**; boş girdiler 0, dolgu gerekmez (uzunluk hiçbir şey açığa vurmuyor) | ~208 B |

Legacy (yalnızca migration sırasında okunur, sonra silinir): `vault.pinSalt`,
`vault.wrappedDek`.

### `vault.slots` düzeni

```
offset  boyut  alan
0       1      kayıt versiyonu = 0x01
1       16     pinSalt        — kasa ömrü boyunca sabit (SECURITY.md'ye bakın)
17      62×4   slot 0..3      — 0 primary, 1 decoy, 2 duress, 3 rezerve
265     61     escrow
toplam  326
```

```
slot_i  = iv(12) ‖ AES-256-GCM(KEK, payload, aad="vault/slot/v1") ‖ tag(16)
payload = fmtVer(1)=0x01 ‖ role(1) ‖ DEK(32)          role: 01 primary | 02 decoy | 03 duress

escrow  = iv(12) ‖ AES-256-GCM(K_esc, payload, aad="vault/escrow/v1") ‖ tag(16)
payload = flags(1) ‖ DEK_decoy(32)                    flags bit0 = duress kurulu
K_esc   = HKDF-SHA256(DEK_primary, info = "vault/decoy-escrow/v1")
```

Boş slotlar ve yem yokken escrow **kriptografik rastgele** baytlarla doludur. GCM çıktısı
rastgeleden ayırt edilemediği için dolgu ile gerçek içerik ayrılamaz; kayıt boyu sabit
olduğundan kaç PIN tanımlı olduğu görülmez.

Salt, slotlar ve escrow **tek bir kayıtta** durur. Ayrı SecureStore girdileri olsalardı
(a) aralarında bir çökme kasayı tuğlalaştırabilir, (b) Keychain'in değişiklik zaman damgası
"escrow X tarihinde yazılmış" diyerek yemin ne zaman eklendiğini sızdırırdı. Tek kayıtta
her işlem aynı girdiyi yeniden yazar.

**Düz DEK hiçbir kalıcı depoda bulunmaz** — yalnızca kasa açıkken `stores/session.ts`
içindeki `Uint8Array`'de yaşar; kilitte sıfırlanır.

## Bellekte tutulanlar (yalnızca `unlocked` durumda)

| Nerede | Ne | Ömrü |
|---|---|---|
| `session.ctx.dek` | 32B master key (açılan kasanınki) | kilide kadar |
| `session.ctx.dbKey` | HKDF türevi DB anahtarı | kilide kadar |
| `session.ctx.tagKey` | HKDF türevi satır etiketi anahtarı | kilide kadar |
| `session.ctx.role` | `primary` \| `decoy` \| `duress` — GCM ile doğrulanmış | kilide kadar |
| `viewer-cache` thumbnail LRU | ≤80 adet data-URI (~30-60 KB/adet) | kilide kadar |
| Foto görüntüleyici | tek data-URI | görüntüleyici kapanana kadar |
