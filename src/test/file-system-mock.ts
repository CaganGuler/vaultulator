/**
 * Minimal expo-file-system stub for jest. Crypto tests use in-memory
 * reader/writer adapters, so this only needs to satisfy module imports.
 */

export enum FileMode {
  ReadWrite = 'rw',
  ReadOnly = 'r',
  WriteOnly = 'w',
  Append = 'wa',
  Truncate = 'wt',
}

export class File {
  uri: string;
  constructor(...uris: unknown[]) {
    this.uri = uris.map(String).join('/');
  }
  get exists(): boolean {
    return false;
  }
  get size(): number {
    return 0;
  }
  create(): void {}
  delete(): void {}
  open(): never {
    throw new Error('file-system-mock: open() is not implemented in jest');
  }
}

export class Directory {
  uri: string;
  constructor(...uris: unknown[]) {
    this.uri = uris.map(String).join('/');
  }
  get exists(): boolean {
    return false;
  }
  create(): void {}
  delete(): void {}
  list(): unknown[] {
    return [];
  }
}

export const Paths = {
  document: new Directory('file:///mock-document'),
  cache: new Directory('file:///mock-cache'),
};
