import { getVersion } from '@tauri-apps/api/app';

export const FALLBACK_APP_VERSION = '0.15.0';

export async function loadAppVersion(): Promise<string> {
  try {
    return await getVersion();
  } catch {
    return FALLBACK_APP_VERSION;
  }
}
