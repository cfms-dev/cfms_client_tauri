import { describe, expect, it } from 'vitest';
import {
  createUploadConflictResolver,
  partitionUploadConflicts,
  resolveUploadConflicts,
  type UploadCandidate,
} from './upload-conflicts';

const candidates: UploadCandidate[] = [
  { sourcePath: 'C:/incoming/report.pdf', name: 'report.pdf', kind: 'file' },
  { sourcePath: 'C:/incoming/photos', name: 'photos', kind: 'directory' },
  { sourcePath: 'C:/incoming/new.txt', name: 'new.txt', kind: 'file' },
];

describe('partitionUploadConflicts', () => {
  it('detects both document and directory name conflicts', () => {
    const result = partitionUploadConflicts(
      candidates,
      [{ name: 'photos' }],
      [{ title: 'report.pdf' }],
    );

    expect(result.conflicting.map((candidate) => candidate.name)).toEqual(['report.pdf', 'photos']);
    expect(result.available.map((candidate) => candidate.name)).toEqual(['new.txt']);
  });

  it('uses exact server name matching', () => {
    const result = partitionUploadConflicts(
      [{ sourcePath: '/Report.pdf', name: 'Report.pdf', kind: 'file' }],
      [],
      [{ title: 'report.pdf' }],
    );

    expect(result.conflicting).toHaveLength(0);
    expect(result.available).toHaveLength(1);
  });
});

describe('resolveUploadConflicts', () => {
  it('prompts each item until a choice is applied to all remaining conflicts', async () => {
    const prompted: string[] = [];
    const decisions = await resolveUploadConflicts(candidates, async (candidate, index) => {
      prompted.push(candidate.name);
      return index === 0
        ? { action: 'keep_both', applyToRemaining: false }
        : { action: 'skip', applyToRemaining: true };
    });

    expect(prompted).toEqual(['report.pdf', 'photos']);
    expect(decisions?.map(({ candidate, action }) => [candidate.name, action])).toEqual([
      ['report.pdf', 'keep_both'],
      ['photos', 'skip'],
      ['new.txt', 'skip'],
    ]);
  });

  it('cancels the unresolved batch without returning partial decisions', async () => {
    const decisions = await resolveUploadConflicts(candidates, async () => null);
    expect(decisions).toBeNull();
  });
});

describe('createUploadConflictResolver', () => {
  it('resolves incrementally discovered conflicts in order', async () => {
    const prompted: string[] = [];
    const resolver = createUploadConflictResolver(async (candidate, index) => {
      prompted.push(`${index}:${candidate.name}`);
      return { action: 'keep_both', applyToRemaining: index === 0 };
    });

    const decisions = await Promise.all(candidates.map((candidate) => resolver.resolve(candidate)));

    expect(prompted).toEqual(['0:report.pdf']);
    expect(decisions.map((decision) => decision?.action)).toEqual([
      'keep_both',
      'keep_both',
      'keep_both',
    ]);
    expect(resolver.cancelled).toBe(false);
  });

  it('ignores later streamed conflicts after cancellation', async () => {
    const resolver = createUploadConflictResolver(async () => null);

    const decisions = await Promise.all(candidates.map((candidate) => resolver.resolve(candidate)));

    expect(decisions).toEqual([null, null, null]);
    expect(resolver.cancelled).toBe(true);
  });
});
