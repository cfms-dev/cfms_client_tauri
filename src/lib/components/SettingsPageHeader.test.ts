// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SettingsPageHeader from './SettingsPageHeader.svelte';

const mocks = vi.hoisted(() => ({
  navigateUp: vi.fn(),
}));

vi.mock('$app/state', () => ({
  page: { url: new URL('https://example.test/home/settings/appearance') },
}));
vi.mock('$lib/navigation', () => ({ navigateUp: mocks.navigateUp }));
vi.mock('svelte-i18n', () => ({
  _: {
    subscribe(run: (translate: (key: string) => string) => void) {
      run((key) => key);
      return () => undefined;
    },
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SettingsPageHeader', () => {
  it('renders the page hierarchy and keeps navigation and reset actions operable', async () => {
    const onReset = vi.fn();
    render(SettingsPageHeader, {
      title: 'Appearance',
      description: 'Theme and motion preferences',
      icon: 'appearance',
      onReset,
    });

    expect(screen.getByRole('heading', { level: 1, name: 'Appearance' })).toBeTruthy();
    expect(screen.getByText('Theme and motion preferences')).toBeTruthy();

    await fireEvent.click(screen.getByRole('button', { name: 'common.back' }));
    expect(mocks.navigateUp).toHaveBeenCalledWith('/home/settings/appearance');

    await fireEvent.click(screen.getByRole('button', { name: 'common.reset' }));
    expect(onReset).toHaveBeenCalledOnce();
  });

  it('exposes the disabled reset state without removing the action label', () => {
    render(SettingsPageHeader, {
      title: 'Storage',
      resetDisabled: true,
      onReset: vi.fn(),
    });

    expect((screen.getByRole('button', { name: 'common.reset' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
