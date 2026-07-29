// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DisclaimerPage from './+page.svelte';

const mocks = vi.hoisted(() => ({
  quit: vi.fn(),
  goto: vi.fn(),
  accept: vi.fn(),
}));

vi.mock('$lib/api', () => ({ quitApplication: mocks.quit }));
vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$lib/platform', () => ({ isMobilePlatform: () => false }));
vi.mock('$lib/stores.svelte', () => ({
  disclaimerStore: { accept: mocks.accept },
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

describe('disclaimer page', () => {
  it('uses the native application exit command when the disclaimer is rejected', async () => {
    mocks.quit.mockResolvedValue(undefined);

    render(DisclaimerPage);
    await fireEvent.click(screen.getByRole('button', { name: 'disclaimer.rejectAndQuit' }));

    await waitFor(() => expect(mocks.quit).toHaveBeenCalledOnce());
  });
});
