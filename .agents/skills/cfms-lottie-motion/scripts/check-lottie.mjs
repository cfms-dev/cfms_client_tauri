#!/usr/bin/env node

import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const usage = `Usage:
  node check-lottie.mjs [--loop] [--pair] <file-or-directory> [...]

Options:
  --loop  Require every animated property's first and last states to match.
  --pair  Require exactly two files whose structures differ only in theme colors.
  --help  Show this help.`;

const rawArgs = process.argv.slice(2);
const requireLoop = rawArgs.includes('--loop');
const comparePair = rawArgs.includes('--pair');
const targets = rawArgs.filter((arg) => !arg.startsWith('--'));

if (rawArgs.includes('--help')) {
  console.log(usage);
  process.exit(0);
}

if (targets.length === 0) {
  console.error(usage);
  process.exit(2);
}

async function collectJsonFiles(target) {
  const resolved = path.resolve(target);
  const info = await stat(resolved);
  if (info.isFile()) return resolved.endsWith('.json') ? [resolved] : [];
  if (!info.isDirectory()) return [];

  const entries = await readdir(resolved, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => collectJsonFiles(path.join(resolved, entry.name))),
  );
  return nested.flat();
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function hasBezierHandle(handle) {
  if (!handle || typeof handle !== 'object') return false;
  const valid = (value) =>
    typeof value === 'number' ||
    (Array.isArray(value) && value.length > 0 && value.every(Number.isFinite));
  return valid(handle.x) && valid(handle.y);
}

function inspectNode(node, trail, result) {
  if (Array.isArray(node)) {
    node.forEach((item, index) => inspectNode(item, `${trail}[${index}]`, result));
    return;
  }

  if (!node || typeof node !== 'object') return;

  for (const [key, value] of Object.entries(node)) {
    if ((key === 'x' || key === 'expression') && typeof value === 'string') {
      result.errors.push(`${trail}.${key}: expressions are not supported by the light renderer`);
    }
  }

  const keyframes = node.a === 1 && Array.isArray(node.k) ? node.k : null;
  const isKeyframed =
    keyframes && keyframes.length > 0 && keyframes.every((item) => item && typeof item === 'object' && 't' in item);

  if (isKeyframed) {
    result.animatedProperties += 1;

    for (let index = 1; index < keyframes.length; index += 1) {
      if (keyframes[index].t < keyframes[index - 1].t) {
        result.errors.push(`${trail}.k: keyframe times are not sorted at index ${index}`);
      }
    }

    keyframes.slice(0, -1).forEach((keyframe, index) => {
      if (keyframe.h === 1) return;
      if (!hasBezierHandle(keyframe.i) || !hasBezierHandle(keyframe.o)) {
        result.errors.push(
          `${trail}.k[${index}]: non-hold keyframe must carry both i and o easing handles for lottie-web`,
        );
      }
    });

    if (requireLoop && keyframes.length > 1) {
      const firstState = keyframes[0].s;
      const lastState = keyframes.at(-1).s;
      if (firstState === undefined || lastState === undefined || !sameValue(firstState, lastState)) {
        result.errors.push(`${trail}.k: first and last states differ in --loop mode`);
      }
    }
  }

  for (const [key, value] of Object.entries(node)) {
    inspectNode(value, `${trail}.${key}`, result);
  }
}

function normalizeThemeColors(node) {
  if (Array.isArray(node)) return node.map((item) => normalizeThemeColors(item));
  if (!node || typeof node !== 'object') return node;

  const normalized = {};
  for (const [key, value] of Object.entries(node)) {
    const isColorProperty =
      key === 'c' && value && typeof value === 'object' && !Array.isArray(value) && 'k' in value;
    normalized[key] = isColorProperty ? '<theme-color>' : normalizeThemeColors(value);
  }
  return normalized;
}

function validateDocument(document, file) {
  const result = { file, errors: [], animatedProperties: 0 };
  const required = ['v', 'fr', 'ip', 'op', 'w', 'h', 'layers'];
  for (const key of required) {
    if (!(key in document)) result.errors.push(`root: missing required property ${key}`);
  }
  if (!Array.isArray(document.layers)) result.errors.push('root.layers: expected an array');
  if (typeof document.ip === 'number' && typeof document.op === 'number' && document.op <= document.ip) {
    result.errors.push('root: op must be greater than ip');
  }
  inspectNode(document, 'root', result);
  return result;
}

let files;
try {
  files = [...new Set((await Promise.all(targets.map(collectJsonFiles))).flat())].sort();
} catch (error) {
  console.error(`Failed to resolve input: ${error.message}`);
  process.exit(2);
}

if (files.length === 0) {
  console.error('No JSON files found.');
  process.exit(2);
}
if (comparePair && files.length !== 2) {
  console.error(`--pair requires exactly two JSON files; found ${files.length}.`);
  process.exit(2);
}

const documents = [];
const results = [];
for (const file of files) {
  try {
    const document = JSON.parse(await readFile(file, 'utf8'));
    documents.push({ file, document });
    results.push(validateDocument(document, file));
  } catch (error) {
    results.push({ file, errors: [`root: invalid JSON (${error.message})`], animatedProperties: 0 });
  }
}

if (comparePair && documents.length === 2) {
  const [left, right] = documents;
  if (!sameValue(normalizeThemeColors(left.document), normalizeThemeColors(right.document))) {
    results[1].errors.push(
      `root: structure differs from ${path.basename(left.file)} beyond fill/stroke color properties`,
    );
  }
}

let errorCount = 0;
for (const result of results) {
  const relative = path.relative(process.cwd(), result.file) || result.file;
  if (result.errors.length === 0) {
    console.log(`PASS ${relative} (${result.animatedProperties} animated properties)`);
    continue;
  }
  errorCount += result.errors.length;
  console.error(`FAIL ${relative}`);
  result.errors.forEach((error) => console.error(`  - ${error}`));
}

if (errorCount > 0) {
  console.error(`Found ${errorCount} problem${errorCount === 1 ? '' : 's'} in ${files.length} file(s).`);
  process.exit(1);
}

console.log(`Checked ${files.length} file(s) successfully.`);
