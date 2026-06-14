import { platform as tauriPlatform, type Platform } from '@tauri-apps/plugin-os';

export type AppPlatform =
  | 'android'
  | 'ios'
  | 'windows'
  | 'macos'
  | 'linux'
  | 'unknown';

const MOBILE_PLATFORMS = new Set<AppPlatform>(['android', 'ios']);

export function getAppPlatform(): AppPlatform {
  return normalizePlatform(tauriPlatform());
}

export function isMobilePlatform(platform = getAppPlatform()): boolean {
  return MOBILE_PLATFORMS.has(platform);
}

function normalizePlatform(platform: Platform): AppPlatform {
  if (platform === 'android') return 'android';
  if (platform === 'ios') return 'ios';
  if (platform === 'windows') return 'windows';
  if (platform === 'macos') return 'macos';
  if (platform === 'linux') return 'linux';
  return 'unknown';
}
