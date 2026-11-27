import { getVersion } from '$lib/shared/platform/native-app';

export const FALLBACK_APP_VERSION = '0.15.0';

export async function loadAppVersion(): Promise<string> {
  try {
    return await getVersion();
  } catch {
    return FALLBACK_APP_VERSION;
  }
}

export function formatReleaseDate(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}
