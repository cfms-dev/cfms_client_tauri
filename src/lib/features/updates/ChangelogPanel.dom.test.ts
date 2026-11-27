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

  it('renders category groups as structured h4 headings with semantic categories', () => {
    const { container } = render(ChangelogPanel);

    const groupHeadings = [...container.querySelectorAll<HTMLElement>('.group-heading')];
    expect(groupHeadings.length).toBeGreaterThan(0);
    expect(groupHeadings.every((heading) => heading.tagName === 'H4')).toBe(true);
    expect(groupHeadings.some((heading) => heading.dataset.category === 'added')).toBe(true);
    expect(container.querySelector('.markdown-view h3')).toBeNull();
  });

  it('renders release warning leads in a warning notice alongside category groups when expanded', async () => {
    const { container } = render(ChangelogPanel);

    await fireEvent.click(screen.getByRole('button', { name: 'Show all' }));

    const warningLead = container.querySelector('.entry-lead--warning');
    expect(warningLead).toBeTruthy();
    expect(warningLead?.textContent).toContain('WARNING:');
    const warningEntry = warningLead?.closest('.changelog-entry');
    expect(warningEntry?.querySelector('.version')?.textContent).toBe('v0.53.0');
    expect(warningEntry?.querySelectorAll('.group-heading').length).toBeGreaterThan(0);
  });
});
