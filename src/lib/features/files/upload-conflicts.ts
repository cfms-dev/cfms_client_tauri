import type { ServerDirectoryEntry, ServerDocumentEntry } from '$lib/api';

export type UploadCandidateKind = 'file' | 'directory';

export interface UploadCandidate {
  sourcePath: string;
  name: string;
  kind: UploadCandidateKind;
}

export interface UploadConflictPartition {
  available: UploadCandidate[];
  conflicting: UploadCandidate[];
}

export type UploadConflictAction = 'overwrite' | 'keep_both' | 'skip';

export interface UploadConflictChoice {
  action: UploadConflictAction;
  applyToRemaining: boolean;
}

export interface UploadConflictDecision<T extends UploadCandidate = UploadCandidate> {
  candidate: T;
  action: UploadConflictAction;
}

export type UploadConflictPrompt<T extends UploadCandidate = UploadCandidate> = (
  candidate: T,
  index: number,
) => Promise<UploadConflictChoice | null>;

export interface UploadConflictResolver<T extends UploadCandidate = UploadCandidate> {
  readonly cancelled: boolean;
  resolve(candidate: T): Promise<UploadConflictDecision<T> | null>;
}

/**
 * Splits an upload batch against a fresh server directory listing.
 * Directories and documents share the same name namespace on the server.
 */
export function partitionUploadConflicts(
  candidates: UploadCandidate[],
  folders: Pick<ServerDirectoryEntry, 'name'>[],
  documents: Pick<ServerDocumentEntry, 'title'>[],
): UploadConflictPartition {
  const existingNames = new Set([
    ...folders.map((folder) => folder.name),
    ...documents.map((document) => document.title),
  ]);
  const available: UploadCandidate[] = [];
  const conflicting: UploadCandidate[] = [];

  for (const candidate of candidates) {
    (existingNames.has(candidate.name) ? conflicting : available).push(candidate);
  }

  return { available, conflicting };
}

/**
 * Resolves conflicts in Windows-style order: prompt for one item at a time,
 * unless the user explicitly applies the current choice to all remaining items.
 */
export async function resolveUploadConflicts<T extends UploadCandidate>(
  candidates: T[],
  prompt: UploadConflictPrompt<T>,
): Promise<UploadConflictDecision<T>[] | null> {
  const decisions: UploadConflictDecision<T>[] = [];
  const resolver = createUploadConflictResolver(prompt);

  for (const candidate of candidates) {
    const decision = await resolver.resolve(candidate);
    if (!decision) return null;
    decisions.push(decision);
  }

  return decisions;
}

/**
 * Creates a serial conflict resolver for candidates discovered incrementally.
 * Calls are queued so event-based conflict scans never open overlapping dialogs.
 */
export function createUploadConflictResolver<T extends UploadCandidate>(
  prompt: UploadConflictPrompt<T>,
): UploadConflictResolver<T> {
  let cancelled = false;
  let index = 0;
  let remainingAction: UploadConflictAction | null = null;
  let pending = Promise.resolve();

  async function resolveNext(candidate: T): Promise<UploadConflictDecision<T> | null> {
    if (cancelled) return null;
    let action = remainingAction;

    if (!action) {
      const choice = await prompt(candidate, index);
      if (!choice) {
        cancelled = true;
        return null;
      }
      action = choice.action;
      if (choice.applyToRemaining) remainingAction = choice.action;
    }

    index += 1;
    return { candidate, action };
  }

  return {
    get cancelled() {
      return cancelled;
    },
    resolve(candidate) {
      const result = pending.then(() => resolveNext(candidate));
      pending = result.then(() => undefined, () => undefined);
      return result;
    },
  };
}
