import { ATOMIC_OP_BY_NAME } from 'codemirror-lang-cacl';
import { describe, expect, it } from 'vitest';
import {
  canAccessDacl,
  canDeleteRevision,
  canDownloadRevision,
  canPurgeDeletedItem,
  canReadDacl,
  canWriteDacl,
  EFFECTIVE_OP,
  hasAllEffectiveOps,
  hasAnyEffectiveOp,
  hasEffectiveOp,
  requiredMoveDestinationMask,
} from '#lib/features/access/effective-permissions.ts';

describe('effective-permissions', () => {
  it('matches every AtomicOp bit from codemirror-lang-cacl', () => {
    const entries = Object.entries(EFFECTIVE_OP);
    expect(entries).toHaveLength(ATOMIC_OP_BY_NAME.size);
    for (const [name, bit] of entries) {
      const meta = ATOMIC_OP_BY_NAME.get(name);
      expect(meta, `missing AtomicOp ${name}`).toBeDefined();
      expect(meta?.bit).toBe(bit);
    }
  });

  it('treats omitted masks as unconstrained while enforcing numeric masks including 0', () => {
    expect(hasEffectiveOp(undefined, EFFECTIVE_OP.READ_CONTENT)).toBe(true);
    expect(hasEffectiveOp(null, EFFECTIVE_OP.READ_CONTENT)).toBe(true);
    expect(hasAnyEffectiveOp(undefined, EFFECTIVE_OP.READ_DACL | EFFECTIVE_OP.WRITE_DACL)).toBe(true);
    expect(hasAllEffectiveOps(null, EFFECTIVE_OP.CREATE_DOCUMENT | EFFECTIVE_OP.CREATE_DIRECTORY)).toBe(true);

    expect(hasEffectiveOp(0, EFFECTIVE_OP.READ_CONTENT)).toBe(false);
    expect(hasAnyEffectiveOp(0, EFFECTIVE_OP.READ_DACL | EFFECTIVE_OP.WRITE_DACL)).toBe(false);
    expect(hasAllEffectiveOps(0, EFFECTIVE_OP.CREATE_DOCUMENT)).toBe(false);

    const mask = EFFECTIVE_OP.CREATE_DOCUMENT | EFFECTIVE_OP.LIST_DIRECTORY;
    expect(hasEffectiveOp(mask, EFFECTIVE_OP.LIST_DIRECTORY)).toBe(true);
    expect(hasEffectiveOp(mask, EFFECTIVE_OP.CREATE_DIRECTORY)).toBe(false);
    expect(hasAnyEffectiveOp(mask, EFFECTIVE_OP.CREATE_DOCUMENT | EFFECTIVE_OP.CREATE_DIRECTORY)).toBe(true);
    expect(hasAllEffectiveOps(mask, EFFECTIVE_OP.CREATE_DOCUMENT | EFFECTIVE_OP.CREATE_DIRECTORY)).toBe(false);
    expect(hasAllEffectiveOps(mask, EFFECTIVE_OP.CREATE_DOCUMENT | EFFECTIVE_OP.LIST_DIRECTORY)).toBe(true);
  });

  it('evaluates DACL, revision, purge, and move destination helpers', () => {
    expect(canReadDacl(EFFECTIVE_OP.READ_DACL)).toBe(true);
    expect(canWriteDacl(EFFECTIVE_OP.READ_DACL)).toBe(false);
    expect(canAccessDacl(EFFECTIVE_OP.READ_DACL)).toBe(true);
    expect(canAccessDacl(EFFECTIVE_OP.WRITE_DACL)).toBe(true);
    expect(canAccessDacl(EFFECTIVE_OP.READ_METADATA)).toBe(false);

    expect(canDownloadRevision(EFFECTIVE_OP.READ_CONTENT, true)).toBe(true);
    expect(canDownloadRevision(EFFECTIVE_OP.READ_CONTENT, false)).toBe(false);
    expect(canDownloadRevision(EFFECTIVE_OP.READ_REVISION, false)).toBe(true);
    expect(canDownloadRevision(EFFECTIVE_OP.READ_REVISION, true)).toBe(false);

    expect(canDeleteRevision(EFFECTIVE_OP.DELETE_REVISION, [])).toBe(true);
    expect(canDeleteRevision(0, ['delete_revision'])).toBe(false);
    expect(canDeleteRevision(undefined, ['delete_revision'])).toBe(true);
    expect(canDeleteRevision(undefined, [])).toBe(false);

    expect(canPurgeDeletedItem(EFFECTIVE_OP.PURGE, [])).toBe(true);
    expect(canPurgeDeletedItem(0, ['purge'])).toBe(false);
    expect(canPurgeDeletedItem(undefined, ['purge'])).toBe(true);
    expect(canPurgeDeletedItem(undefined, [])).toBe(false);

    expect(requiredMoveDestinationMask(false, false)).toBe(0);
    expect(requiredMoveDestinationMask(true, false)).toBe(EFFECTIVE_OP.CREATE_DIRECTORY);
    expect(requiredMoveDestinationMask(false, true)).toBe(EFFECTIVE_OP.CREATE_DOCUMENT);
    expect(requiredMoveDestinationMask(true, true)).toBe(
      EFFECTIVE_OP.CREATE_DIRECTORY | EFFECTIVE_OP.CREATE_DOCUMENT,
    );
  });
});
