import { readFileSync, readdirSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

const FRONTEND_CATALOGS = [
  { locale: 'en', path: 'src/lib/i18n/messages/en.ts', exportName: 'en' },
  { locale: 'zh-CN', path: 'src/lib/i18n/messages/zh-CN.ts', exportName: 'zh_CN' },
];

const BACKEND_CATALOGS = [
  { locale: 'en', path: 'src-tauri/i18n/en.ftl' },
  { locale: 'zh-CN', path: 'src-tauri/i18n/zh_CN.ftl' },
];

const SOURCE_EXTENSIONS = new Set(['.js', '.mjs', '.rs', '.svelte', '.ts']);
const IGNORED_SOURCE_NAMES = [
  /(?:^|\.)test\.[^.]+$/,
  /(?:^|\.)spec\.[^.]+$/,
];
const WARN_ONLY_LIST_LIMIT = 20;

function unwrapExpression(node) {
  while (
    ts.isAsExpression(node)
    || ts.isSatisfiesExpression(node)
    || ts.isParenthesizedExpression(node)
  ) {
    node = node.expression;
  }
  return node;
}

function propertyName(node) {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) {
    return node.text;
  }
  throw new Error(`Unsupported translation property name: ${node.getText()}`);
}

function flattenObject(node, prefix, keys) {
  node = unwrapExpression(node);
  if (!ts.isObjectLiteralExpression(node)) {
    if (prefix) keys.add(prefix);
    return;
  }

  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property)) {
      throw new Error(`Unsupported translation entry: ${property.getText()}`);
    }

    const name = propertyName(property.name);
    const key = prefix ? `${prefix}.${name}` : name;
    flattenObject(property.initializer, key, keys);
  }
}

export function extractTypeScriptCatalogKeys(source, exportName, filename = 'catalog.ts') {
  const sourceFile = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const keys = new Set();

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== exportName) continue;
      if (!declaration.initializer) {
        throw new Error(`Translation export ${exportName} has no initializer in ${filename}`);
      }
      flattenObject(declaration.initializer, '', keys);
      return keys;
    }
  }

  throw new Error(`Cannot find translation export ${exportName} in ${filename}`);
}

export function extractFluentCatalogKeys(source) {
  const keys = new Set();
  for (const line of source.split(/\r?\n/)) {
    const match = /^(-?[A-Za-z][A-Za-z0-9_-]*)\s*=/.exec(line);
    if (match) keys.add(match[1]);
  }
  return keys;
}

function unescapeSimpleString(value) {
  return value.replace(/\\(['"`\\])/g, '$1');
}

export function collectSourceFacts(sources) {
  const literals = new Set();
  const templates = [];
  const quotedString = /(['"])((?:\\.|(?!\1)[^\\\r\n])*)\1/g;
  const templateLiteral = /`((?:\\.|[^`])*)`/gs;
  const interpolation = /\$\{[^{}]*\}/g;

  for (const source of sources) {
    for (const match of source.matchAll(quotedString)) {
      literals.add(unescapeSimpleString(match[2]));
    }

    for (const match of source.matchAll(templateLiteral)) {
      const body = match[1];
      if (!body.includes('${')) {
        literals.add(unescapeSimpleString(body));
        continue;
      }

      const segments = body.split(interpolation).map(unescapeSimpleString);
      if (segments.length > 1) templates.push(segments);
    }
  }

  return { literals, templates };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function isTranslationKeyUsed(key, facts) {
  if (facts.literals.has(key)) return true;

  for (const segments of facts.templates) {
    const pattern = segments.map(escapeRegExp).join('(.+?)');
    const match = new RegExp(`^${pattern}$`).exec(key);
    if (!match) continue;
    if (match.slice(1).every((candidate) => facts.literals.has(candidate))) return true;
  }

  return false;
}

function listSourceFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(path));
      continue;
    }
    if (!SOURCE_EXTENSIONS.has(extname(entry.name))) continue;
    if (IGNORED_SOURCE_NAMES.some((pattern) => pattern.test(entry.name))) continue;
    files.push(path);
  }
  return files;
}

function loadCatalogs(catalogs, parser) {
  const localesByKey = new Map();
  for (const catalog of catalogs) {
    const absolutePath = resolve(ROOT, catalog.path);
    const keys = parser(readFileSync(absolutePath, 'utf8'), catalog.exportName, absolutePath);
    for (const key of keys) {
      const locales = localesByKey.get(key) ?? [];
      locales.push(catalog.locale);
      localesByKey.set(key, locales);
    }
  }
  return localesByKey;
}

function findUnused(catalogs, facts) {
  return [...catalogs.entries()]
    .filter(([key]) => !isTranslationKeyUsed(key, facts))
    .map(([key, locales]) => ({ key, locales }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

function printGroup(label, unused, listLimit = Number.POSITIVE_INFINITY) {
  if (unused.length === 0) {
    console.log(`✓ ${label}: no unused translation strings found.`);
    return;
  }

  console.warn(`⚠ ${label}: ${unused.length} possibly unused translation string(s):`);
  for (const item of unused.slice(0, listLimit)) {
    console.warn(`  - ${item.key} [${item.locales.join(', ')}]`);
  }
  if (unused.length > listLimit) {
    console.warn(`  ... ${unused.length - listLimit} more (run pnpm i18n:unused for the full list)`);
  }
}

export function run() {
  const frontendCatalogPaths = new Set(
    FRONTEND_CATALOGS.map((catalog) => resolve(ROOT, catalog.path)),
  );
  const frontendFiles = listSourceFiles(resolve(ROOT, 'src'))
    .filter((path) => !frontendCatalogPaths.has(path));
  const backendFiles = [
    ...frontendFiles,
    ...listSourceFiles(resolve(ROOT, 'src-tauri/src')),
    ...listSourceFiles(resolve(ROOT, 'crates')),
  ];

  const frontendFacts = collectSourceFacts(
    frontendFiles.map((path) => readFileSync(path, 'utf8')),
  );
  const backendFacts = collectSourceFacts(
    backendFiles.map((path) => readFileSync(path, 'utf8')),
  );
  const frontendCatalogs = loadCatalogs(FRONTEND_CATALOGS, extractTypeScriptCatalogKeys);
  const backendCatalogs = loadCatalogs(BACKEND_CATALOGS, extractFluentCatalogKeys);
  const frontendUnused = findUnused(frontendCatalogs, frontendFacts);
  const backendUnused = findUnused(backendCatalogs, backendFacts);
  const warnOnly = process.argv.includes('--warn-only');
  const listLimit = warnOnly ? WARN_ONLY_LIST_LIMIT : Number.POSITIVE_INFINITY;

  printGroup('Frontend i18n', frontendUnused, listLimit);
  printGroup('Backend Fluent i18n', backendUnused, listLimit);

  const unusedCount = frontendUnused.length + backendUnused.length;
  if (unusedCount === 0) return 0;

  if (warnOnly) {
    console.warn(`⚠ Found ${unusedCount} possibly unused translation string(s); commit is allowed.`);
    return 0;
  }

  console.error(`Found ${unusedCount} possibly unused translation string(s).`);
  return 1;
}

const isDirectRun = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  try {
    process.exitCode = run();
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(`Failed to check unused translations:\n${message}`);
    process.exitCode = 2;
  }
}
