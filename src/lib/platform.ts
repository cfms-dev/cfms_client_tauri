import { platform, type Platform } from '@tauri-apps/plugin-os';

export function isMobilePlatform(value: Platform = platform()): boolean {
  return value === 'android' || value === 'ios';
}

export function supportsKeyboardShortcuts(value: Platform = platform()): boolean {
  return !isMobilePlatform(value);
}
