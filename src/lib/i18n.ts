import { addMessages, init, locale, waitLocale } from 'svelte-i18n';
import { browser } from '$app/environment';
import { getLocale, setLocale as setBackendLocale } from './api';
import { en } from './i18n/messages/en';
import { zh_CN } from './i18n/messages/zh-CN';

export type AppLocale = 'en' | 'zh_CN';
type FrontendLocale = 'en' | 'zh-CN';

const fallbackLocale: AppLocale = 'zh_CN';





let initialized = false;
let backendLocaleSync: Promise<void> | null = null;

export function normalizeLocale(value: string | null | undefined): AppLocale {
  if (value === 'en' || value === 'en-US' || value === 'en_US') return 'en';
  if (value === 'zh' || value === 'zh-CN' || value === 'zh_CN') return 'zh_CN';
  return fallbackLocale;
}

function toFrontendLocale(value: AppLocale): FrontendLocale {
  return value === 'zh_CN' ? 'zh-CN' : 'en';
}

function getStoredLocale(): AppLocale {
  if (!browser) return fallbackLocale;
  return normalizeLocale(window.localStorage.getItem('cfms_locale'));
}

function storeLocale(value: AppLocale): void {
  if (browser) window.localStorage.setItem('cfms_locale', value);
}

function configureI18n(initial: AppLocale = getStoredLocale()): void {
  if (initialized) return;

  addMessages('en', en);
  addMessages('zh-CN', zh_CN);

  init({
    fallbackLocale: toFrontendLocale(fallbackLocale),
    initialLocale: toFrontendLocale(initial),
  });
  initialized = true;
  storeLocale(initial);
}

async function syncBackendLocale(): Promise<void> {
  let backendLocale: AppLocale;
  try {
    backendLocale = normalizeLocale(await getLocale());
  } catch {
    await waitLocale();
    return;
  }

  locale.set(toFrontendLocale(backendLocale));
  storeLocale(backendLocale);
  await waitLocale();
}

configureI18n();

export async function initI18n(): Promise<void> {
  configureI18n();
  backendLocaleSync ??= syncBackendLocale().finally(() => {
    backendLocaleSync = null;
  });
  await backendLocaleSync;
}

export async function setAppLocale(nextLocale: AppLocale): Promise<AppLocale> {
  const normalized = normalizeLocale(nextLocale);
  locale.set(toFrontendLocale(normalized));
  storeLocale(normalized);
  const backendLocale = normalizeLocale(await setBackendLocale(normalized));
  locale.set(toFrontendLocale(backendLocale));
  storeLocale(backendLocale);
  await waitLocale();
  return backendLocale;
}
