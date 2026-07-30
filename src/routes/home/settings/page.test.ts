// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authStore } from '$lib/stores.svelte';
import SettingsOverviewPage from './+page.svelte';

const mocks = vi.hoisted(() => ({ goto: vi.fn() }));

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$lib/platform', () => ({ isMobilePlatform: () => false }));
vi.mock('svelte-i18n', () => ({
  _: {
    subscribe(run: (translate: (key: string) => string) => void) {
      run((key) => key);
      return () => undefined;
    },
  },
}));

beforeEach(() => {
  authStore.clear();
  authStore.apply({
    username: 'alice',
    nickname: 'Alice',
    has_token: true,
    token_exp: 1_900_000_000,
    permissions: [],
    groups: [],
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  authStore.clear();
});

describe('settings overview', () => {
  it('renders semantic navigation entries and opens the selected settings page', async () => {
    render(SettingsOverviewPage);

    expect(screen.getByRole('heading', { level: 1, name: 'settings.title' })).toBeTruthy();
    const accountEntry = screen.getByRole('button', { name: /settings\.account\.title/ });
    expect(accountEntry).toBeTruthy();

    await fireEvent.click(accountEntry);
    expect(mocks.goto).toHaveBeenCalledWith('/home/settings/account');
  });
});
