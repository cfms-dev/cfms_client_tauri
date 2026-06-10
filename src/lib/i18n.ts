import { addMessages, init, locale, waitLocale } from 'svelte-i18n';
import { getLocale, setLocale as setBackendLocale } from './api';

export type AppLocale = 'en' | 'zh_CN';

const fallbackLocale: AppLocale = 'zh_CN';

const en = {
  common: {
    back: 'Back',
    loading: 'Loading...',
    saving: 'Saving...',
    reset: 'Reset',
    save: 'Save',
  },
  settings: {
    title: 'Settings',
    language: {
      title: 'Language',
      description: 'Application display language',
      display: 'Display Language',
      current: 'Current selection: {language}',
      restart: 'Most interface text updates immediately; backend messages use the same locale.',
      save: 'Save Language',
      saved: 'Language setting saved.',
      english: 'English',
      chinese: 'Simplified Chinese',
    },
    connection: {
      title: 'Connection',
      description: 'Proxy, TLS and network settings',
      basic: 'Basic',
      enableProxy: 'Enable proxy',
      followSystemProxy: 'Follow system proxy settings',
      customProxy: 'Custom proxy',
      customProxyHint: 'socks5h://127.0.0.1:1080',
      forceIpv4: 'Force IPv4',
      identity: 'Client Identity',
      identityHint: 'Client identity is used only when both certificate and key are set.',
      certPath: 'Client certificate path',
      keyPath: 'Client private key path',
      save: 'Save Connection',
      saved: 'Connection settings saved.',
      resetStatus: 'Connection settings reset locally. Save to apply.',
    },
    storage: {
      title: 'Storage',
      description: 'External storage options',
    },
    security: {
      title: 'Security',
      description: 'Encryption parameters and CA certificates',
    },
    updates: {
      title: 'Updates',
      description: 'Software update channel and checking',
    },
    twofa: {
      title: 'Two-Factor Auth',
      description: '2FA setup and backup codes',
    },
  },
};

const zh_CN = {
  common: {
    back: '返回',
    loading: '加载中...',
    saving: '保存中...',
    reset: '重置',
    save: '保存',
  },
  settings: {
    title: '设置',
    language: {
      title: '语言',
      description: '应用显示语言',
      display: '显示语言',
      current: '当前选择：{language}',
      restart: '大多数界面文本会立即更新；后端消息也会使用同一语言。',
      save: '保存语言',
      saved: '语言设置已保存。',
      english: 'English',
      chinese: '简体中文',
    },
    connection: {
      title: '连接',
      description: '代理、TLS 与网络设置',
      basic: '基础',
      enableProxy: '启用代理',
      followSystemProxy: '跟随系统代理设置',
      customProxy: '自定义代理',
      customProxyHint: 'socks5h://127.0.0.1:1080',
      forceIpv4: '强制使用 IPv4',
      identity: '客户端身份',
      identityHint: '仅当证书和私钥都设置时，客户端身份才会生效。',
      certPath: '客户端证书路径',
      keyPath: '客户端私钥路径',
      save: '保存连接设置',
      saved: '连接设置已保存。',
      resetStatus: '连接设置已在本地重置，保存后生效。',
    },
    storage: {
      title: '存储',
      description: '外部存储选项',
    },
    security: {
      title: '安全',
      description: '加密参数与 CA 证书',
    },
    updates: {
      title: '更新',
      description: '软件更新通道与检查',
    },
    twofa: {
      title: '二步验证',
      description: '2FA 设置与备用代码',
    },
  },
};

let initialized = false;

export function normalizeLocale(value: string | null | undefined): AppLocale {
  if (value === 'en' || value === 'en-US' || value === 'en_US') return 'en';
  if (value === 'zh' || value === 'zh-CN' || value === 'zh_CN') return 'zh_CN';
  return fallbackLocale;
}

export async function initI18n(): Promise<void> {
  if (initialized) {
    await waitLocale();
    return;
  }

  addMessages('en', en);
  addMessages('zh_CN', zh_CN);

  let initial = fallbackLocale;
  try {
    initial = normalizeLocale(await getLocale());
  } catch {
    initial = normalizeLocale(window.localStorage.getItem('cfms_locale'));
  }

  init({
    fallbackLocale,
    initialLocale: initial,
  });
  initialized = true;
  window.localStorage.setItem('cfms_locale', initial);
  await waitLocale();
}

export async function setAppLocale(nextLocale: AppLocale): Promise<AppLocale> {
  const normalized = normalizeLocale(nextLocale);
  locale.set(normalized);
  window.localStorage.setItem('cfms_locale', normalized);
  const backendLocale = normalizeLocale(await setBackendLocale(normalized));
  locale.set(backendLocale);
  window.localStorage.setItem('cfms_locale', backendLocale);
  await waitLocale();
  return backendLocale;
}
