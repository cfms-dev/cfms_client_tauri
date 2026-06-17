// CFMS Client - typed Tauri IPC wrappers.
import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import type { InvokeArgs, InvokeOptions } from '@tauri-apps/api/core';
import { debugTimingStore, scheduleDebugUiCompletion } from '$lib/debug-timing.svelte';
import type { AndroidPasskeyAssertion, AndroidPasskeyAvailability, AndroidPasskeyRegistration, FileShortcutValidationResult, ServiceStatusInfo } from './types';

export async function invoke<T>(
  command: string,
  args?: InvokeArgs,
  options?: InvokeOptions,
): Promise<T> {
  const requestStartedAt = performance.now();

  try {
    const result = await tauriInvoke<T>(command, args, options);
    const responseAt = performance.now();
    const sequence = debugTimingStore.recordResponse(command, responseAt - requestStartedAt);
    scheduleDebugUiCompletion(sequence, responseAt);
    return result;
  } catch (error) {
    const responseAt = performance.now();
    const sequence = debugTimingStore.recordResponse(command, responseAt - requestStartedAt);
    scheduleDebugUiCompletion(sequence, responseAt);
    throw error;
  }
}

/** Ping the Rust backend. */
export async function ping(): Promise<string> {
  return invoke("ping");
}

/** Get the current protocol version. */
export async function protocolVersion(): Promise<number> {
  return invoke("protocol_version");
}

/** Get cryptographic constants (iterations, key lengths, etc.). */
export async function cryptoInfo(): Promise<{
  kdf_iterations: number;
  salt_len: number;
  key_len: number;
  nonce_len: number;
  tag_len: number;
}> {
  return invoke("crypto_info");
}

/** Get the running status of all background services. */
export async function getServiceStatus(): Promise<ServiceStatusInfo[]> {
  return invoke("get_service_status");
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
