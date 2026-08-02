/**
 * Export: decrypt → temp file in <cache>/decrypted/ → OS share sheet → delete.
 * The UI must gate this behind an explicit "bu içerik kasadan çıkıyor" confirm.
 */
import { Platform } from 'react-native';
import * as Sharing from 'expo-sharing';

import type { MediaItem } from '../db/media-repo';
import { decryptFile } from '../crypto/stream';
import { decryptedFileUri, deleteIfExists, mediaFileUri } from '../paths';

function exportExtension(item: MediaItem): string {
  if (item.type === 'photo') return 'jpg';
  return item.mime.includes('quicktime') ? 'mov' : 'mp4';
}

/**
 * Sharing out is iOS-only, on purpose.
 *
 * On Android the system chooser is a separate activity, so the app goes to
 * background, the vault locks (the default setting is "lock immediately"), and
 * wipeDecryptedDir() deletes the very plaintext file the receiving app is about
 * to read. The alternative — deferring the lock while a share is in flight —
 * would mean holding the vault open across an app switch, which is exactly the
 * moment it should be closing. Documented in docs/SECURITY.md.
 */
export function canShareOut(): boolean {
  return Platform.OS === 'ios';
}

export async function shareMediaItem(dek: Uint8Array, item: MediaItem): Promise<void> {
  if (!canShareOut()) throw new Error('Bu platformda kasadan dışarı paylaşma kapalı');
  const tempUri = decryptedFileUri(`export-${item.id}.${exportExtension(item)}`);
  try {
    await decryptFile({ dek, itemId: item.id, sourceUri: mediaFileUri(item.fileName), destUri: tempUri });
    await Sharing.shareAsync(tempUri, { mimeType: item.mime });
  } finally {
    deleteIfExists(tempUri);
  }
}
