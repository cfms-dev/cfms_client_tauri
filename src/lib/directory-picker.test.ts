import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  platform: vi.fn(),
  selectUploadDirectory: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: mocks.open }));
vi.mock('@tauri-apps/plugin-os', () => ({ platform: mocks.platform }));
vi.mock('$lib/api', () => ({
  selectUploadDirectory: mocks.selectUploadDirectory,
}));

import { pickDirectory } from './directory-picker';

describe('pickDirectory', () => {
  beforeEach(() => {
    mocks.open.mockReset();
    mocks.platform.mockReset();
    mocks.selectUploadDirectory.mockReset();
  });

  it('uses the native SAF picker directly on Android', async () => {
    mocks.platform.mockReturnValue('android');
    mocks.selectUploadDirectory.mockResolvedValue({
      uri: 'content://com.android.externalstorage.documents/tree/primary%3ADownload',
      name: 'Download',
    });

    await expect(pickDirectory({ title: 'Choose folder' })).resolves.toEqual({
      path: 'content://com.android.externalstorage.documents/tree/primary%3ADownload',
      name: 'Download',
    });
    expect(mocks.selectUploadDirectory).toHaveBeenCalledOnce();
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it('uses the Tauri directory dialog on desktop', async () => {
    mocks.platform.mockReturnValue('windows');
    mocks.open.mockResolvedValue('D:\\Downloads');

    await expect(pickDirectory({
      title: 'Choose folder',
      defaultPath: 'D:\\Current',
    })).resolves.toEqual({
      path: 'D:\\Downloads',
      name: 'Downloads',
    });
    expect(mocks.open).toHaveBeenCalledWith({
      directory: true,
      multiple: false,
      title: 'Choose folder',
      defaultPath: 'D:\\Current',
    });
    expect(mocks.selectUploadDirectory).not.toHaveBeenCalled();
  });

  it('treats Android picker cancellation as no selection', async () => {
    mocks.platform.mockReturnValue('android');
    mocks.selectUploadDirectory.mockRejectedValue(new Error('Folder picker cancelled'));

    await expect(pickDirectory()).resolves.toBeNull();
  });
});
