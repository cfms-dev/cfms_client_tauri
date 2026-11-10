// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { locale } from 'svelte-i18n';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import '$lib/shared/i18n';
import { changelogEntries } from '$lib/features/updates/changelog';
import ChangelogPanel from '$lib/features/updates/ChangelogPanel.svelte';

beforeEach(() => {
  locale.set('en');
});

afterEach(cleanup);

describe('ChangelogPanel', () => {
  it('shows only the latest entry by default', () => {
    const { container } = render(ChangelogPanel);

    expect(container.querySelectorAll('.changelog-entry')).toHaveLength(1);
    expect(container.querySelector('.version')?.textContent).toBe(changelogEntries[0]?.version);
  });

  it('expands and collapses the complete changelog with synchronized ARIA state', async () => {
    const { container } = render(ChangelogPanel);
    const toggle = screen.getByRole('button', { name: 'Show all' });

    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-controls')).toBe('changelog-entries');

    await fireEvent.click(toggle);
    expect(container.querySelectorAll('.changelog-entry')).toHaveLength(changelogEntries.length);
    expect(screen.getByRole('button', { name: 'Show less' }).getAttribute('aria-expanded')).toBe('true');

    await fireEvent.click(screen.getByRole('button', { name: 'Show less' }));
    expect(container.querySelectorAll('.changelog-entry')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Show all' }).getAttribute('aria-expanded')).toBe('false');
  });
});
