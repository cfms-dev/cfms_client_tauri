import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { parse } from 'svelte/compiler';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const normalize = (value) => value.replaceAll('\\', '/');
const isTest = (file) => /\.(?:test|spec)\.[^.]+$/.test(file) || file.startsWith('src/test/');
const isCode = (file) => /\.(?:ts|js|svelte)$/.test(file) && !file.endsWith('.d.ts');

/** Parse real module references, including mocks, type imports and worker URLs. */
export function moduleReferences(source, file) {
  const scripts = file.endsWith('.svelte')
    ? (() => {
      const ast = parse(source, { modern: true });
      return [ast.instance, ast.module].filter(Boolean).map(({ content }) => ({
        source: source.slice(content.start, content.end), offset: content.start,
      }));
    })()
    : [{ source, offset: 0 }];
  const references = [];
  for (const script of scripts) {
    const ast = ts.createSourceFile(file, script.source, ts.ScriptTarget.Latest, true);
    function visit(node) {
      let literal;
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) literal = node.moduleSpecifier;
      if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) literal = node.argument.literal;
      if (ts.isCallExpression(node)) {
        const callee = node.expression.getText(ast);
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword
          || ['vi.mock', 'vi.doMock', 'vi.importActual', 'vi.importMock'].includes(callee)) literal = node.arguments[0];
      }
      if (ts.isNewExpression(node) && node.expression.getText(ast) === 'URL') literal = node.arguments?.[0];
      if (literal && ts.isStringLiteralLike(literal)) references.push({
        specifier: literal.text,
        line: source.slice(0, script.offset + literal.getStart(ast)).split('\n').length,
      });
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
  return references;
}

function resolveReference(file, specifier, files) {
  const raw = specifier.split('?')[0];
  const base = raw.startsWith('$lib/') ? `src/lib/${raw.slice(5)}`
    : raw.startsWith('.') ? path.posix.normalize(path.posix.join(path.posix.dirname(file), raw)) : null;
  if (base === null) return { external: true };
  const resolved = ['', '.ts', '.js', '.svelte.ts', '/index.ts', '/index.js']
    .map((extension) => base + extension).find((candidate) => files.has(candidate));
  return { resolved };
}

const featureOf = (file) => /^src\/lib\/features\/([^/]+)\//.exec(file)?.[1];

/** Return concrete cycles, retaining their direction for useful diagnostics. */
export function dependencyCycles(graph) {
  const visited = new Set();
  const active = new Set();
  const stack = [];
  const cycles = [];
  function visit(node) {
    if (active.has(node)) { cycles.push([...stack.slice(stack.indexOf(node)), node]); return; }
    if (visited.has(node)) return;
    visited.add(node);
    active.add(node);
    stack.push(node);
    for (const target of graph.get(node) ?? []) visit(target);
    stack.pop();
    active.delete(node);
  }
  for (const node of graph.keys()) visit(node);
  return cycles;
}

/** A business root module is public; nested implementation directories are private. */
export function frontendViolations(sources, assets = []) {
  const files = new Set([...sources.keys(), ...assets]);
  const errors = [];
  const graph = new Map();
  const features = new Map();
  for (const [file, source] of sources) {
    if (!isCode(file)) continue;
    const fromFeature = featureOf(file);
    const dependencies = new Set();
    for (const { specifier, line } of moduleReferences(source, file)) {
      const location = `${file}:${line}`;
      const { external, resolved } = resolveReference(file, specifier, files);
      if (external) {
        if (!isTest(file) && specifier.startsWith('@tauri-apps/')
          && !file.startsWith('src/lib/api/') && !file.startsWith('src/lib/shared/platform/')) {
          errors.push(`${location}: native SDK access belongs in api or shared/platform (${specifier})`);
        }
        continue;
      }
      if (!resolved) { errors.push(`${location}: unresolved local reference ${specifier}`); continue; }
      if (isTest(file)) continue;
      if (isCode(resolved) && !isTest(resolved)) dependencies.add(resolved);
      const toFeature = featureOf(resolved);
      const toApp = resolved.startsWith('src/lib/app/') || resolved.startsWith('src/routes/');
      if ((file.startsWith('src/lib/shared/') || file.startsWith('src/lib/api/')) && (toApp || toFeature)) {
        errors.push(`${location}: foundation module depends on application/business code (${resolved})`);
      }
      if (fromFeature && toApp) errors.push(`${location}: business module depends on application composition (${resolved})`);
      if (toFeature && fromFeature !== toFeature) {
        if (fromFeature) {
          if (!features.has(fromFeature)) features.set(fromFeature, new Set());
          features.get(fromFeature).add(toFeature);
        }
        const relative = resolved.slice(`src/lib/features/${toFeature}/`.length);
        if (relative.includes('/')) errors.push(`${location}: cross-business import reaches a private implementation (${resolved})`);
      }
    }
    if (!isTest(file)) graph.set(file, dependencies);
  }
  for (const cycle of dependencyCycles(graph)) errors.push(`Module dependency cycle: ${cycle.join(' -> ')}`);
  for (const cycle of dependencyCycles(features)) errors.push(`Business dependency cycle: ${cycle.join(' -> ')}`);
  return errors;
}

const RUST_LAYERS = {
  'cfms-core': [],
  'cfms-crypto': ['cfms-core'],
  'cfms-transport': ['cfms-core'],
  'cfms-transfer': ['cfms-core', 'cfms-crypto', 'cfms-transport'],
  'cfms-service': ['cfms-core', 'cfms-crypto', 'cfms-transport', 'cfms-transfer'],
  'cfms-client-tauri': ['cfms-core', 'cfms-crypto', 'cfms-transport', 'cfms-transfer', 'cfms-service'],
};

export function rustDependencyViolations(metadata) {
  const errors = [];
  for (const pkg of metadata.packages) {
    if (!(pkg.name in RUST_LAYERS)) { errors.push(`Unclassified workspace crate: ${pkg.name}`); continue; }
    for (const dependency of pkg.dependencies) {
      if (!(dependency.name in RUST_LAYERS)) {
        if (pkg.name !== 'cfms-client-tauri' && /^tauri(?:-|$)/.test(dependency.name)) {
          errors.push(`${pkg.name}: native runtime dependency ${dependency.name} belongs in src-tauri`);
        }
        continue;
      }
      if (!RUST_LAYERS[pkg.name].includes(dependency.name)) errors.push(`${pkg.name}: inverted crate dependency on ${dependency.name}`);
    }
  }
  return errors;
}

/** Guard IPC names without changing runtime registration or introducing code generation. */
export function ipcViolations(frontendSources, nativeSources) {
  const declared = new Set();
  for (const source of nativeSources.values()) {
    for (const match of source.matchAll(/#\[tauri::command(?:\([^\]]*\))?\]\s*pub(?:\([^)]*\))?\s+(?:async\s+)?fn\s+(\w+)/g)) declared.add(match[1]);
  }
  const registration = nativeSources.get('src-tauri/src/commands/registry.rs') ?? '';
  const registered = new Set([...registration.matchAll(/(?:::)(\w+)\s*,/g)].map((match) => match[1]));
  const errors = [...declared].filter((name) => !registered.has(name)).map((name) => `Unregistered IPC command: ${name}`);
  for (const name of registered) if (!declared.has(name)) errors.push(`Registration has no IPC command: ${name}`);
  for (const [file, source] of frontendSources) {
    if (isTest(file) || !file.startsWith('src/lib/api/')) continue;
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    function visit(node) {
      if (ts.isCallExpression(node) && node.expression.getText(ast) === 'invoke'
        && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) {
        const name = node.arguments[0].text;
        if (!name.includes(':') && !registered.has(name)) errors.push(`${file}: invokes unregistered IPC command ${name}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
  for (const [file, source] of nativeSources) {
    if (/include!\s*\(\s*"[^"\n]+\.rs"/.test(source)) errors.push(`${file}: source inclusion bypasses module boundaries`);
  }
  return errors;
}

function walk(directory) {
  return readdirSync(path.join(ROOT, directory), { withFileTypes: true }).flatMap((entry) => {
    const file = `${directory}/${entry.name}`;
    return entry.isDirectory() ? walk(file) : [file];
  });
}

export function checkArchitecture() {
  const files = walk('src');
  const sources = new Map(files.filter(isCode).map((file) => [file, readFileSync(path.join(ROOT, file), 'utf8')]));
  const native = new Map(walk('src-tauri/src').filter((file) => file.endsWith('.rs'))
    .map((file) => [file, readFileSync(path.join(ROOT, file), 'utf8')]));
  const metadata = JSON.parse(execFileSync('cargo', ['metadata', '--no-deps', '--offline', '--format-version', '1'], {
    cwd: ROOT, encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024,
  }));
  return [...frontendViolations(sources, files), ...rustDependencyViolations(metadata), ...ipcViolations(sources, native)];
}

if (process.argv[1] && normalize(path.resolve(process.argv[1])) === normalize(fileURLToPath(import.meta.url))) {
  const errors = checkArchitecture();
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
  else console.log('✓ Architecture: module/feature directions, native adapters, crate layers, and IPC registration.');
}
