import { setTheme } from '@fluentui/web-components/theme/set-theme.js';
import { fluentTheme, type ThemeOptions } from './theme';

export function applyFluentTheme(options: ThemeOptions) {
  setTheme(fluentTheme(options));
}
