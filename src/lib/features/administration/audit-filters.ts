import { normalizeFilterOptions } from '$lib/shared/ui/multi-select-filter';

export interface AuditActionFilters {
  include: string[];
  exclude: string[];
}

export const DEFAULT_AUDIT_EXCLUSIONS: readonly string[] = [
  'core.audit.entry.list',
  'core.setting.get',
];

export function defaultAuditFilters(): AuditActionFilters {
  return { include: [], exclude: [...DEFAULT_AUDIT_EXCLUSIONS] };
}

export { normalizeFilterOptions as normalizeAuditActions };

export function normalizeAuditFilters(filters: AuditActionFilters): AuditActionFilters {
  const exclude = normalizeFilterOptions(filters.exclude);
  return {
    include: normalizeFilterOptions(filters.include).filter((action) => !exclude.includes(action)),
    exclude,
  };
}

export function selectAuditAction(
  filters: AuditActionFilters,
  side: keyof AuditActionFilters,
  action: string,
): AuditActionFilters {
  const other = side === 'include' ? 'exclude' : 'include';
  const value = action.trim();
  if (!value) return filters;
  return normalizeAuditFilters({
    ...filters,
    [side]: [...filters[side], value],
    [other]: filters[other].filter((candidate) => candidate !== value),
  });
}
