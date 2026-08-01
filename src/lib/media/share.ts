/**
 * Export: decrypt → temp file in <cache>/decrypted/ → OS share sheet → delete.
 * The UI must gate this behind an explicit "bu içerik kasadan çıkıyor" confirm.
 */
import * as Sharing from 'expo-sharing';

import type { MediaItem } from '../db/media-repo';
import { decryptFile } from '../crypto/stream';
import { decryptedFileUri, deleteIfExists, mediaFileUri } from '../paths';

function exportExtension(item: MediaItem): string {
  if (item.type === 'photo') return 'jpg';
  return item.mime.includes('quicktime') ? 'mov' : 'mp4';
}

export async function shareMediaItem(dek: Uint8Array, item: MediaItem): Promise<void> {
  const tempUri = decryptedFileUri(`export-${item.id}.${exportExtension(item)}`);
  try {
    await decryptFile({ dek, itemId: item.id, sourceUri: mediaFileUri(item.fileName), destUri: tempUri });
    await Sharing.shareAsync(tempUri, { mimeType: item.mime });
  } finally {
    deleteIfExists(tempUri);
  }
}
