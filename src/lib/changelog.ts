import changelogMarkdown from '$lib/changelog/CHANGELOG.md?raw';
import { stripInlineMarkdown } from '$lib/markdown';

export interface ChangelogEntry {
  version: string;
  title: string;
  date: string | null;
  content: string;
}

const sectionPattern = /^##\s+(.+)$/u;
const releasedPattern = /^\*\*Released on:\*\*\s*(.+)$/u;
const titlePattern = /^\*\*Title:\*\*\s*(.+)$/u;

export const changelogEntries = parseChangelog(changelogMarkdown);
export const latestChangelogEntry = changelogEntries[0] ?? null;

export function parseChangelog(markdown: string): ChangelogEntry[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const entries: ChangelogEntry[] = [];
  let current: {
    version: string;
    title: string | null;
    date: string | null;
    content: string[];
  } | null = null;

  function flushCurrent() {
    if (!current) return;
    const content = trimContent(current.content).join('\n').trim();
    entries.push({
      version: current.version,
      title: current.title ?? current.version,
      date: normalizeDate(current.date),
      content,
    });
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const section = line.match(sectionPattern);
    if (section) {
      flushCurrent();
      current = {
        version: section[1].trim(),
        title: null,
        date: null,
        content: [],
      };
      continue;
    }

    if (!current) continue;

    const released = line.match(releasedPattern);
    if (released) {
      current.date = stripInlineMarkdown(released[1]);
      continue;
    }

    const title = line.match(titlePattern);
    if (title) {
      current.title = stripInlineMarkdown(title[1]);
      continue;
    }

    if (line === '---') continue;
    current.content.push(rawLine);
  }

  flushCurrent();
  return entries;
}

export function formatChangelogDate(value: string | null, unknownLabel: string): string {
  if (!value) return unknownLabel;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}

function normalizeDate(value: string | null): string | null {
  if (!value || value.toLowerCase() === 'tbd') return null;
  return value;
}

function trimContent(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start].trim()) start += 1;
  while (end > start && !lines[end - 1].trim()) end -= 1;
  return lines.slice(start, end);
}
