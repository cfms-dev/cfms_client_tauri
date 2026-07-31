// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserPreference } from '$lib/api';
import TaskSettingsPage from './+page.svelte';

const mocks = vi.hoisted(() => ({
  loadUserPreference: vi.fn(),
  saveUserPreference: vi.fn(),
  configureConcurrency: vi.fn(),
  notifyError: vi.fn(),
}));

vi.mock('$lib/api', () => ({
  loadUserPreference: mocks.loadUserPreference,
  saveUserPreference: mocks.saveUserPreference,
}));
vi.mock('$lib/stores.svelte', () => ({
  uploadStore: { configureConcurrency: mocks.configureConcurrency },
  notificationStore: { error: mocks.notifyError },
}));
vi.mock('svelte-i18n', () => ({
  _: {
    subscribe(run: (translate: (key: string) => string) => void) {
      run((key) => key);
      return () => undefined;
    },
  },
}));

const preference: UserPreference = {
  appearance: { color_scheme: 'system', reduce_motion: 'system' },
  favourites: { files: {}, directories: {} },
  recent_visits: [],
  record_recent_visits: false,
  use_external_storage: false,
  external_storage_path: '',
  privacy: { version: 1, screenshot_protection_enabled: true },
  task_concurrency: { max_downloads: 3, max_uploads: 4 },
  transfer: { max_download_chunk_size: 32 * 1024 },
};

beforeEach(() => {
  mocks.loadUserPreference.mockResolvedValue(structuredClone(preference));
  mocks.saveUserPreference.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('task settings', () => {
  async function findLoadedChunkSelect() {
    const chunkSelect = await screen.findByRole('combobox', {
      name: 'settings.tasks.maxDownloadChunkSize',
    });
    await waitFor(() => {
      expect((chunkSelect as HTMLSelectElement).value).toBe(String(32 * 1024));
    });
    return chunkSelect;
  }

  it('loads all chunk presets and exposes the reliability hint', async () => {
    render(TaskSettingsPage);

    const chunkSelect = await findLoadedChunkSelect();
    expect(mocks.loadUserPreference).toHaveBeenCalledTimes(1);
    expect(chunkSelect.querySelectorAll('option')).toHaveLength(8);
    expect(chunkSelect.getAttribute('aria-describedby')).toBe('download-chunk-size-hint');
    expect(screen.getByText('settings.tasks.maxDownloadChunkSizeHint')).toBeTruthy();
  });

  it('autosaves the selected chunk size with the existing concurrency values', async () => {
    render(TaskSettingsPage);
    const chunkSelect = await findLoadedChunkSelect();

    await fireEvent.change(chunkSelect, { target: { value: String(64 * 1024) } });

    await waitFor(() => {
      expect(mocks.saveUserPreference).toHaveBeenCalledWith(
        expect.objectContaining({
          task_concurrency: { max_downloads: 3, max_uploads: 4 },
          transfer: { max_download_chunk_size: 64 * 1024 },
        }),
      );
    });
  });

  it('resets chunk size and concurrency to their defaults', async () => {
    render(TaskSettingsPage);
    await findLoadedChunkSelect();

    await fireEvent.click(screen.getByRole('button', { name: 'common.reset' }));

    await waitFor(() => {
      expect(mocks.saveUserPreference).toHaveBeenCalledWith(
        expect.objectContaining({
          task_concurrency: { max_downloads: 3, max_uploads: 3 },
          transfer: { max_download_chunk_size: 64 * 1024 },
        }),
      );
    });
  });
});
