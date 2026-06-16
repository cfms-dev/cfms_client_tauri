#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const changelogPath = "src/lib/changelog/CHANGELOG.md";
const tauriConfigPath = "src-tauri/tauri.conf.json";

const semverPattern =
  /^v?(?<major>0|[1-9]\d*)\.(?<minor>0|[1-9]\d*)\.(?<patch>0|[1-9]\d*)(?:-(?<pre>[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+(?<build>[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

const categoryMap = new Map([
  ["feat", "Added"],
  ["fix", "Fixed"],
  ["perf", "Improved"],
  ["refactor", "Improved"],
  ["style", "Improved"],
  ["docs", "Improved"],
  ["build", "Maintenance"],
  ["ci", "Maintenance"],
  ["chore", "Maintenance"],
  ["test", "Maintenance"],
]);

function usage(exitCode = 0) {
  const stream = exitCode === 0 ? process.stdout : process.stderr;
  stream.write(`CFMS Client release notes helper

Usage:
  pnpm app:release-notes -- --version <version> --out-dir <dir> [--tag <tag>] [--repository owner/repo] [--run-url <url>]
  pnpm app:changelog -- --version <version> [--base-tag <tag>] [--date YYYY-MM-DD] [--write] [--out-dir <dir>]
  pnpm app:changelog:check -- --version <version>

Notes:
  - Versions may be prefixed with "v"; changelog entries are written as v<version>.
  - Release exports prefer the checked-in changelog entry and fall back to commit summaries.
  - Generated changelog entries use conventional commit prefixes when available.
`);
  process.exit(exitCode);
}

function resolveRepo(relativePath) {
  return path.join(root, relativePath);
}

function readText(relativePath) {
  return fs.readFileSync(resolveRepo(relativePath), "utf8");
}

function writeText(relativePath, text) {
  const absolutePath = resolveRepo(relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, normalizeNewlines(text, detectNewlineFor(relativePath)));
}

function detectNewlineFor(relativePath) {
  const absolutePath = resolveRepo(relativePath);
  if (!fs.existsSync(absolutePath)) return "\n";
  return fs.readFileSync(absolutePath, "utf8").includes("\r\n") ? "\r\n" : "\n";
}

function normalizeNewlines(text, newline) {
  const normalized = text.replace(/\r\n/g, "\n");
  return newline === "\r\n" ? normalized.replace(/\n/g, "\r\n") : normalized;
}

function parseArgs(argv) {
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

function flag(flags, name, fallback = undefined) {
  return flags.has(name) ? flags.get(name) : fallback;
}

function normalizeVersion(raw) {
  const value = String(raw ?? "").trim();
  const match = value.match(semverPattern);
  if (!match) {
    throw new Error(`Invalid semantic version: ${raw}`);
  }

  const { major, minor, patch, pre, build } = match.groups;
  return `${major}.${minor}.${patch}${pre ? `-${pre}` : ""}${build ? `+${build}` : ""}`;
}

function versionTag(version) {
  return `v${normalizeVersion(version)}`;
}

function parseVersion(raw) {
  const normalized = normalizeVersion(raw);
  const { major, minor, patch, pre } = normalized.match(semverPattern).groups;
  return {
    normalized,
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    pre: pre ?? "",
  };
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (const key of ["major", "minor", "patch"]) {
    if (a[key] !== b[key]) return a[key] - b[key];
  }
  if (a.pre === b.pre) return 0;
  if (!a.pre) return 1;
  if (!b.pre) return -1;
  return a.pre.localeCompare(b.pre);
}

function readCurrentVersion() {
  const config = JSON.parse(readText(tauriConfigPath));
  return normalizeVersion(config.version);
}

function parseChangelog(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const entries = [];
  let current = null;

  function flush() {
    if (!current) return;
    entries.push({
      ...current,
      content: trimLines(current.content).join("\n").trim(),
    });
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const section = line.match(/^##\s+(.+)$/u);
    if (section) {
      flush();
      current = {
        version: section[1].trim(),
        title: null,
        date: null,
        content: [],
      };
      continue;
    }

    if (!current) continue;

    const released = line.match(/^\*\*Released on:\*\*\s*(.+)$/u);
    if (released) {
      current.date = stripMarkdownInline(released[1]);
      continue;
    }

    const title = line.match(/^\*\*Title:\*\*\s*(.+)$/u);
    if (title) {
      current.title = stripMarkdownInline(title[1]);
      continue;
    }

    if (line === "---") continue;
    current.content.push(rawLine);
  }

  flush();
  return entries;
}

function stripMarkdownInline(value) {
  return value
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .trim();
}

function trimLines(lines) {
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start].trim()) start += 1;
  while (end > start && !lines[end - 1].trim()) end -= 1;
  return lines.slice(start, end);
}

function findChangelogEntry(version) {
  const expected = versionTag(version).toLowerCase();
  const entries = parseChangelog(readText(changelogPath));
  return entries.find((entry) => entry.version.toLowerCase() === expected) ?? null;
}

function git(args, fallback = "") {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return fallback;
  }
}

function latestPreviousTag(version, explicitBaseTag) {
  if (explicitBaseTag) return explicitBaseTag;

  const current = normalizeVersion(version);
  const tags = git(["tag", "--merged", "HEAD", "--sort=-v:refname"])
    .split(/\r?\n/u)
    .map((tag) => tag.trim())
    .filter((tag) => semverPattern.test(tag))
    .filter((tag) => normalizeVersion(tag) !== current)
    .filter((tag) => compareVersions(tag, current) < 0);

  return tags[0] ?? "";
}

function collectCommits(version, baseTag) {
  const tag = versionTag(version);
  const head = git(["rev-parse", "--verify", `${tag}^{commit}`]) ? tag : "HEAD";
  const range = baseTag ? `${baseTag}..${head}` : head;
  const output = git(["log", "--no-merges", "--format=%H%x00%s", range]);
  if (!output) return [];

  return output
    .split(/\r?\n/u)
    .map((line) => {
      const [hash, subject] = line.split("\0");
      return { hash: hash.slice(0, 7), subject: subject.trim() };
    })
    .filter((commit) => commit.subject && !isVersionOnlyCommit(commit.subject));
}

function isVersionOnlyCommit(subject) {
  const lower = subject.toLowerCase();
  return (
    lower.startsWith("chore: update version") ||
    lower.includes("bump version") ||
    lower.includes("release v")
  );
}

function categorizeCommits(commits) {
  const groups = new Map();
  for (const commit of commits) {
    const parsed = parseConventionalSubject(commit.subject);
    const category = categoryMap.get(parsed.type) ?? "Changed";
    const text = sentenceCase(parsed.summary);
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(text);
  }

  return [...groups.entries()]
    .map(([category, items]) => [category, unique(items)])
    .filter(([, items]) => items.length > 0);
}

function parseConventionalSubject(subject) {
  const match = subject.match(/^(?<type>[a-z]+)(?:\([^)]+\))?(?<breaking>!)?:\s*(?<summary>.+)$/u);
  if (!match) {
    return { type: "change", summary: subject };
  }

  return {
    type: match.groups.type,
    summary: match.groups.summary,
  };
}

function sentenceCase(value) {
  const cleaned = value.trim().replace(/[.。]\s*$/u, "");
  if (!cleaned) return cleaned;
  return `${cleaned[0].toUpperCase()}${cleaned.slice(1)}`;
}

function unique(items) {
  return [...new Set(items)];
}

function generatedEntry(version, flags) {
  const normalized = normalizeVersion(version);
  const baseTag = latestPreviousTag(normalized, flag(flags, "base-tag", ""));
  const commits = collectCommits(normalized, baseTag);
  const groups = categorizeCommits(commits);
  const today = flag(flags, "date", new Date().toISOString().slice(0, 10));
  const title = deriveTitle(groups, normalized);
  const content = groupsToMarkdown(groups, "Changed");
  const markdown = [
    `## ${versionTag(normalized)}`,
    `**Released on:** ${today}`,
    "",
    `**Title:** ${title}`,
    "",
    content || "### Changed\n- Maintenance release.",
  ].join("\n");

  return {
    version: versionTag(normalized),
    title,
    date: today,
    content: content || "### Changed\n- Maintenance release.",
    markdown,
    baseTag,
    commits,
    generated: true,
  };
}

function deriveTitle(groups, version) {
  const preferred =
    groups.find(([category]) => category === "Added") ??
    groups.find(([category]) => category === "Fixed") ??
    groups[0];
  const first = preferred?.[1]?.[0];
  if (!first) return `CFMS Client ${version}`;
  return first.length > 64 ? `${first.slice(0, 61).trim()}...` : first;
}

function groupsToMarkdown(groups, fallbackCategory) {
  if (groups.length === 0) return "";

  return groups
    .map(([category, items]) => {
      const heading = category || fallbackCategory;
      return [`### ${heading}`, ...items.map((item) => `- ${item}`)].join("\n");
    })
    .join("\n\n");
}

function buildUpdaterNotes(entry) {
  const parts = [];
  if (entry.title && entry.title !== entry.version) {
    parts.push(`## ${entry.title}`);
  }
  if (entry.content) {
    parts.push(entry.content);
  }
  return parts.join("\n\n").trim() || `CFMS Client ${entry.version}`;
}

function releaseChannel(version) {
  const lower = normalizeVersion(version).toLowerCase();
  if (lower.includes("alpha")) return "alpha";
  if (lower.includes("beta")) return "beta";
  return lower.includes("-") ? "alpha" : "stable";
}

function buildReleaseBody(entry, options) {
  const version = normalizeVersion(options.version);
  const channel = releaseChannel(version);
  const runUrl = options.runUrl;
  const repository = options.repository;
  const body = [
    `<!-- channel: ${channel} -->`,
    "",
    `## CFMS Client ${version}`,
    "",
    entry.title && entry.title !== entry.version ? `**${entry.title}**` : "",
    "",
    entry.content,
    "",
    "### Downloads",
    "- Windows: MSI and NSIS installers.",
    "- Linux: AppImage, deb and rpm packages.",
    "- Android: APK and AAB packages.",
    "",
    "### Verification",
    "- SHA-256 checksums are published in `SHA256SUMS.txt`.",
    "- Desktop updater metadata is published in `latest.json`.",
  ].filter((line) => line !== null);

  if (runUrl || repository) {
    body.push("", "### Build");
    if (runUrl) {
      body.push(`- Workflow run: ${runUrl}`);
    } else if (repository) {
      body.push(`- Workflow: https://github.com/${repository}/actions`);
    }
  }

  return body.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

function writeOutDir(outDir, files) {
  if (!outDir) return;
  for (const [name, content] of Object.entries(files)) {
    writeText(path.join(outDir, name), content);
  }
}

function insertChangelogEntry(markdown, entryMarkdown) {
  const normalized = markdown.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const separatorIndex = lines.findIndex((line) => line.trim() === "---");
  if (separatorIndex === -1) {
    return `${entryMarkdown}\n\n---\n\n${normalized}`;
  }

  const before = lines.slice(0, separatorIndex + 1).join("\n").trimEnd();
  const after = lines.slice(separatorIndex + 1).join("\n").trimStart();
  return `${before}\n\n${entryMarkdown}\n\n--- \n\n${after}`;
}

function commandExport(positionals, flags) {
  const version = normalizeVersion(flag(flags, "version", positionals[1] ?? readCurrentVersion()));
  const entry = findChangelogEntry(version) ?? generatedEntry(version, flags);
  const updaterNotes = buildUpdaterNotes(entry);
  const releaseBody = buildReleaseBody(entry, {
    version,
    repository: flag(flags, "repository", ""),
    runUrl: flag(flags, "run-url", ""),
  });

  writeOutDir(flag(flags, "out-dir", ""), {
    "updater-notes.md": updaterNotes + "\n",
    "release-notes.md": releaseBody,
    "changelog-entry.md": entry.markdown ? `${entry.markdown}\n` : "",
  });

  process.stdout.write(
    `Prepared release notes for ${version}${entry.generated ? " from git commits" : " from changelog"}.\n`,
  );
}

function commandChangelog(positionals, flags) {
  const version = normalizeVersion(flag(flags, "version", positionals[1] ?? readCurrentVersion()));
  const existing = findChangelogEntry(version);
  if (existing) {
    process.stdout.write(`Changelog already contains ${versionTag(version)}.\n`);
    return;
  }

  const entry = generatedEntry(version, flags);
  writeOutDir(flag(flags, "out-dir", ""), {
    "changelog-entry.md": `${entry.markdown}\n`,
  });

  if (!flag(flags, "write", false)) {
    process.stdout.write(`${entry.markdown}\n`);
    return;
  }

  const updated = insertChangelogEntry(readText(changelogPath), entry.markdown);
  writeText(changelogPath, updated);
  process.stdout.write(`Inserted generated changelog entry for ${versionTag(version)}.\n`);
}

function commandCheck(positionals, flags) {
  const version = normalizeVersion(flag(flags, "version", positionals[1] ?? readCurrentVersion()));
  const entry = findChangelogEntry(version);
  if (!entry) {
    process.stderr.write(
      `Missing changelog entry for ${versionTag(version)}. Run: pnpm app:changelog -- --version ${version} --write\n`,
    );
    process.exit(1);
  }

  if (!entry.content.trim()) {
    process.stderr.write(`Changelog entry for ${versionTag(version)} has no release notes.\n`);
    process.exit(1);
  }

  process.stdout.write(`Changelog entry for ${versionTag(version)} is ready.\n`);
}

function main() {
  const { positionals, flags } = parseArgs(process.argv.slice(2));
  const command = positionals[0] ?? "help";

  switch (command) {
    case "export":
      commandExport(positionals, flags);
      break;
    case "changelog":
      commandChangelog(positionals, flags);
      break;
    case "check":
      commandCheck(positionals, flags);
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
