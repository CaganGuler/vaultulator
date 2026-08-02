/**
 * Every <Image> in this app renders decrypted plaintext.
 *
 * expo-image's `cachePolicy` defaults to 'disk', which hands those bytes to
 * SDWebImage (iOS) or Glide (Android) to persist in their own cache
 * directories — outside <cache>/decrypted/, and wiped by neither lock() nor
 * cold start. That is invariant #2, and it shipped that way once already.
 *
 * The native behaviour cannot be asserted from jest, so this guards the thing
 * that actually regresses: someone adding an <Image> and not thinking about it.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..', '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return entry === '__tests__' || entry === 'test' ? [] : sourceFiles(full);
    }
    return entry.endsWith('.tsx') ? [full] : [];
  });
}

describe('expo-image cache policy', () => {
  it('is set explicitly on every Image element', () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(SRC)) {
      const source = readFileSync(file, 'utf8');
      if (!source.includes("from 'expo-image'")) continue;

      // Comments are stripped first: prose mentioning the prop must not be
      // mistaken for setting it. (It was, the first time this was written.)
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

      // Split on the opening tag so each element's props are examined alone.
      for (const [index, chunk] of code.split(/<Image\b/).slice(1).entries()) {
        const close = chunk.search(/\/?>/);
        const props = close === -1 ? chunk : chunk.slice(0, close);
        if (!/\bcachePolicy\s*=/.test(props)) {
          offenders.push(`${file.slice(SRC.length + 1)} (Image #${index + 1})`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('never uses the loaders that hard-code disk caching', () => {
    // ImageLoader.swift pins cachePolicy: .disk with no override, so these two
    // would reintroduce the leak no matter what props the element carries.
    const offenders = sourceFiles(SRC).filter((file) => {
      const source = readFileSync(file, 'utf8');
      return /\buseImage\s*\(|Image\.loadAsync\s*\(/.test(source);
    });

    expect(offenders).toEqual([]);
  });
});
