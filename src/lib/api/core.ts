// CFMS Client - typed Tauri IPC wrappers.
import { invoke } from '@tauri-apps/api/core';
import type { AndroidPasskeyAssertion, AndroidPasskeyAvailability, AndroidPasskeyRegistration } from './types/mobile';
import type { FileShortcutValidationResult } from './types/files';

export type WindowBackdropMode = 'mica' | 'solid';

/** Applies the native window base and reports the material actually applied. */
export function setWindowBackdrop(theme: 'light' | 'dark', enabled: boolean, solidColor: [number, number, number]): Promise<WindowBackdropMode> {
  return invoke('set_window_backdrop', { theme, enabled, solidColor });
}

/** Get the current protocol version. */
export async function protocolVersion(): Promise<number> {
  return invoke("protocol_version");
}

/** Immediately validate whether favorites and recent visits are still accessible. */
export async function validateFileShortcuts(): Promise<FileShortcutValidationResult> {
  return invoke("validate_file_shortcuts");
}

export async function getAndroidPasskeyAvailability(): Promise<AndroidPasskeyAvailability> {
  return invoke("android_passkey_availability");
}

export async function createAndroidPasskey(
  requestJson: string,
): Promise<AndroidPasskeyRegistration> {
  return invoke("android_create_passkey", { requestJson });
}

export async function getAndroidPasskey(
  requestJson: string,
): Promise<AndroidPasskeyAssertion> {
  return invoke("android_get_passkey", { requestJson });
}

// ---------------------------------------------------------------------------
