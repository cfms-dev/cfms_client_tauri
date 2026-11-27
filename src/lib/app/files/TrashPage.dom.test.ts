// @vitest-environment jsdom

import '#lib/shared/i18n.ts';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { locale } from 'svelte-i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TrashPage from '#lib/app/files/TrashPage.svelte';
import { authStore } from '#lib/features/authentication/auth-state.svelte.ts';
import { EFFECTIVE_OP } from '#lib/features/access/effective-permissions.ts';
import { stubInstantAnimations } from '../../../test/dom-fixtures';

const mocks = vi.hoisted(() => ({
  listDeletedItems: vi.fn(),
  restoreDocument: vi.fn(),
  restoreDirectory: vi.fn(),
  purgeDocument: vi.fn(),
  purgeDirectory: vi.fn(),
}));

vi.mock('$app/state', () => ({ page: { url: new URL('https://example.test/home/trash') } }));
vi.mock('#lib/api.ts', async (original) => ({
  ...(await original<typeof import('#lib/api.ts')>()),
  listDeletedItems: mocks.listDeletedItems,
  restoreDocument: mocks.restoreDocument,
  restoreDirectory: mocks.restoreDirectory,
  purgeDocument: mocks.purgeDocument,
  purgeDirectory: mocks.purgeDirectory,
}));

beforeEach(() => {
  stubInstantAnimations();
  locale.set('en');
  authStore.apply({
    user_id: 'self',
    username: 'alice',
    nickname: 'Alice',
    has_token: true,
    token_exp: 1_900_000_000,
    permissions: ['purge'],
    groups: [],
  });
  mocks.listDeletedItems.mockReset();
  mocks.restoreDocument.mockReset();
  mocks.restoreDirectory.mockReset();
  mocks.purgeDocument.mockReset();
  mocks.purgeDirectory.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  authStore.clear();
});

describe('TrashPage effective_mask capabilities', () => {
  it('hides restore and purge actions per item and for batch selection based on effective_mask', async () => {
    mocks.listDeletedItems.mockResolvedValueOnce({
      folders: [
        { id: 'dir-restore-only', name: 'RestoreOnlyDir', created_time: 1, effective_mask: EFFECTIVE_OP.RESTORE },
      ],
      documents: [
        { id: 'doc-purge-only', title: 'PurgeOnly.txt', created_time: 2, effective_mask: EFFECTIVE_OP.PURGE },
        { id: 'doc-none', title: 'ReadOnly.txt', created_time: 3, effective_mask: 0 },
      ],
      parent_id: '/',
      effective_mask: EFFECTIVE_OP.LIST_DELETED,
    });

    render(TrashPage);
    await vi.waitFor(() => expect(screen.getByText('RestoreOnlyDir')).toBeTruthy());

    expect(screen.getAllByRole('button', { name: 'Restore' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Permanently delete' })).toHaveLength(1);

    await fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    await tick();

    expect(screen.getByRole('button', { name: 'Restore selected' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Permanently delete selected' })).toBeTruthy();

    await fireEvent.click(screen.getByRole('button', { name: 'Select RestoreOnlyDir' }));
    await tick();
    expect(screen.getByRole('button', { name: 'Restore selected' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Permanently delete selected' })).toBeNull();

    await fireEvent.click(screen.getByRole('button', { name: 'Select PurgeOnly.txt' }));
    await tick();
    expect(screen.queryByRole('button', { name: 'Restore selected' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Permanently delete selected' })).toBeNull();
  });

  it('hides selection mode when no deleted items can be restored or purged', async () => {
    mocks.listDeletedItems.mockResolvedValueOnce({
      folders: [],
      documents: [
        { id: 'doc-none', title: 'Locked.txt', created_time: 1, effective_mask: 0 },
      ],
      parent_id: '/',
      effective_mask: EFFECTIVE_OP.LIST_DELETED,
    });

    render(TrashPage);
    await vi.waitFor(() => expect(screen.getByText('Locked.txt')).toBeTruthy());

    expect(screen.queryByRole('button', { name: 'Select' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Restore' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Permanently delete' })).toBeNull();
  });
});
