import { HEADER_LEN } from '../format';
import { GCM_TAG_LEN, IntegrityError, randomBytes } from '../primitives';
import { bytesReader, bytesWriter, decryptStream, encryptStream } from '../stream';

const CHUNK = 1024; // small chunk size so tests cover multi-chunk paths

async function encrypt(dek: Uint8Array, itemId: string, plain: Uint8Array): Promise<Uint8Array> {
  const writer = bytesWriter();
  await encryptStream({ dek, itemId, reader: bytesReader(plain), writer, chunkSize: CHUNK });
  return writer.toBytes();
}

async function decrypt(dek: Uint8Array, itemId: string, sealed: Uint8Array): Promise<Uint8Array> {
  const writer = bytesWriter();
  await decryptStream({ dek, itemId, reader: bytesReader(sealed), writer });
  return writer.toBytes();
}

describe('stream round-trip', () => {
  const dek = randomBytes(32);

  it.each([0, 1, CHUNK - 1, CHUNK, CHUNK + 1, 3 * CHUNK + 517])('round-trips %i bytes', async (size) => {
    const plain = randomBytes(size);
    const sealed = await encrypt(dek, 'item-1', plain);
    expect(sealed.length).toBe(HEADER_LEN + Math.max(1, Math.ceil(size / CHUNK)) * GCM_TAG_LEN + size);
    const out = await decrypt(dek, 'item-1', sealed);
    expect(Buffer.from(out)).toEqual(Buffer.from(plain));
  });

  it('produces different ciphertexts for the same plaintext (random salt/nonce)', async () => {
    const plain = randomBytes(100);
    const a = await encrypt(dek, 'item-1', plain);
    const b = await encrypt(dek, 'item-1', plain);
    expect(Buffer.from(a)).not.toEqual(Buffer.from(b));
  });

  it('reports progress', async () => {
    const sizes: number[] = [];
    const writer = bytesWriter();
    await encryptStream({
      dek,
      itemId: 'item-1',
      reader: bytesReader(randomBytes(2 * CHUNK + 10)),
      writer,
      chunkSize: CHUNK,
      onProgress: (p) => sizes.push(p.processedBytes),
    });
    expect(sizes).toEqual([CHUNK, 2 * CHUNK, 2 * CHUNK + 10]);
  });
});

describe('stream tamper resistance', () => {
  const dek = randomBytes(32);

  it('rejects a flipped ciphertext byte', async () => {
    const sealed = await encrypt(dek, 'item-1', randomBytes(3 * CHUNK));
    sealed[HEADER_LEN + 5] ^= 0xff;
    await expect(decrypt(dek, 'item-1', sealed)).rejects.toThrow(IntegrityError);
  });

  it('rejects a flipped header byte (AAD binding)', async () => {
    const sealed = await encrypt(dek, 'item-1', randomBytes(CHUNK));
    sealed[HEADER_LEN - 1] ^= 0x01; // reserved byte is part of the AAD
    await expect(decrypt(dek, 'item-1', sealed)).rejects.toThrow(IntegrityError);
  });

  it('rejects reordered chunks', async () => {
    const sealed = await encrypt(dek, 'item-1', randomBytes(3 * CHUNK));
    const sealedChunk = CHUNK + GCM_TAG_LEN;
    const swapped = Uint8Array.from(sealed);
    swapped.set(sealed.subarray(HEADER_LEN + sealedChunk, HEADER_LEN + 2 * sealedChunk), HEADER_LEN);
    swapped.set(sealed.subarray(HEADER_LEN, HEADER_LEN + sealedChunk), HEADER_LEN + sealedChunk);
    await expect(decrypt(dek, 'item-1', swapped)).rejects.toThrow(IntegrityError);
  });

  it('rejects truncation at a chunk boundary', async () => {
    const sealed = await encrypt(dek, 'item-1', randomBytes(3 * CHUNK));
    const truncated = sealed.subarray(0, HEADER_LEN + 2 * (CHUNK + GCM_TAG_LEN));
    await expect(decrypt(dek, 'item-1', truncated)).rejects.toThrow(IntegrityError);
  });

  it('rejects mid-chunk truncation', async () => {
    const sealed = await encrypt(dek, 'item-1', randomBytes(2 * CHUNK));
    const truncated = sealed.subarray(0, sealed.length - 7);
    await expect(decrypt(dek, 'item-1', truncated)).rejects.toThrow(IntegrityError);
  });

  it('rejects appended garbage', async () => {
    const sealed = await encrypt(dek, 'item-1', randomBytes(CHUNK));
    const extended = Buffer.concat([sealed, randomBytes(CHUNK + GCM_TAG_LEN)]);
    await expect(decrypt(dek, 'item-1', Uint8Array.from(extended))).rejects.toThrow(IntegrityError);
  });

  it('rejects the wrong itemId (file-swap protection)', async () => {
    const sealed = await encrypt(dek, 'item-1', randomBytes(100));
    await expect(decrypt(dek, 'item-2', sealed)).rejects.toThrow(IntegrityError);
  });

  it('rejects the wrong DEK', async () => {
    const sealed = await encrypt(dek, 'item-1', randomBytes(100));
    await expect(decrypt(randomBytes(32), 'item-1', sealed)).rejects.toThrow(IntegrityError);
  });
});
