// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { locale } from 'svelte-i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '$lib/shared/i18n';
import GithubApiSettingsPage from '$lib/app/settings/GithubApiSettingsPage.svelte';

const mocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
  resetNotice: vi.fn(),
  openUrl: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock('$lib/api', () => ({
  getGithubAuthStatus: mocks.getStatus,
  saveGithubToken: mocks.save,
  deleteGithubToken: mocks.remove,
}));
vi.mock('$lib/features/updates/github-auth-notices', () => ({ resetGithubAuthNotice: mocks.resetNotice }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: mocks.openUrl }));
vi.mock('$lib/shared/notifications/notifications.svelte', () => ({
  notificationStore: { success: mocks.success, error: mocks.error }
}));
vi.mock('$app/state', () => ({
  page: { url: new URL('https://example.test/home/settings/github-api') },
}));
vi.mock('$lib/app/navigation', () => ({ navigateUp: vi.fn() }));

beforeEach(() => {
  locale.set('en');
  mocks.getStatus.mockResolvedValue({ mode: 'none' });
  mocks.save.mockResolvedValue(undefined);
  mocks.remove.mockResolvedValue(undefined);
  mocks.openUrl.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('GitHub API settings', () => {
  it('keeps the token masked, saves explicitly, and clears it from the form', async () => {
    render(GithubApiSettingsPage);

    const input = await screen.findByLabelText('GitHub token') as HTMLInputElement;
    expect(input.type).toBe('password');
    await waitFor(() => expect(input.disabled).toBe(false));
    await fireEvent.input(input, { target: { value: '  github_pat_example  ' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save token' }));

    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith('github_pat_example'));
    expect(input.value).toBe('');
    expect(screen.queryByText('github_pat_example')).toBeNull();
    expect(screen.getByText('Token configured')).toBeTruthy();
    expect(mocks.resetNotice).toHaveBeenCalledOnce();
  });

  it('submits through the native form and keeps failures free of token details', async () => {
    mocks.save.mockRejectedValue(new Error('secret github_pat_example was rejected by storage'));
    render(GithubApiSettingsPage);

    const input = await screen.findByLabelText('GitHub token') as HTMLInputElement;
    await waitFor(() => expect(input.disabled).toBe(false));
    await fireEvent.input(input, { target: { value: 'github_pat_example' } });
    await fireEvent.submit(input.closest('form')!);

    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
    expect(mocks.error).toHaveBeenCalledWith('The GitHub token could not be saved. Check secure credential storage and try again.');
    expect(mocks.error.mock.calls.flat().join(' ')).not.toContain('github_pat_example');
    expect(input.value).toBe('github_pat_example');
  });

  it('offers replacement and removal for a rejected token', async () => {
    mocks.getStatus.mockResolvedValue({ mode: 'needs_attention' });
    render(GithubApiSettingsPage);

    expect(await screen.findByText('Token needs attention')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Replace token' })).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Remove token' }));

    await waitFor(() => expect(mocks.remove).toHaveBeenCalledOnce());
    expect(screen.getByText('No token configured')).toBeTruthy();
    expect(mocks.resetNotice).toHaveBeenCalledOnce();
  });

  it('shows an unavailable store and allows a status retry', async () => {
    mocks.getStatus.mockResolvedValueOnce({ mode: 'unavailable' }).mockResolvedValueOnce({ mode: 'none' });
    render(GithubApiSettingsPage);

    expect(await screen.findByText('Secure storage unavailable')).toBeTruthy();
    expect((screen.getByLabelText('GitHub token') as HTMLInputElement).disabled).toBe(true);
    await fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(mocks.getStatus).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('No token configured')).toBeTruthy();
  });

  it('links to official GitHub token and rate-limit documentation', async () => {
    render(GithubApiSettingsPage);

    const tokenLink = await screen.findByRole('link', { name: /Create a fine-grained token on GitHub/ });
    const limitsLink = screen.getByRole('link', { name: /GitHub rate limit documentation/ });
    expect(tokenLink.getAttribute('href')).toContain('docs.github.com/en/authentication/');
    expect(limitsLink.getAttribute('href')).toContain('docs.github.com/en/rest/');
    await fireEvent.click(tokenLink);
    expect(mocks.openUrl).toHaveBeenCalledWith(tokenLink.getAttribute('href'));
  });

  it('renders the status and instructions in Simplified Chinese', async () => {
    locale.set('zh-CN');
    render(GithubApiSettingsPage);

    expect(await screen.findByText('尚未配置 token')).toBeTruthy();
    expect(screen.getByText(/匿名请求每小时 60 次/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '保存 token' })).toBeTruthy();
  });
});
