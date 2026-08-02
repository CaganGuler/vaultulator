# Veri Modeli

## Dizin düzeni

```
<Paths.document>/vault/media/        şifreli orijinaller        <uuid>.enc
<Paths.document>/vault/thumbs/       şifreli küçük resimler     <uuid>.thumb.enc
<Paths.document>/SQLite/vault.db     expo-sqlite veritabanı
<Paths.cache>/decrypted/             GEÇİCİ düz içerik (video oynatma, paylaşım)
                                     → kilitte + arka plan kilidinde + her açılışta silinir
```

Kamera çekim temp'leri expo-camera'nın kendi cache konumuna düşer ve ingest sonunda
`finally` bloğunda silinir.

## SQLite şeması (v2)

Şema `PRAGMA user_version` ile sürümlenir; migration listesi `src/lib/db/schema.ts`'dedir.

```sql
CREATE TABLE meta (            -- düz key-value: schema dışı ayarlar
  key   TEXT PRIMARY KEY,      -- autolock_seconds, inactivity_seconds
  value TEXT NOT NULL
);

CREATE TABLE media_items (
  id          TEXT PRIMARY KEY,          -- uuidv4 (expo-crypto randomUUID)
  type        TEXT NOT NULL CHECK (type IN ('photo','video')),
  file_name   TEXT NOT NULL,             -- vault/media/ altındaki ad: '<id>.enc'
  thumb_name  TEXT,                      -- vault/thumbs/ altındaki ad: '<id>.thumb.enc'
  mime        TEXT NOT NULL,             -- image/jpeg | video/mp4 | video/quicktime
  size_bytes  INTEGER NOT NULL,          -- DÜZ (şifresiz) içerik boyutu
  width       INTEGER,
  height      INTEGER,
  duration_ms INTEGER,                   -- yalnızca video
  created_at  INTEGER NOT NULL,          -- epoch ms
  vault_tag   BLOB                       -- v2: HMAC(tagKey, id)[0..16] — sahiplik
);
CREATE INDEX idx_media_created ON media_items(created_at DESC);

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
| `vault.kdfParams` | JSON `{v, alg:'argon2id', memoryKiB, passes, parallelism}` | ~80 B |
| `vault.slots` | Kasa kaydı (aşağıda), base64 — **her zaman 326 B ham** | ~436 B |
| `vault.attempts` | JSON `{count, lockUntil}` — backoff durumu | ~40 B |

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
