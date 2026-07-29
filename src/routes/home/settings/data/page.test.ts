// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LocalDataSettingsPage from './+page.svelte';

vi.mock('$app/state', () => ({
  page: { url: new URL('https://example.test/home/settings/data') },
}));

vi.mock('$lib/navigation', () => ({ navigateUp: vi.fn() }));

vi.mock('$lib/motion/transitions', () => ({
  flyScale: () => ({ duration: 0 }),
}));

vi.mock('svelte-i18n', () => ({
  _: {
    subscribe(run: (translate: (key: string) => string) => void) {
      run((key) => key);
      return () => undefined;
    },
  },
}));

afterEach(cleanup);

describe('local data settings page', () => {
  it('uses the requested icons for the page, card, and reset action', () => {
    render(LocalDataSettingsPage);

    const pageHeading = screen.getByRole('heading', {
      level: 1,
      name: 'settings.localData.title',
    });
    expect(pageHeading.parentElement?.parentElement?.querySelector('[data-icon="backup"]')).toBeTruthy();

    const cardHeading = screen.getByRole('heading', {
      level: 2,
      name: 'settings.localData.cardTitle',
    });
    expect(cardHeading.parentElement?.querySelector('[data-icon]')).toBeNull();

    const resetButton = screen.getByRole('button', {
      name: 'settings.localData.openAction',
    });
    expect(resetButton.querySelector('[data-icon="restartAlt"]')).toBeTruthy();
  });
});
