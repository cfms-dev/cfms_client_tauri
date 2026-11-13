import { describe, expect, it } from 'vitest';
import { defaultAuditFilters, normalizeAuditFilters, selectAuditAction } from './audit-filters';

describe('audit action filters', () => {
  it('creates independent defaults and distinguishes clearing from restoring', () => {
    const filters = defaultAuditFilters();
    expect(filters).toEqual({ include: [], exclude: ['core.audit.entry.list', 'core.setting.get'] });
    filters.exclude.pop();
    expect(defaultAuditFilters().exclude).toHaveLength(2);
    expect(normalizeAuditFilters({ include: [], exclude: [] })).toEqual({ include: [], exclude: [] });
  });

  it('normalizes exact values and gives exclusions precedence', () => {
    expect(normalizeAuditFilters({ include: [' login ', 'login', '', 'extension.Custom', 'core.setting.get'], exclude: [' core.setting.get ', 'core.setting.get'] }))
      .toEqual({ include: ['extension.Custom', 'login'], exclude: ['core.setting.get'] });
  });

  it('moves explicit selections to either list without restoring defaults', () => {
    const included = selectAuditAction(defaultAuditFilters(), 'include', ' core.setting.get ');
    expect(included).toEqual({ include: ['core.setting.get'], exclude: ['core.audit.entry.list'] });
    expect(selectAuditAction(included, 'exclude', 'core.setting.get')).toEqual(defaultAuditFilters());
    expect(selectAuditAction({ include: [], exclude: [] }, 'include', 'extension.Custom'))
      .toEqual({ include: ['extension.Custom'], exclude: [] });
  });
});
