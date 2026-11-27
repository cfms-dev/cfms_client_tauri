import changelogMarkdown from '#lib/features/updates/changelog/CHANGELOG.md?raw';
import { markdownInlineToText } from '#lib/shared/format/markdown.ts';

export type ChangelogCategoryKind =
  | 'added'
  | 'fixed'
  | 'improved'
  | 'changed'
  | 'maintenance'
  | 'other';

export interface ChangelogGroup {
  category: string;
  kind: ChangelogCategoryKind;
  content: string;
}

export interface ChangelogEntry {
  version: string;
  title: string;
  date: string | null;
  content: string;
  lead: string | null;
  leadIsWarning: boolean;
  groups: ChangelogGroup[];
}

const sectionPattern = /^##\s+(.+)$/u;
const categoryPattern = /^###\s+(.+)$/u;
const releasedPattern = /^\*\*Released on:\*\*\s*(.+)$/u;
const titlePattern = /^\*\*Title:\*\*\s*(.+)$/u;

export const changelogEntries = parseChangelog(changelogMarkdown);

function parseChangelog(markdown: string): ChangelogEntry[] {
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
    const trimmedLines = trimContent(current.content);
    const content = trimmedLines.join('\n').trim();
    const { lead, leadIsWarning, groups } = parseEntryContent(trimmedLines);
    entries.push({
      version: current.version,
      title: current.title ?? current.version,
      date: normalizeDate(current.date),
      content,
      lead,
      leadIsWarning,
      groups,
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
      current.date = markdownInlineToText(released[1]);
      continue;
    }

    const title = line.match(titlePattern);
    if (title) {
      current.title = markdownInlineToText(title[1]);
      continue;
    }

    if (line === '---') continue;
    current.content.push(rawLine);
  }

  flushCurrent();
  return entries;
}

function parseEntryContent(lines: string[]): {
  lead: string | null;
  leadIsWarning: boolean;
  groups: ChangelogGroup[];
} {
  const leadLines: string[] = [];
  const rawGroups: { category: string; lines: string[] }[] = [];
  let activeGroup: { category: string; lines: string[] } | null = null;

  for (const rawLine of lines) {
    const match = rawLine.trim().match(categoryPattern);
    if (match) {
      activeGroup = {
        category: markdownInlineToText(match[1]),
        lines: [],
      };
      rawGroups.push(activeGroup);
      continue;
    }

    if (activeGroup) {
      activeGroup.lines.push(rawLine);
    } else {
      leadLines.push(rawLine);
    }
  }

  const leadText = trimContent(leadLines).join('\n').trim();
  const lead = leadText || null;
  const leadIsWarning = Boolean(lead && /^\*\*warning:\*\*/iu.test(lead));
  const groups = rawGroups
    .map((group) => ({
      category: group.category,
      kind: classifyCategory(group.category),
      content: trimContent(group.lines).join('\n').trim(),
    }))
    .filter((group) => group.content.length > 0);

  return { lead, leadIsWarning, groups };
}

function classifyCategory(category: string): ChangelogCategoryKind {
  if (/^add/iu.test(category)) return 'added';
  if (/^fix/iu.test(category)) return 'fixed';
  if (/^improv/iu.test(category)) return 'improved';
  if (/^chang/iu.test(category)) return 'changed';
  if (/^maint/iu.test(category)) return 'maintenance';
  return 'other';
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
