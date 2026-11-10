// Generated CSS prevents a theme flash before the client runtime initializes.
// Theme objects remain the single source of truth.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateThemeCss } from '../src/lib/shared/fluent/theme-css.ts';

const path = fileURLToPath(new URL('../src/lib/shared/fluent/theme.css', import.meta.url));
const css = generateThemeCss();
if (process.argv.includes('--check')) {
  if (readFileSync(path, 'utf8') !== css) throw new Error('Fluent theme CSS is stale. Run pnpm assets:fluent.');
} else {
  writeFileSync(path, css);
}
