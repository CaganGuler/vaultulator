/** Jest stand-in for expo-sharing. */
export const calls: { uri: string; mimeType?: string }[] = [];
let failNext = false;

export async function shareAsync(uri: string, options?: { mimeType?: string }): Promise<void> {
  calls.push({ uri, mimeType: options?.mimeType });
  if (failNext) {
    failNext = false;
    throw new Error('user cancelled');
  }
}

export async function isAvailableAsync(): Promise<boolean> {
  return true;
}

export function __failNext(): void {
  failNext = true;
}

export function __reset(): void {
  calls.length = 0;
  failNext = false;
}
