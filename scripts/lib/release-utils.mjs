import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

export const semverPattern =
  /^v?(?<major>0|[1-9]\d*)\.(?<minor>0|[1-9]\d*)\.(?<patch>0|[1-9]\d*)(?:-(?<pre>[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+(?<build>[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export function resolveRepo(relativePath) {
  return path.join(root, relativePath);
}

export function readText(relativePath) {
  return fs.readFileSync(resolveRepo(relativePath), "utf8");
}

export function detectNewline(text) {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

export function detectNewlineFor(relativePath) {
  const absolutePath = resolveRepo(relativePath);
  if (!fs.existsSync(absolutePath)) {
    return "\n";
  }
  return detectNewline(fs.readFileSync(absolutePath, "utf8"));
}

export function normalizeNewlines(text, newline) {
  const normalized = text.replace(/\r\n/g, "\n");
  return newline === "\r\n" ? normalized.replace(/\n/g, "\r\n") : normalized;
}

export function writeText(relativePath, text, dryRun = false) {
  if (dryRun) {
    return;
  }
  const absolutePath = resolveRepo(relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(
    absolutePath,
    normalizeNewlines(text, detectNewlineFor(relativePath)),
  );
}

export function parseArgs(argv) {
  const positionals = [];
  const flags = new Map();

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") {
      continue;
    }

    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }

    const [name, inlineValue] = arg.slice(2).split("=", 2);
    if (inlineValue !== undefined) {
      flags.set(name, inlineValue);
      continue;
    }

    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      flags.set(name, next);
      i += 1;
    } else {
      flags.set(name, true);
    }
  }

  return { positionals, flags };
}

export function flag(flags, name, fallback = undefined) {
  return flags.has(name) ? flags.get(name) : fallback;
}

export function normalizeVersion(raw) {
  const value = String(raw ?? "").trim();
  const match = value.match(semverPattern);
  if (!match) {
    throw new Error(`Invalid semantic version: ${raw}`);
  }

  const { major, minor, patch, pre, build } = match.groups;
  return `${major}.${minor}.${patch}${pre ? `-${pre}` : ""}${build ? `+${build}` : ""}`;
}

export function parseVersion(raw) {
  const version = normalizeVersion(raw);
  const { major, minor, patch, pre, build } =
    version.match(semverPattern).groups;
  return {
    version,
    normalized: version,
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    pre: pre ?? "",
    build: build ?? "",
  };
}
