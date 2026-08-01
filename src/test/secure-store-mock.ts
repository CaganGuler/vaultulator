/** In-memory expo-secure-store mock for jest. */

const store = new Map<string, string>();

export type KeychainAccessibilityConstant = number;
export const WHEN_UNLOCKED_THIS_DEVICE_ONLY: KeychainAccessibilityConstant = 0;

export interface SecureStoreOptions {
  keychainAccessible?: KeychainAccessibilityConstant;
}

export async function getItemAsync(key: string): Promise<string | null> {
  return store.get(key) ?? null;
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  store.set(key, value);
}

export async function deleteItemAsync(key: string): Promise<void> {
  store.delete(key);
}

export function __reset(): void {
  store.clear();
}
