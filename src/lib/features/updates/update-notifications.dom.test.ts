import { afterEach, describe, expect, it, vi } from 'vitest';
import { updateNotificationReporter } from '$lib/features/updates/update-notifications';
import { floatingProgressStore } from "$lib/shared/notifications/progress.svelte.ts";
import type { UpdateProgressSnapshot } from '$lib/api/updates';

vi.mock('@tauri-apps/plugin-os', () => ({ platform: () => 'windows' }));
vi.mock('$app/environment', () => ({ browser: true }));

const copy = {
  title: 'Updating', preparingDownload: 'Preparing', installing: 'Installing', installed: 'Installed',
  downloadProgress: ({ percent }: { percent: string }) => `${percent}%`,
  downloadedBytes: ({ current }: { current: string }) => current,
};
afterEach(() => { updateNotificationReporter.reset(); floatingProgressStore.clear(); });

describe('floating update progress', () => {
  it.each([
    ['downloading', 20, 100, 100],
    ['downloading', 20, null, 0],
    ['downloading', 0, null, 0],
    ['installing', 100, 100, 0],
  ] as const)('maps %s with %s bytes and total %s to %s', async (phase, downloadedBytes, totalBytes, expectedTotal) => {
    await updateNotificationReporter.report({ phase, downloadedBytes, totalBytes, progress: null }, copy);
    expect(floatingProgressStore.entries[0]).toMatchObject({ current: downloadedBytes, total: expectedTotal });
  });

  it.each(['finished', 'idle'] as const)('removes the toast on %s', async (phase: UpdateProgressSnapshot['phase']) => {
    await updateNotificationReporter.report({ phase: 'downloading', downloadedBytes: 20, totalBytes: 100, progress: 0.2 }, copy);
    await updateNotificationReporter.report({ phase, downloadedBytes: 100, totalBytes: 100, progress: 1 }, copy);
    expect(floatingProgressStore.entries).toHaveLength(0);
  });
});
