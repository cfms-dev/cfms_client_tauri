import { readFileSync, readdirSync } from 'node:fs';
import { extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SOURCE_ROOT = resolve(ROOT, 'src');
const SOURCE_EXTENSIONS = new Set(['.css', '.svelte']);
const FOCUS_UTILITY = /\b(?:focus|focus-visible):(?:border(?:-[^\s"'`}>]+)?|outline(?:-[^\s"'`}>]+)?|ring(?:-[^\s"'`}>]+)?|shadow(?:-[^\s"'`}>]+)?)/g;
const FIELD_TAG = /<(input|textarea|select)\b[\s\S]*?>/gi;

function lineNumberAt(source, index) {
  return source.slice(0, index).split(/\r?\n/).length;
}

function listSourceFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(path));
    } else if (SOURCE_EXTENSIONS.has(extname(entry.name))) {
      files.push(path);
    }
  }
  return files;
}

function focusPaintProperties(declarations) {
  const properties = [];
  for (const match of declarations.matchAll(/(?:^|;)\s*([\w-]+)\s*:/g)) {
    const property = match[1].toLowerCase();
    if (
      property === 'box-shadow'
      || property === 'border'
      || property.startsWith('outline')
      || /^border-(?:color|style|width|block|inline|top|right|bottom|left)/.test(property)
    ) {
      properties.push(property);
    }
  }
  return properties;
}

function selectorPaintsFocusedField(selector) {
  for (const branch of selector.split(',')) {
    const fieldFocus = /(?:^|[\s>+~,(])(?:input|textarea|select)\b[^,{]*:focus(?!-within)(?:-visible)?\b/i.exec(branch);
    if (fieldFocus) {
      const remainder = branch.slice((fieldFocus.index ?? 0) + fieldFocus[0].length);
      if (!/^\s*[+~>]/.test(remainder) && !/^\s+\S/.test(remainder)) return true;
    }

    if (/[.-](?:field|input|textarea)\b[^,{]*:focus(?!-within)\b/i.test(branch)) return true;
  }
  return false;
}

function styleRegions(source, filename) {
  if (extname(filename) === '.css') return [{ source, offset: 0 }];

  const regions = [];
  for (const match of source.matchAll(/<style(?:\s[^>]*)?>([\s\S]*?)<\/style>/gi)) {
    regions.push({ source: match[1], offset: (match.index ?? 0) + match[0].indexOf(match[1]) });
  }
  return regions;
}

export function findFocusStyleViolations(source, filename = 'Component.svelte') {
  const violations = [];

  for (const match of source.matchAll(FIELD_TAG)) {
    const tag = match[0];
    if (/data-focus-ring\s*=\s*["']delegated["']/i.test(tag)) continue;
    const utilities = [...tag.matchAll(FOCUS_UTILITY)].map((utility) => utility[0]);
    if (utilities.length === 0) continue;
    violations.push({
      line: lineNumberAt(source, match.index ?? 0),
      reason: `non-delegated <${match[1].toLowerCase()}> declares ${[...new Set(utilities)].join(', ')}`,
    });
  }

  for (const region of styleRegions(source, filename)) {
    const css = region.source.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1].trim();
      if (!selectorPaintsFocusedField(selector)) continue;
      const properties = focusPaintProperties(match[2]);
      if (properties.length === 0) continue;
      violations.push({
        line: lineNumberAt(source, region.offset + (match.index ?? 0)),
        reason: `local field focus selector "${selector.replace(/\s+/g, ' ')}" paints ${[...new Set(properties)].join(', ')}`,
      });
    }
  }

  return violations;
}

export function validateAuthoritativeFocusStyles(source) {
  const ordinaryRule = /:root\s+:where\(input,\s*textarea,\s*select\):not\(\[data-focus-ring=["']delegated["']\]\):focus\s*\{([\s\S]*?)\}/.exec(source);
  const delegatedRule = /:root\s+:where\(\[data-focus-ring=["']delegated["']\]\):focus\s*\{([\s\S]*?)\}/.exec(source);
  const problems = [];

  if (!ordinaryRule) {
    problems.push('the authoritative native-field focus rule is missing');
  } else {
    for (const declaration of ['border-color', 'outline', 'box-shadow']) {
      if (!new RegExp(`${declaration}\\s*:[^;]+!important`).test(ordinaryRule[1])) {
        problems.push(`${declaration} must remain authoritative in the native-field focus rule`);
      }
    }
  }

  if (!delegatedRule || !/outline\s*:[^;]+!important/.test(delegatedRule[1])) {
    problems.push('delegated controls must suppress their native outline authoritatively');
  }

  return problems;
}

export function run() {
  const violations = [];
  for (const path of listSourceFiles(SOURCE_ROOT)) {
    const relativePath = relative(ROOT, path).replaceAll('\\', '/');
    if (relativePath === 'src/app.css') continue;
    const source = readFileSync(path, 'utf8');
    for (const violation of findFocusStyleViolations(source, path)) {
      violations.push({ path: relativePath, ...violation });
    }
  }

  const appCss = readFileSync(resolve(SOURCE_ROOT, 'app.css'), 'utf8');
  for (const reason of validateAuthoritativeFocusStyles(appCss)) {
    violations.push({ path: 'src/app.css', line: 1, reason });
  }

  if (violations.length === 0) {
    console.log('✓ Focus-ring contract: every native field has a single focus-ring owner.');
    return 0;
  }

  console.error('Focus-ring contract violations:');
  for (const violation of violations) {
    console.error(`  - ${violation.path}:${violation.line} ${violation.reason}`);
  }
  console.error('Use the global native-field indicator, or mark a composite input data-focus-ring="delegated" and paint focus on its owner.');
  return 1;
}

const isDirectRun = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  try {
    process.exitCode = run();
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(`Failed to check the focus-ring contract:\n${message}`);
    process.exitCode = 2;
  }
}
