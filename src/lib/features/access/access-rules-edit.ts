import { caclDraftFingerprint } from '#lib/features/access/cacl-model.ts';
import { batchRulesTargetKey, type BatchRulesTarget } from '#lib/features/access/batch-access-rules.ts';

/** Ignore whitespace and `# @username` comment annotations when checking unsaved DACL changes. */
export function accessRulesDraftFingerprint(dacl: string): string {
  return caclDraftFingerprint(dacl);
}

/** Explorer uses folder: keys; the DACL API uses directory: keys. */
export function accessRulesTemplateKey(
  targets: BatchRulesTarget[],
  focusedItemKey: string | null,
  contextItemKey: string | null = null,
): string {
  for (const itemKey of [contextItemKey, focusedItemKey]) {
    const key = itemKey?.replace(/^folder:/, 'directory:');
    const target = targets.find((target) => batchRulesTargetKey(target) === key);
    if (target) return batchRulesTargetKey(target);
  }
  return batchRulesTargetKey(targets[0]);
}
