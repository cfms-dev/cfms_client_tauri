/**
 * Protocol 32 CEP-0002 effective permission bitmask constants and capability helpers.
 *
 * Bit offsets match `cacl_compiler.AtomicOp` (`0`..`20`).
 */
export const EFFECTIVE_OP = {
  TRAVERSE: 0x000001,
  LIST_DIRECTORY: 0x000002,
  CREATE_DOCUMENT: 0x000004,
  CREATE_DIRECTORY: 0x000008,
  READ_CONTENT: 0x000010,
  WRITE_CONTENT: 0x000020,
  LIST_REVISIONS: 0x000040,
  READ_REVISION: 0x000080,
  SET_CURRENT_REVISION: 0x000100,
  DELETE_REVISION: 0x000200,
  READ_METADATA: 0x000400,
  WRITE_METADATA: 0x000800,
  RENAME: 0x001000,
  REPARENT: 0x002000,
  DELETE: 0x004000,
  DIRECTORY_DELETE_CHILD: 0x008000,
  LIST_DELETED: 0x010000,
  RESTORE: 0x020000,
  PURGE: 0x040000,
  READ_DACL: 0x080000,
  WRITE_DACL: 0x100000,
} as const;

export function hasEffectiveOp(mask: number | null | undefined, op: number): boolean {
  if (typeof mask !== 'number') return true;
  return (mask & op) === op;
}

export function hasAnyEffectiveOp(mask: number | null | undefined, ops: number): boolean {
  if (typeof mask !== 'number') return true;
  return (mask & ops) !== 0;
}

export function hasAllEffectiveOps(mask: number | null | undefined, ops: number): boolean {
  if (typeof mask !== 'number') return true;
  return (mask & ops) === ops;
}

export function canReadDacl(mask: number | null | undefined): boolean {
  return hasEffectiveOp(mask, EFFECTIVE_OP.READ_DACL);
}

export function canWriteDacl(mask: number | null | undefined): boolean {
  return hasEffectiveOp(mask, EFFECTIVE_OP.WRITE_DACL);
}

export function canAccessDacl(mask: number | null | undefined): boolean {
  return hasAnyEffectiveOp(mask, EFFECTIVE_OP.READ_DACL | EFFECTIVE_OP.WRITE_DACL);
}

export function canDownloadRevision(
  mask: number | null | undefined,
  isCurrent: boolean,
): boolean {
  return hasEffectiveOp(
    mask,
    isCurrent ? EFFECTIVE_OP.READ_CONTENT : EFFECTIVE_OP.READ_REVISION,
  );
}

export function canDeleteRevision(
  mask: number | null | undefined,
  globalPermissions: readonly string[],
): boolean {
  if (typeof mask === 'number') {
    return (mask & EFFECTIVE_OP.DELETE_REVISION) !== 0;
  }
  return globalPermissions.includes('delete_revision');
}

export function canPurgeDeletedItem(
  mask: number | null | undefined,
  globalPermissions: readonly string[],
): boolean {
  if (typeof mask === 'number') {
    return (mask & EFFECTIVE_OP.PURGE) !== 0;
  }
  return globalPermissions.includes('purge');
}

export function requiredMoveDestinationMask(
  hasFolders: boolean,
  hasDocuments: boolean,
): number {
  return (
    (hasFolders ? EFFECTIVE_OP.CREATE_DIRECTORY : 0)
    | (hasDocuments ? EFFECTIVE_OP.CREATE_DOCUMENT : 0)
  );
}
