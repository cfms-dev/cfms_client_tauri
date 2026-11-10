// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SettingsPageHeader from '$lib/shared/ui/SettingsPageHeader.svelte';

const mocks = vi.hoisted(() => ({
  navigateUp: vi.fn(),
}));

vi.mock('$app/state', () => ({
  page: { url: new URL('https://example.test/home/settings/appearance') },
}));
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
      onBack: () => mocks.navigateUp('/home/settings/appearance'),
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

  it('groups the title and description beside the icon and keeps refresh and reset independent', async () => {
    const onRefresh = vi.fn();
    const onReset = vi.fn();
    render(SettingsPageHeader, { title: 'Authentication', description: 'Manage methods', icon: 'passkey', onRefresh, onReset });

    const refresh = screen.getByRole('button', { name: 'common.refresh' });
    const row = screen.getByRole('heading', { name: 'Authentication' }).closest('.settings-heading-row')!;
    expect(row.contains(refresh)).toBe(true);
    const copy = screen.getByRole('heading', { name: 'Authentication' }).parentElement!;
    expect(copy.contains(screen.getByText('Manage methods'))).toBe(true);
    expect(copy.parentElement?.querySelector('.settings-heading-icon')).toBeTruthy();
    expect(copy.contains(refresh)).toBe(false);
    expect(refresh.hasAttribute('icon-only')).toBe(true);
    expect(refresh.querySelector('[data-icon="refresh"]')).toBeTruthy();
    await fireEvent.click(refresh);
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(onReset).not.toHaveBeenCalled();
  });

  it('disables refresh while its status is loading', async () => {
    const onRefresh = vi.fn();
    render(SettingsPageHeader, { title: 'Authentication', onRefresh, refreshDisabled: true });
    const refresh = screen.getByRole('button', { name: 'common.refresh' });
    expect((refresh as HTMLButtonElement).disabled).toBe(true);
    await fireEvent.click(refresh);
    expect(onRefresh).not.toHaveBeenCalled();
  });
});
