/**
 * In-memory expo-file-system for jest.
 *
 * The previous stub was deliberately inert — `exists` was always false and
 * `open()` threw. That made five modules untestable (paths, the stream file
 * adapters, capture, share, viewer-cache) and, worse, would have made a test
 * for `sweepOrphanFiles` pass vacuously: with `list()` returning nothing,
 * "deleted the right files" and "did nothing at all" look identical.
 *
 * This models enough of the real API to exercise those paths for real: byte
 * storage, directory listing, handles with partial reads, and the nullable
 * size semantics the encrypt path depends on.
 */

export enum FileMode {
  ReadWrite = 'rw',
  ReadOnly = 'r',
  WriteOnly = 'w',
  Append = 'wa',
  Truncate = 'wt',
}

/** uri → contents. Directories are implied by their files, plus this set. */
const files = new Map<string, Uint8Array>();
const dirs = new Set<string>();

/** Forces the next readBytes to return fewer bytes than asked, once. */
let shortReadOnce = false;

function normalize(uri: string): string {
  return uri.replace(/\/+$/, '');
}

function join(parts: unknown[]): string {
  return normalize(
    parts
      .map((p) => (typeof p === 'string' ? p : String(p)))
      .filter((p) => p.length > 0)
      .join('/'),
  );
}

function parentOf(uri: string): string {
  return uri.slice(0, uri.lastIndexOf('/'));
}

export function __reset(): void {
  files.clear();
  dirs.clear();
  shortReadOnce = false;
  dirs.add('file:///mock-document');
  dirs.add('file:///mock-cache');
}

/** Test hook: makes the next chunk read come back partial. */
export function __forceShortRead(): void {
  shortReadOnce = true;
}

export function __writeFile(uri: string, bytes: Uint8Array): void {
  files.set(normalize(uri), Uint8Array.from(bytes));
}

export function __fileCount(): number {
  return files.size;
}

class FileHandle {
  private offset = 0;

  constructor(
    private readonly uri: string,
    truncate: boolean,
  ) {
    if (truncate) files.set(uri, new Uint8Array(0));
  }

  get size(): number | null {
    return files.get(this.uri)?.length ?? null;
  }

  readBytes(length: number): Uint8Array {
    const data = files.get(this.uri) ?? new Uint8Array(0);
    let toRead = Math.min(length, data.length - this.offset);
    if (toRead <= 0) return new Uint8Array(0);
    // Real handles may return less than asked; a caller that does not loop
    // seals a short chunk and produces a file nothing can decrypt.
    if (shortReadOnce && toRead > 1) {
      shortReadOnce = false;
      toRead = Math.floor(toRead / 2);
    }
    const out = data.slice(this.offset, this.offset + toRead);
    this.offset += toRead;
    return out;
  }

  writeBytes(bytes: Uint8Array): void {
    const current = files.get(this.uri) ?? new Uint8Array(0);
    const next = new Uint8Array(current.length + bytes.length);
    next.set(current);
    next.set(bytes, current.length);
    files.set(this.uri, next);
  }

  close(): void {
    // nothing to release
  }
}

export class File {
  readonly uri: string;

  constructor(...parts: unknown[]) {
    this.uri = join(parts);
  }

  toString(): string {
    return this.uri;
  }

  get name(): string {
    return this.uri.slice(this.uri.lastIndexOf('/') + 1);
  }

  get exists(): boolean {
    return files.has(this.uri);
  }

  get size(): number | null {
    return files.get(this.uri)?.length ?? null;
  }

  create(options?: { intermediates?: boolean; overwrite?: boolean }): void {
    if (files.has(this.uri) && !options?.overwrite) return;
    if (options?.intermediates) dirs.add(parentOf(this.uri));
    files.set(this.uri, new Uint8Array(0));
  }

  delete(): void {
    if (!files.delete(this.uri)) throw new Error(`ENOENT: ${this.uri}`);
  }

  open(mode: FileMode = FileMode.ReadOnly): FileHandle {
    const truncate = mode === FileMode.Truncate || mode === FileMode.WriteOnly;
    if (!files.has(this.uri) && !truncate) throw new Error(`ENOENT: ${this.uri}`);
    return new FileHandle(this.uri, truncate);
  }
}

export class Directory {
  readonly uri: string;

  constructor(...parts: unknown[]) {
    this.uri = join(parts);
  }

  toString(): string {
    return this.uri;
  }

  get name(): string {
    return this.uri.slice(this.uri.lastIndexOf('/') + 1);
  }

  get exists(): boolean {
    return dirs.has(this.uri);
  }

  create(options?: { intermediates?: boolean }): void {
    dirs.add(this.uri);
    if (options?.intermediates) {
      let at = parentOf(this.uri);
      while (at.includes('/') && !at.endsWith(':/')) {
        dirs.add(at);
        at = parentOf(at);
      }
    }
  }

  delete(): void {
    const prefix = `${this.uri}/`;
    for (const uri of [...files.keys()]) if (uri.startsWith(prefix)) files.delete(uri);
    for (const uri of [...dirs]) if (uri === this.uri || uri.startsWith(prefix)) dirs.delete(uri);
  }

  /** Immediate children only, matching the real API. */
  list(): (File | Directory)[] {
    const prefix = `${this.uri}/`;
    const out: (File | Directory)[] = [];
    for (const uri of files.keys()) {
      if (uri.startsWith(prefix) && !uri.slice(prefix.length).includes('/')) out.push(new File(uri));
    }
    for (const uri of dirs) {
      if (uri.startsWith(prefix) && !uri.slice(prefix.length).includes('/')) out.push(new Directory(uri));
    }
    return out;
  }
}

export const Paths = {
  document: new Directory('file:///mock-document'),
  cache: new Directory('file:///mock-cache'),
};

__reset();
