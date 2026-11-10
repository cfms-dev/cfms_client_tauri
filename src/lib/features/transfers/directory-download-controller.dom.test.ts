import { describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { startDirectoryDownload } from './directory-download-controller';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
describe('native directory download submission', () => {
  it('submits the selection once and leaves discovery and task production to Rust', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ batchId: 'native' });
    const selection = [{ id: 'folder', name: 'a:b', kind: 'directory' as const }];
    await expect(startDirectoryDownload(selection, 'Documents', null)).resolves.toEqual({ batchId: 'native' });
    expect(invoke).toHaveBeenCalledExactlyOnceWith('start_download_batch', { selection, name: 'Documents', rootId: null });
  });
});
