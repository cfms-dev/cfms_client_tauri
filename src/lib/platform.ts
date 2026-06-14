export type AppPlatform =
  | 'android'
  | 'ios'
  | 'windows'
  | 'macos'
  | 'linux'
  | 'unknown';

const MOBILE_PLATFORMS = new Set<AppPlatform>(['android', 'ios']);
const MOBILE_USER_AGENT_PATTERN = /Android|iPhone|iPad|iPod/i;

export function getAppPlatform(): AppPlatform {
  const tauriPlatform = import.meta.env.TAURI_ENV_PLATFORM;
  if (typeof tauriPlatform === 'string' && tauriPlatform.length > 0) {
    return normalizePlatform(tauriPlatform);
  }

  return platformFromUserAgent();
}

export function isMobilePlatform(platform = getAppPlatform()): boolean {
  return MOBILE_PLATFORMS.has(platform);
}

function normalizePlatform(platform: string): AppPlatform {
  const normalized = platform.toLowerCase();
  if (normalized === 'android') return 'android';
  if (normalized === 'ios') return 'ios';
  if (normalized === 'windows') return 'windows';
  if (normalized === 'macos' || normalized === 'darwin') return 'macos';
  if (normalized === 'linux') return 'linux';
  return 'unknown';
}

function platformFromUserAgent(): AppPlatform {
  if (typeof navigator === 'undefined') return 'unknown';

  const userAgent = navigator.userAgent;
  if (!MOBILE_USER_AGENT_PATTERN.test(userAgent)) return 'unknown';
  if (/Android/i.test(userAgent)) return 'android';
  return 'ios';
}
