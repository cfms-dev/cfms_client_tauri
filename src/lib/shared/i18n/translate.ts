import { get } from 'svelte/store';
import { _ as t } from 'svelte-i18n';

export function translate(key: string, values: Record<string, string | number> = {}): string {
  return get(t)(key, { values });
}
