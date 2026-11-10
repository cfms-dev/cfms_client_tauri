import { invoke } from '@tauri-apps/api/core';
export interface PlatformCredentialRecord { id: string; label: string; createdAt: number }
export interface AppLockSettings {
  version: 1; enabled: boolean; pin: { length: number } | null; biometricEnabled: boolean;
  platformCredentials: PlatformCredentialRecord[]; timedLockEnabled: boolean; timedLockMs: number; updatedAt: number;
}
export interface AppLockSnapshot { revision: number; settings: AppLockSettings; locked: boolean; failedAttempts: number; lockoutUntil: number; disconnectRequired: boolean }
export type AppLockChange =
  | { operation: 'enabled' | 'biometric'; enabled: boolean }
  | { operation: 'pin'; pin: string }
  | { operation: 'remove_pin' | 'reset' }
  | { operation: 'credential'; credential: PlatformCredentialRecord }
  | { operation: 'remove_credential'; id: string }
  | { operation: 'timed'; enabled: boolean; timeout: number };
export function initializeAppLock(): Promise<AppLockSnapshot> { return invoke('initialize_app_lock'); }
export function getAppLock(): Promise<AppLockSnapshot> { return invoke('get_app_lock'); }
export function configureAppLock(change: AppLockChange): Promise<AppLockSnapshot> { return invoke('configure_app_lock', { change }); }
export function appLockActivity(background = false): Promise<AppLockSnapshot> { return invoke('app_lock_activity', { background }); }
export function lockApp(): Promise<AppLockSnapshot> { return invoke('lock_app'); }
export function verifyAppLockPin(pin: string): Promise<AppLockSnapshot> { return invoke('verify_app_lock_pin', { pin }); }
export function beginAppLockPrompt(method: 'biometric' | 'platform'): Promise<number> { return invoke('begin_app_lock_prompt', { method }); }
export function finishAppLockPrompt(ticket: number, outcome: 'accepted' | 'failed' | 'cancelled'): Promise<AppLockSnapshot> { return invoke('finish_app_lock_prompt', { ticket, outcome }); }
