#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const files = {
  packageJson: "package.json",
  packageLock: "package-lock.json",
  cargoWorkspace: "Cargo.toml",
  cargoLock: "Cargo.lock",
  tauriConfig: "src-tauri/tauri.conf.json",
  iosInfoPlist: "src-tauri/gen/ios/CFMS Client/Info.plist",
  androidTauriProperties: "src-tauri/gen/android/app/tauri.properties",
};

const semverPattern =
  /^(?<major>0|[1-9]\d*)\.(?<minor>0|[1-9]\d*)\.(?<patch>0|[1-9]\d*)(?:-(?<pre>[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+(?<build>[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

function usage(exitCode = 0) {
  const stream = exitCode === 0 ? process.stdout : process.stderr;
  stream.write(`CFMS Client version helper

Usage:
  pnpm app:version show
  pnpm app:version check
  pnpm app:version set <version> [--build-number <number>] [--dry-run]
  pnpm app:version bump <major|minor|patch|prerelease> [--preid beta] [--dry-run]

Notes:
  - <version> may be prefixed with "v"; files are written without the prefix.
  - --build-number sets both iOS CFBundleVersion and Android versionCode.
  - Local generated Android metadata is synced when src-tauri/gen/android/app/tauri.properties exists.
`);
  process.exit(exitCode);
}

function resolveRepo(relativePath) {
  return path.join(root, relativePath);
}

function exists(relativePath) {
  return fs.existsSync(resolveRepo(relativePath));
}

function readText(relativePath) {
  return fs.readFileSync(resolveRepo(relativePath), "utf8");
}

function writeText(relativePath, text, dryRun) {
  if (dryRun) {
    return;
  }
  const absolutePath = resolveRepo(relativePath);
  const newline = fs.existsSync(absolutePath)
    ? detectNewline(fs.readFileSync(absolutePath, "utf8"))
    : "\n";
  fs.writeFileSync(absolutePath, normalizeNewlines(text, newline));
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function writeJson(relativePath, value, dryRun) {
  writeText(relativePath, `${JSON.stringify(value, null, 2)}\n`, dryRun);
}

function detectNewline(text) {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

function normalizeNewlines(text, newline) {
  const normalized = text.replace(/\r\n/g, "\n");
  return newline === "\r\n" ? normalized.replace(/\n/g, "\r\n") : normalized;
}

function normalizeVersion(raw) {
  const version = String(raw ?? "").trim().replace(/^v/, "");
  const match = version.match(semverPattern);
  if (!match) {
    throw new Error(`Invalid semantic version: ${raw}`);
  }
  return version;
}

function parseVersion(raw) {
  const version = normalizeVersion(raw);
  const { major, minor, patch, pre, build } = version.match(semverPattern).groups;
  return {
    version,
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    pre: pre ?? "",
    build: build ?? "",
  };
}

function baseVersion(version) {
  const parsed = parseVersion(version);
  return `${parsed.major}.${parsed.minor}.${parsed.patch}`;
}

function versionBuildNumber(version) {
  const parsed = parseVersion(version);
  if (parsed.major > 20 || parsed.minor > 999 || parsed.patch > 999) {
    throw new Error(
      `Version ${version} is too large for the default build number formula`,
    );
  }
  return parsed.major * 1_000_000 + parsed.minor * 1_000 + parsed.patch;
}

function parseArgs(argv) {
  const positionals = [];
  const flags = new Map();

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
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

function flag(flags, name, fallback = undefined) {
  return flags.has(name) ? flags.get(name) : fallback;
}

function readPackageVersion() {
  return readJson(files.packageJson).version;
}

function updatePackageJson(version, dryRun) {
  const pkg = readJson(files.packageJson);
  pkg.version = version;
  writeJson(files.packageJson, pkg, dryRun);
}

function updatePackageLock(version, dryRun) {
  if (!exists(files.packageLock)) {
    return false;
  }

  const lock = readJson(files.packageLock);
  if (lock.version !== undefined) {
    lock.version = version;
  }
  if (lock.packages?.[""]?.version !== undefined) {
    lock.packages[""].version = version;
  }
  writeJson(files.packageLock, lock, dryRun);
  return true;
}

function readTauriVersion() {
  return readJson(files.tauriConfig).version;
}

function updateTauriConfig(version, dryRun) {
  const text = readText(files.tauriConfig);
  const updated = text.replace(
    /^(\s*"version"\s*:\s*")[^"]+(")/m,
    `$1${version}$2`,
  );
  if (updated === text) {
    throw new Error(`${files.tauriConfig} is missing top-level version`);
  }
  writeText(files.tauriConfig, updated, dryRun);
}

function readWorkspaceVersion() {
  const text = readText(files.cargoWorkspace);
  const section = getTomlSection(text, "workspace.package");
  const match = section.match(/^\s*version\s*=\s*"([^"]+)"/m);
  if (!match) {
    throw new Error("Cargo.toml is missing [workspace.package] version");
  }
  return match[1];
}

function getTomlSection(text, sectionName) {
  const bounds = tomlSectionBounds(text, sectionName);
  return text.slice(bounds.bodyStart, bounds.bodyEnd);
}

function updateWorkspaceCargoToml(version, dryRun) {
  const text = readText(files.cargoWorkspace);
  const updated = replaceTomlSectionLine(
    text,
    "workspace.package",
    "version",
    `version = "${version}"`,
  );
  writeText(files.cargoWorkspace, updated, dryRun);
}

function replaceTomlSectionLine(text, sectionName, key, replacement) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const bounds = tomlSectionBounds(text, sectionName);
  const body = text.slice(bounds.bodyStart, bounds.bodyEnd);

  const linePattern = new RegExp(`^(\\s*)${escapedKey}\\s*=.*$`, "m");
  if (!linePattern.test(body)) {
    throw new Error(`Missing ${key} in [${sectionName}]`);
  }

  return `${text.slice(0, bounds.bodyStart)}${body.replace(
    linePattern,
    `$1${replacement}`,
  )}${text.slice(bounds.bodyEnd)}`;
}

function tomlSectionBounds(text, sectionName) {
  const escaped = sectionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const headerPattern = new RegExp(`^\\[${escaped}\\]\\s*$`, "m");
  const header = headerPattern.exec(text);
  if (!header) {
    throw new Error(`Missing TOML section [${sectionName}]`);
  }

  const bodyStart = header.index + header[0].length;
  const rest = text.slice(bodyStart);
  const nextHeaderOffset = rest.search(/^\[/m);
  const bodyEnd =
    nextHeaderOffset === -1 ? text.length : bodyStart + nextHeaderOffset;

  return { bodyStart, bodyEnd };
}

function workspacePackageNames() {
  const workspace = readText(files.cargoWorkspace);
  const membersMatch = workspace.match(/members\s*=\s*\[([\s\S]*?)\]/m);
  if (!membersMatch) {
    throw new Error("Cargo.toml is missing workspace members");
  }

  return membersMatch[1]
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*/, "").trim())
    .filter(Boolean)
    .map((line) => line.replace(/[",]/g, ""))
    .map((member) => {
      const manifest = path.join(member, "Cargo.toml").replaceAll("\\", "/");
      const text = readText(manifest);
      const packageSection = getTomlSection(text, "package");
      const name = packageSection.match(/^\s*name\s*=\s*"([^"]+)"/m)?.[1];
      if (!name) {
        throw new Error(`${manifest} is missing [package] name`);
      }
      return name;
    });
}

function updateCargoLock(version, dryRun) {
  if (!exists(files.cargoLock)) {
    return false;
  }

  const names = new Set(workspacePackageNames());
  const text = readText(files.cargoLock);
  const updated = text.replace(
    /(\[\[package\]\]\r?\nname = "([^"]+)"\r?\nversion = ")[^"]+(")/g,
    (match, prefix, name, suffix) => {
      return names.has(name) ? `${prefix}${version}${suffix}` : match;
    },
  );
  writeText(files.cargoLock, updated, dryRun);
  return true;
}

function readCargoLockVersions() {
  if (!exists(files.cargoLock)) {
    return [];
  }

  const names = new Set(workspacePackageNames());
  const versions = [];
  const text = readText(files.cargoLock);
  const packagePattern =
    /\[\[package\]\]\r?\nname = "([^"]+)"\r?\nversion = "([^"]+)"/g;

  for (const match of text.matchAll(packagePattern)) {
    if (names.has(match[1])) {
      versions.push({ name: match[1], version: match[2] });
    }
  }

  return versions;
}

function updateIosInfoPlist(version, buildNumber, dryRun) {
  if (!exists(files.iosInfoPlist)) {
    return false;
  }

  const marketingVersion = baseVersion(version);
  let text = readText(files.iosInfoPlist);
  text = replacePlistString(text, "CFBundleShortVersionString", marketingVersion);
  text = replacePlistString(text, "CFBundleVersion", String(buildNumber));
  writeText(files.iosInfoPlist, text, dryRun);
  return true;
}

function readIosInfoPlist() {
  if (!exists(files.iosInfoPlist)) {
    return null;
  }

  const text = readText(files.iosInfoPlist);
  return {
    marketingVersion: readPlistString(text, "CFBundleShortVersionString"),
    buildNumber: readPlistString(text, "CFBundleVersion"),
  };
}

function readPlistString(text, key) {
  const match = text.match(
    new RegExp(`<key>${key}</key>\\s*\\r?\\n\\s*<string>([^<]*)</string>`),
  );
  if (!match) {
    throw new Error(`${files.iosInfoPlist} is missing ${key}`);
  }
  return match[1];
}

function replacePlistString(text, key, value) {
  const pattern = new RegExp(
    `(<key>${key}</key>\\s*\\r?\\n\\s*<string>)[^<]*(</string>)`,
  );
  if (!pattern.test(text)) {
    throw new Error(`${files.iosInfoPlist} is missing ${key}`);
  }
  return text.replace(pattern, `$1${value}$2`);
}

function updateAndroidTauriProperties(version, buildNumber, dryRun) {
  if (!exists(files.androidTauriProperties)) {
    return false;
  }

  let text = readText(files.androidTauriProperties);
  text = replaceProperty(text, "tauri.android.versionName", version);
  text = replaceProperty(text, "tauri.android.versionCode", String(buildNumber));
  writeText(files.androidTauriProperties, text, dryRun);
  return true;
}

function readAndroidTauriProperties() {
  if (!exists(files.androidTauriProperties)) {
    return null;
  }

  const text = readText(files.androidTauriProperties);
  return {
    versionName: readProperty(text, "tauri.android.versionName"),
    versionCode: readProperty(text, "tauri.android.versionCode"),
  };
}

function readProperty(text, key) {
  const match = text.match(new RegExp(`^${escapeRegex(key)}=(.*)$`, "m"));
  if (!match) {
    throw new Error(`${files.androidTauriProperties} is missing ${key}`);
  }
  return match[1].trim();
}

function replaceProperty(text, key, value) {
  const pattern = new RegExp(`^${escapeRegex(key)}=.*$`, "m");
  const replacement = `${key}=${value}`;
  return pattern.test(text)
    ? text.replace(pattern, replacement)
    : `${text.replace(/\s*$/, "\n")}${replacement}\n`;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collectVersions() {
  const versions = [
    { target: files.packageJson, field: "version", value: readPackageVersion() },
    {
      target: files.cargoWorkspace,
      field: "[workspace.package].version",
      value: readWorkspaceVersion(),
    },
    { target: files.tauriConfig, field: "version", value: readTauriVersion() },
  ];

  if (exists(files.packageLock)) {
    const lock = readJson(files.packageLock);
    if (lock.version !== undefined) {
      versions.push({
        target: files.packageLock,
        field: "version",
        value: lock.version,
      });
    }
    if (lock.packages?.[""]?.version !== undefined) {
      versions.push({
        target: files.packageLock,
        field: 'packages[""].version',
        value: lock.packages[""].version,
      });
    }
  }

  for (const entry of readCargoLockVersions()) {
    versions.push({
      target: files.cargoLock,
      field: `package ${entry.name}`,
      value: entry.version,
    });
  }

  const ios = readIosInfoPlist();
  if (ios) {
    versions.push({
      target: files.iosInfoPlist,
      field: "CFBundleShortVersionString",
      value: ios.marketingVersion,
      expectsBaseVersion: true,
    });
    versions.push({
      target: files.iosInfoPlist,
      field: "CFBundleVersion",
      value: ios.buildNumber,
      buildNumber: true,
    });
  }

  const android = readAndroidTauriProperties();
  if (android) {
    versions.push({
      target: files.androidTauriProperties,
      field: "tauri.android.versionName",
      value: android.versionName,
    });
    versions.push({
      target: files.androidTauriProperties,
      field: "tauri.android.versionCode",
      value: android.versionCode,
      buildNumber: true,
    });
  }

  return versions;
}

function printVersions(versions) {
  const width = Math.max(...versions.map((entry) => entry.target.length));
  for (const entry of versions) {
    process.stdout.write(
      `${entry.target.padEnd(width)}  ${entry.field}: ${entry.value}\n`,
    );
  }
}

function commandShow() {
  printVersions(collectVersions());
}

function commandCheck() {
  const canonical = normalizeVersion(readTauriVersion());
  const expectedBase = baseVersion(canonical);
  const expectedBuildNumber = String(versionBuildNumber(canonical));
  const versions = collectVersions();
  const mismatches = versions.filter((entry) => {
    if (entry.buildNumber) {
      return entry.value !== expectedBuildNumber;
    }
    if (entry.expectsBaseVersion) {
      return entry.value !== expectedBase;
    }
    return entry.value !== canonical;
  });

  if (mismatches.length === 0) {
    process.stdout.write(`Client build metadata is in sync at ${canonical}.\n`);
    return;
  }

  process.stderr.write(`Client build metadata is not in sync.\n`);
  process.stderr.write(`Expected version: ${canonical}\n`);
  process.stderr.write(`Expected base version: ${expectedBase}\n`);
  process.stderr.write(`Expected build number: ${expectedBuildNumber}\n\n`);
  printVersions(mismatches);
  process.exit(1);
}

function setVersion(version, flags) {
  const normalized = normalizeVersion(version);
  const buildNumber = Number(
    flag(flags, "build-number", versionBuildNumber(normalized)),
  );
  const dryRun = Boolean(flag(flags, "dry-run", false));

  if (!Number.isInteger(buildNumber) || buildNumber < 1) {
    throw new Error(`Invalid build number: ${buildNumber}`);
  }

  updatePackageJson(normalized, dryRun);
  updatePackageLock(normalized, dryRun);
  updateWorkspaceCargoToml(normalized, dryRun);
  updateCargoLock(normalized, dryRun);
  updateTauriConfig(normalized, dryRun);
  updateIosInfoPlist(normalized, buildNumber, dryRun);
  updateAndroidTauriProperties(normalized, buildNumber, dryRun);

  const action = dryRun ? "Would sync" : "Synced";
  process.stdout.write(
    `${action} client version ${normalized} with build number ${buildNumber}.\n`,
  );
}

function commandSet(positionals, flags) {
  const version = positionals[1];
  if (!version) {
    usage(1);
  }
  setVersion(version, flags);
}

function bumpVersion(current, bump, preid) {
  const parsed = parseVersion(current);
  let { major, minor, patch } = parsed;
  let pre = "";

  switch (bump) {
    case "major":
      major += 1;
      minor = 0;
      patch = 0;
      break;
    case "minor":
      minor += 1;
      patch = 0;
      break;
    case "patch":
      patch += 1;
      break;
    case "prerelease": {
      const id = preid || "beta";
      if (parsed.pre.startsWith(`${id}.`)) {
        const tail = parsed.pre.slice(id.length + 1);
        const next = /^\d+$/.test(tail) ? Number(tail) + 1 : 0;
        pre = `${id}.${next}`;
      } else {
        patch += parsed.pre ? 0 : 1;
        pre = `${id}.0`;
      }
      break;
    }
    default:
      throw new Error(`Unsupported bump kind: ${bump}`);
  }

  return `${major}.${minor}.${patch}${pre ? `-${pre}` : ""}`;
}

function commandBump(positionals, flags) {
  const bump = positionals[1];
  if (!bump) {
    usage(1);
  }
  const next = bumpVersion(readTauriVersion(), bump, flag(flags, "preid", "beta"));
  setVersion(next, flags);
}

function main() {
  const { positionals, flags } = parseArgs(process.argv.slice(2));
  const command = positionals[0] ?? "help";

  switch (command) {
    case "show":
      commandShow();
      break;
    case "check":
      commandCheck();
      break;
    case "set":
      commandSet(positionals, flags);
      break;
    case "bump":
      commandBump(positionals, flags);
      break;
    case "help":
    case "--help":
    case "-h":
      usage(0);
      break;
    default:
      usage(1);
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
