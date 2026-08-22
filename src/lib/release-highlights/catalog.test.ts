import { describe, expect, it } from 'vitest';
import { filterReleaseHighlights, findReleaseTour } from './catalog';

describe('release highlight catalog', () => {
  it('matches an installed version with or without a tag prefix', () => {
    expect(findReleaseTour('v0.46.0')?.version).toBe('0.46.0');
    expect(findReleaseTour('0.45.0')?.version).toBe('0.45.0');
    expect(findReleaseTour('0.43.0')).toBeNull();
    expect(findReleaseTour('0.44.0')).toBeNull();
  });

  it('shows the permission workspace only to management accounts', () => {
    const tour = findReleaseTour('0.46.0')!;

    expect(filterReleaseHighlights(tour.highlights, [])).toEqual([]);
    expect(filterReleaseHighlights(tour.highlights, ['set_user_permissions']).map((item) => item.id))
      .toEqual(['permission-rule-workspace']);
  });

  it('keeps common slides and filters privileged slides', () => {
    const tour = findReleaseTour('0.45.0')!;
    expect(filterReleaseHighlights(tour.highlights, []).map((item) => item.id)).toEqual([
      'fullscreen-feature-tour',
      'document-id-download',
      'flexible-workspace',
    ]);
    expect(filterReleaseHighlights(tour.highlights, ['diagnostics']).map((item) => item.id)).toContain('server-diagnostics');
    expect(filterReleaseHighlights(tour.highlights, ['list_users']).map((item) => item.id)).toContain('account-administration');
  });
});
