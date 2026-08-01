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
    await insertMediaItem(input.ctx, item);
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

interface IngestVideoInput {
  ctx: VaultContext;
  sourceUri: string;
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
    await encryptFile({ dek: input.ctx.dek, itemId: id, sourceUri: thumbTempUri, destUri: thumbFileUri(item.thumbName!) });
    assertEncryptedExists(item);
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

/** Post-encrypt integrity check before the DB row is committed. */
function assertEncryptedExists(item: MediaItem): void {
  const encrypted = new File(mediaFileUri(item.fileName));
  if (!encrypted.exists || encrypted.size <= 0) {
    throw new Error('Şifrelenmiş dosya doğrulanamadı');
  }
}
