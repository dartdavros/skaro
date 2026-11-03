import { app, safeStorage } from 'electron';
import type { CredentialVault } from '@skaro/timeline';

/** The pinned Electron synchronous backend exposes which Linux store actually protects data. */
export function protection(): Awaited<ReturnType<CredentialVault['availability']>> {
  if (!app.isReady() || app.commandLine.hasSwitch('use-mock-keychain'))
    return { state: 'unavailable', reason: 'OS credential protection is not ready' };
  if (!safeStorage.isEncryptionAvailable())
    return { state: 'unavailable', reason: 'OS credential protection is unavailable' };
  if (process.platform === 'win32') return { state: 'available', backend: 'dpapi' };
  if (process.platform === 'darwin') return { state: 'available', backend: 'keychain' };
  if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'gnome_libsecret')
    return { state: 'available', backend: 'secret-service' };
  return { state: 'unavailable', reason: 'A supported OS credential backend is required' };
}

export function requireProtection(): void {
  if (protection().state !== 'available') throw new Error('OS credential protection unavailable');
}

export function encryptCredential(value: unknown): Uint8Array {
  requireProtection();
  try {
    return safeStorage.encryptString(JSON.stringify(value));
  } catch {
    throw new Error('OS credential encryption failed');
  }
}

export function decryptCredential(value: Uint8Array): unknown {
  requireProtection();
  try {
    return JSON.parse(safeStorage.decryptString(Buffer.from(value)));
  } catch {
    throw new Error('OS credential decryption failed');
  }
}
