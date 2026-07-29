// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ResetRecoveryPage from './+page.svelte';

const mocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
  retry: vi.fn(),
  quit: vi.fn(),
  goto: vi.fn(),
}));

vi.mock('$lib/api', () => ({
  getLocalDataResetStatus: mocks.getStatus,
  retryLocalDataReset: mocks.retry,
  quitApplication: mocks.quit,
}));

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));

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

describe('local data reset recovery page', () => {
  it('shows cleanup failures and supports retry or exit', async () => {
    const pending = {
      pending: true,
      failures: [{ target: 'app-logs', message: 'permission denied' }],
    };
    mocks.getStatus.mockResolvedValue(pending);
    mocks.retry.mockResolvedValue(pending);
    mocks.quit.mockResolvedValue(undefined);

    render(ResetRecoveryPage);

    expect(await screen.findByText('app-logs')).toBeTruthy();
    expect(screen.getByText('permission denied')).toBeTruthy();

    await fireEvent.click(screen.getByRole('button', {
      name: 'settings.localData.retryAction',
    }));
    await waitFor(() => expect(mocks.retry).toHaveBeenCalledOnce());

    await fireEvent.click(screen.getByRole('button', {
      name: 'settings.localData.exitAction',
    }));
    expect(mocks.quit).toHaveBeenCalledOnce();
  });
});
