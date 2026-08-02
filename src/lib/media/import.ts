/**
 * Importing content that already exists on the device.
 *
 * Uses the system picker (`expo-image-picker`), NOT `expo-media-library`.
 * That distinction is invariant #3: the library package would grant the app
 * read/write access to the whole photo library and open a path for writing
 * plaintext back to it. The picker hands over a copy of exactly what the user
 * selected, needs no photo-library permission on iOS, and gives the app no
 * standing access to anything else.
 *
 * The honest limit, documented in docs/SECURITY.md: the app therefore CANNOT
 * delete the original. Importing copies content into the vault and leaves it
 * in the gallery, so the user has to delete it there themselves. Until they
 * do, the vault copy is not a secret.
 */
import * as ImagePicker from 'expo-image-picker';

import { ingestCapturedPhoto, ingestCapturedVideo } from './capture';
import type { MediaItem } from '../db/media-repo';
import type { VaultContext } from '../db/scope';
import type { StreamProgress } from '../crypto/stream';

export interface ImportProgress {
  /** 1-based index of the asset being encrypted. */
  current: number;
  total: number;
  /** Progress within the current asset, when it is a video. */
  stream?: StreamProgress;
}

export interface ImportResult {
  imported: MediaItem[];
  /** Assets that failed; the rest still went in. */
  failed: number;
}

/** Opens the system picker. Returns [] if the user cancels. */
export async function pickFromLibrary(): Promise<ImagePicker.ImagePickerAsset[]> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images', 'videos'],
    allowsMultipleSelection: true,
    // EXIF carries GPS coordinates and device identifiers. The in-app camera
    // already disables it; imported content must not smuggle it in.
    exif: false,
    quality: 1,
  });
  return result.canceled ? [] : result.assets;
}

/**
 * Encrypts picked assets into the vault, one at a time.
 *
 * Sequential on purpose: each ingest streams a file through a 1 MiB buffer,
 * and running several at once multiplies peak memory for no wall-clock gain
 * on a phone. A failure on one asset does not abandon the rest.
 */
export async function importAssets(
  ctx: VaultContext,
  assets: ImagePicker.ImagePickerAsset[],
  onProgress?: (progress: ImportProgress) => void,
): Promise<ImportResult> {
  const imported: MediaItem[] = [];
  let failed = 0;

  for (const [index, asset] of assets.entries()) {
    const current = index + 1;
    onProgress?.({ current, total: assets.length });
    try {
      const item =
        asset.type === 'video'
          ? await ingestCapturedVideo({
              ctx,
              sourceUri: asset.uri,
              onProgress: (stream) => onProgress?.({ current, total: assets.length, stream }),
            })
          : await ingestCapturedPhoto({
              ctx,
              sourceUri: asset.uri,
              width: asset.width,
              height: asset.height,
            });
      imported.push(item);
    } catch (e) {
      // A session change means the vault locked mid-import; nothing after this
      // would succeed either, and continuing risks writing unattributable rows.
      if (e instanceof Error && e.name === 'SessionChangedError') throw e;
      failed++;
    }
  }

  return { imported, failed };
}
