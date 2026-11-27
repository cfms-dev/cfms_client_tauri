// @vitest-environment jsdom

import '#lib/shared/i18n.ts';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { locale } from 'svelte-i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MoveTargetDialog from '#lib/features/files/MoveTargetDialog.svelte';
import { EFFECTIVE_OP } from '#lib/features/access/effective-permissions.ts';
import { stubInstantAnimations } from '../../../test/dom-fixtures';

const mocks = vi.hoisted(() => ({
  listDirectory: vi.fn(),
}));

vi.mock('#lib/api.ts', async (original) => ({
  ...(await original<typeof import('#lib/api.ts')>()),
  listDirectory: mocks.listDirectory,
}));

beforeEach(() => {
  stubInstantAnimations();
  locale.set('en');
  mocks.listDirectory.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('MoveTargetDialog effective_mask permissions', () => {
  it('hides subfolders lacking LIST_DIRECTORY and disables Move here without CREATE_DOCUMENT/CREATE_DIRECTORY', async () => {
    mocks.listDirectory
      .mockResolvedValueOnce({
        folders: [
          {
            id: 'dir-listable',
            name: 'Listable',
            created_time: null,
            effective_mask: EFFECTIVE_OP.LIST_DIRECTORY | EFFECTIVE_OP.CREATE_DOCUMENT,
          },
          {
            id: 'dir-hidden',
            name: 'Unlistable',
            created_time: null,
            effective_mask: EFFECTIVE_OP.TRAVERSE,
          },
        ],
        documents: [],
        parent_id: null,
        effective_mask: EFFECTIVE_OP.LIST_DIRECTORY,
      })
      .mockResolvedValueOnce({
        folders: [],
        documents: [],
        parent_id: 'root',
        effective_mask: EFFECTIVE_OP.LIST_DIRECTORY | EFFECTIVE_OP.CREATE_DOCUMENT,
      });

    render(MoveTargetDialog, {
      props: {
        objectType: 'document',
        objectName: 'Report.pdf',
        initialFolderId: null,
        originalParentId: 'other-parent',
        onMove: vi.fn(),
        onCancel: vi.fn(),
      },
    });

    await vi.waitFor(() => expect(screen.getByText('Listable')).toBeTruthy());
    expect(screen.queryByText('Unlistable')).toBeNull();

    const moveHere = screen.getByRole('button', { name: 'Move Here' }) as HTMLButtonElement;
    expect(moveHere.disabled).toBe(true);

    await fireEvent.click(screen.getByRole('button', { name: 'Listable' }));
    await vi.waitFor(() => expect(mocks.listDirectory).toHaveBeenCalledWith('dir-listable'));
    expect(moveHere.disabled).toBe(false);
  });

  it('requires requiredDestinationMask bits when moving mixed batches', async () => {
    mocks.listDirectory.mockResolvedValueOnce({
      folders: [],
      documents: [],
      parent_id: null,
      effective_mask: EFFECTIVE_OP.LIST_DIRECTORY | EFFECTIVE_OP.CREATE_DOCUMENT,
    });

    render(MoveTargetDialog, {
      props: {
        objectType: 'directory',
        objectName: '2 items',
        initialFolderId: null,
        originalParentId: 'other-parent',
        requiredDestinationMask: EFFECTIVE_OP.CREATE_DOCUMENT | EFFECTIVE_OP.CREATE_DIRECTORY,
        onMove: vi.fn(),
        onCancel: vi.fn(),
      },
    });

    await vi.waitFor(() => expect(mocks.listDirectory).toHaveBeenCalledOnce());
    const moveHere = screen.getByRole('button', { name: 'Move Here' }) as HTMLButtonElement;
    expect(moveHere.disabled).toBe(true);
  });
});
