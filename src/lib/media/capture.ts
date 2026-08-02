/**
 * Capture ingest pipeline:
 *   camera temp file → thumbnail → stream-encrypt both → DB row → delete temps.
 *
 * Nothing ever touches the device gallery: expo-media-library is not even
 * installed, captures land in the app cache and are deleted right after
 * encryption. EXIF is disabled at capture time.
 */
import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as VideoThumbnails from 'expo-video-thumbnails';

import { insertMediaItem, type MediaItem } from '../db/media-repo';
import type { VaultContext } from '../db/scope';
import { assertStillCurrent } from '../../stores/session';
import { DEFAULT_CHUNK_SIZE, HEADER_LEN } from '../crypto/format';
import { GCM_TAG_LEN } from '../crypto/primitives';
import { encryptFile, type StreamProgress } from '../crypto/stream';
import { deleteIfExists, mediaFileUri, thumbFileUri } from '../paths';

const THUMB_WIDTH = 512;

async function makePhotoThumbnail(sourceUri: string): Promise<string> {
  const context = ImageManipulator.manipulate(sourceUri);
  context.resize({ width: THUMB_WIDTH });
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.7 });
  return saved.uri;
}

interface IngestPhotoInput {
  ctx: VaultContext;
  sourceUri: string;
  width?: number;
  height?: number;
  /** Set for library imports. Written for photos too, so that the column's
   *  presence does not by itself mark a row as a document. */
  originalName?: string;
}

export async function ingestCapturedPhoto(input: IngestPhotoInput): Promise<MediaItem> {
  const id = Crypto.randomUUID();
  const sizeBytes = new File(input.sourceUri).size;
  let thumbTempUri: string | null = null;
  try {
    thumbTempUri = await makePhotoThumbnail(input.sourceUri);
    const item: MediaItem = {
      id,
      type: 'photo',
      fileName: `${id}.enc`,
      thumbName: `${id}.thumb.enc`,
      mime: 'image/jpeg',
      sizeBytes,
      width: input.width ?? null,
      height: input.height ?? null,
      durationMs: null,
      createdAt: Date.now(),
    };
    await encryptFile({ dek: input.ctx.dek, itemId: id, sourceUri: input.sourceUri, destUri: mediaFileUri(item.fileName) });
    await encryptFile({ dek: input.ctx.dek, itemId: id, sourceUri: thumbTempUri, destUri: thumbFileUri(item.thumbName!) });
    assertEncryptedExists(item);
    // Encryption can outlast the session (a long video produces no touch
    // events, so the inactivity timer fires mid-pipeline and zeroizes the very
    // buffers we are still reading). Bail before writing a row that would be
    // tagged with an all-zero key and therefore invisible to every vault; the
    // catch below removes the ciphertext we already wrote.
    assertStillCurrent(input.ctx);
    await insertMediaItem(input.ctx, item, { originalName: input.originalName });
    return item;
  } catch (e) {
    // never leave orphaned ciphertext behind on a failed ingest
    deleteIfExists(mediaFileUri(`${id}.enc`));
    deleteIfExists(thumbFileUri(`${id}.thumb.enc`));
    throw e;
  } finally {
    deleteIfExists(input.sourceUri);
    if (thumbTempUri) deleteIfExists(thumbTempUri);
  }
}

/**
 * A document the user picked from the system file picker.
 *
 * Takes the streaming path, never the photo one: getPhotoFileUri-style
 * whole-file handling would turn a 50 MB PDF into a ~67 MB string
 * (invariant #5). Documents have no thumbnail — rendering a PDF's first page
 * needs a native rasteriser, and putting secret content through one to
 * produce a preview is not worth it — so the tile shows a type glyph instead.
 */
interface IngestDocumentInput {
  ctx: VaultContext;
  sourceUri: string;
  /** The picker's filename. Stored encrypted; it identifies the user. */
  originalName: string;
  mime: string;
  onProgress?: (progress: StreamProgress) => void;
}

export async function ingestPickedDocument(input: IngestDocumentInput): Promise<MediaItem> {
  const id = Crypto.randomUUID();
  const sizeBytes = new File(input.sourceUri).size ?? 0;
  try {
    const item: MediaItem = {
      id,
      type: 'document',
      fileName: `${id}.enc`,
      thumbName: null,
      mime: input.mime,
      sizeBytes,
      width: null,
      height: null,
      durationMs: null,
      createdAt: Date.now(),
    };
    await encryptFile({
      dek: input.ctx.dek,
      itemId: id,
      sourceUri: input.sourceUri,
      destUri: mediaFileUri(item.fileName),
      onProgress: input.onProgress,
    });
    assertEncryptedExists(item);
    assertStillCurrent(input.ctx);
    await insertMediaItem(input.ctx, item, { originalName: input.originalName });
    return item;
  } catch (e) {
    deleteIfExists(mediaFileUri(`${id}.enc`));
    throw e;
  } finally {
    deleteIfExists(input.sourceUri);
  }
}

interface IngestVideoInput {
  ctx: VaultContext;
  sourceUri: string;
  /** Known at capture and for library picks; the player backfills the rest. */
  durationMs?: number | null;
  onProgress?: (progress: StreamProgress) => void;
}

export async function ingestCapturedVideo(input: IngestVideoInput): Promise<MediaItem> {
  const id = Crypto.randomUUID();
  const source = new File(input.sourceUri);
  const sizeBytes = source.size;
  const mime = input.sourceUri.toLowerCase().endsWith('.mov') ? 'video/quicktime' : 'video/mp4';
  let thumbTempUri: string | null = null;
  try {
    const thumb = await VideoThumbnails.getThumbnailAsync(input.sourceUri, { time: 0, quality: 0.7 });
    thumbTempUri = await makePhotoThumbnail(thumb.uri);
    deleteIfExists(thumb.uri);

    const item: MediaItem = {
      id,
      type: 'video',
      fileName: `${id}.enc`,
      thumbName: `${id}.thumb.enc`,
      mime,
      sizeBytes,
      width: thumb.width || null,
      height: thumb.height || null,
      durationMs: input.durationMs != null ? Math.round(input.durationMs) : null,
      createdAt: Date.now(),
    };
    await encryptFile({
      dek: input.ctx.dek,
      itemId: id,
      sourceUri: input.sourceUri,
      destUri: mediaFileUri(item.fileName),
      onProgress: input.onProgress,
    });
    await encryptFile({ dek: input.ctx.dek, itemId: id, sourceUri: thumbTempUri, destUri: thumbFileUri(item.thumbName!) });
    assertEncryptedExists(item);
    // Encryption can outlast the session (a long video produces no touch
    // events, so the inactivity timer fires mid-pipeline and zeroizes the very
    // buffers we are still reading). Bail before writing a row that would be
    // tagged with an all-zero key and therefore invisible to every vault; the
    // catch below removes the ciphertext we already wrote.
    assertStillCurrent(input.ctx);
    await insertMediaItem(input.ctx, item);
    return item;
  } catch (e) {
    deleteIfExists(mediaFileUri(`${id}.enc`));
    deleteIfExists(thumbFileUri(`${id}.thumb.enc`));
    throw e;
  } finally {
    deleteIfExists(input.sourceUri);
    if (thumbTempUri) deleteIfExists(thumbTempUri);
  }
}

/**
 * Post-encrypt integrity check before the DB row is committed.
 *
 * Checks the exact length, not just "non-empty": a short write from a full
 * disk yields a truncated but plausible-looking file, and committing the row
 * for it creates an item that can never be decrypted and never be explained.
 */
function assertEncryptedExists(item: MediaItem): void {
  const encrypted = new File(mediaFileUri(item.fileName));
  if (!encrypted.exists) throw new Error('Şifrelenmiş dosya doğrulanamadı');

  const chunks = Math.max(1, Math.ceil(item.sizeBytes / DEFAULT_CHUNK_SIZE));
  const expected = HEADER_LEN + item.sizeBytes + chunks * GCM_TAG_LEN;
  if (encrypted.size !== expected) {
    throw new Error(`Şifrelenmiş dosya eksik yazıldı (${encrypted.size}/${expected})`);
  }
}
