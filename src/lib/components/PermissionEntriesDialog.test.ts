// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseLocalDateTimeInput } from '$lib/permission-entries';
import PermissionEntriesDialog from './PermissionEntriesDialog.svelte';

const { confirmMock } = vi.hoisted(() => ({
  confirmMock: vi.fn().mockResolvedValue(true),
}));

vi.mock('$lib/dialogs.svelte', () => ({
  dialogStore: { confirm: confirmMock },
}));

vi.mock('svelte-i18n', () => ({
  _: {
    subscribe(run: (translate: (key: string) => string) => void) {
      run((key) => key);
      return () => undefined;
    },
  },
}));

vi.mock('$lib/motion/transitions', () => ({
  flyScale: () => ({ duration: 0 }),
}));

Object.defineProperty(Element.prototype, 'animate', {
  configurable: true,
  value: () => ({
    cancel: vi.fn(),
    currentTime: 0,
    effect: {},
    onfinish: null,
    playState: 'finished',
  }),
});

afterEach(() => {
  cleanup();
  confirmMock.mockReset().mockResolvedValue(true);
});

describe('PermissionEntriesDialog', () => {
  it('directly stages an immediate grant and validates the inclusive time window', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { container } = render(PermissionEntriesDialog, {
      props: {
        title: 'Permissions',
        description: 'Manage permissions',
        onSave,
        onClose: vi.fn(),
      },
    });

    expect(container.querySelector('.change-summary [data-icon="checkCircle"]')).toBeTruthy();
    await fireEvent.click(screen.getAllByRole('button', { name: 'manage.addPermissionEntry' })[0]);
    expect(container.querySelector('[data-icon="approvalDelegation"]')).toBeTruthy();
    expect(container.querySelector('[data-icon="today"]')).toBeTruthy();
    expect(container.querySelector('[data-icon="eventUpcoming"]')).toBeTruthy();
    expect(container.querySelector('[data-icon="allInclusive"]')).toBeTruthy();
    await fireEvent.input(screen.getByLabelText('manage.permissionName'), {
      target: { value: 'list_users' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'manage.permissionRevoke' }));
    await fireEvent.click(screen.getByRole('button', { name: 'manage.permissionStartSpecified' }));
    await fireEvent.click(screen.getByRole('switch', { name: 'manage.permissionNeverExpires' }));

    const startInput = screen.getByLabelText('manage.permissionStartsAt') as HTMLInputElement;
    const endInput = screen.getByLabelText('manage.permissionEndsAt') as HTMLInputElement;
    await fireEvent.input(startInput, { target: { value: '2026-08-22T10:00:00' } });
    await fireEvent.input(endInput, { target: { value: '2026-08-22T09:59:59' } });
    expect(screen.getByRole('alert').textContent).toContain('manage.permissionIntervalInvalid');
    expect((screen.getByRole('button', { name: 'manage.saveAllPermissionChanges' }) as HTMLButtonElement).disabled).toBe(true);

    await fireEvent.input(endInput, { target: { value: '2026-08-22T10:00:00' } });
    await fireEvent.click(screen.getByRole('button', { name: 'manage.saveAllPermissionChanges' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith([{
      permission: 'list_users',
      granted: false,
      start_time: parseLocalDateTimeInput('2026-08-22T10:00:00'),
      end_time: parseLocalDateTimeInput('2026-08-22T10:00:00'),
    }]));
  });

  it('keeps duplicate names distinct and lets a pending removal be undone', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(PermissionEntriesDialog, {
      props: {
        title: 'Permissions',
        description: 'Manage permissions',
        entries: [
          { permission: 'search', granted: true, start_time: 100, end_time: 200 },
          { permission: 'search', granted: false, start_time: 300, end_time: null },
        ],
        effectivePermissions: [],
        onSave,
        onClose: vi.fn(),
      },
    });

    expect(screen.getAllByText('search', { selector: 'strong' })).toHaveLength(2);
    expect(screen.getAllByText('manage.permissionState.expired').length).toBeGreaterThan(1);

    await fireEvent.input(screen.getByLabelText('manage.permissionName'), {
      target: { value: 'search_archive' },
    });
    expect(screen.getByRole('button', { name: 'manage.undoPermissionEntryChanges' })).toBeTruthy();
    expect(document.querySelector('[data-icon="undo"]')).toBeTruthy();
    const modifiedRow = screen.getByText('search_archive', { selector: 'strong' }).closest('li')!;
    expect(Array.from(modifiedRow.querySelectorAll<HTMLButtonElement>('.entry-actions button'))
      .map((button) => button.getAttribute('aria-label')))
      .toEqual(['manage.undoPermissionEntryChanges', 'manage.deletePermissionEntry']);
    await fireEvent.click(screen.getByRole('button', { name: 'manage.undoPermissionEntryChanges' }));
    expect((screen.getByLabelText('manage.permissionName') as HTMLInputElement).value).toBe('search');
    await fireEvent.input(screen.getByLabelText('manage.permissionName'), {
      target: { value: 'search_archive' },
    });
    await fireEvent.click(screen.getAllByRole('button', { name: 'manage.selectPermissionEntry' })[1]);
    await fireEvent.click(screen.getAllByRole('button', { name: 'manage.deletePermissionEntry' }).at(-1)!);
    expect(screen.getByText('manage.permissionPendingDeletion')).toBeTruthy();

    await fireEvent.click(screen.getAllByRole('button', { name: 'manage.undoDeletePermissionEntry' }).at(-1)!);
    expect(screen.queryByText('manage.permissionPendingDeletion')).toBeNull();
    await fireEvent.click(screen.getAllByRole('button', { name: 'manage.deletePermissionEntry' }).at(-1)!);
    await fireEvent.click(screen.getByRole('button', { name: 'manage.saveAllPermissionChanges' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith([{
      permission: 'search_archive',
      granted: true,
      start_time: 100,
      end_time: 200,
    }]));
    expect(Object.keys(onSave.mock.calls[0][0][0]).sort()).toEqual([
      'end_time',
      'granted',
      'permission',
      'start_time',
    ]);
  });

  it('searches and filters rules without hiding expired rules by default', async () => {
    render(PermissionEntriesDialog, {
      props: {
        title: 'Permissions',
        description: 'Manage permissions',
        entries: [
          { permission: 'current_rule', granted: true, start_time: 1, end_time: null },
          { permission: 'expired_rule', granted: true, start_time: 1, end_time: 2 },
        ],
        onSave: vi.fn().mockResolvedValue(undefined),
        onClose: vi.fn(),
      },
    });

    expect(screen.getByText('current_rule', { selector: 'strong' })).toBeTruthy();
    expect(screen.getByText('expired_rule', { selector: 'strong' })).toBeTruthy();

    await fireEvent.click(screen.getByRole('button', { name: /manage\.permissionState\.expired/ }));
    expect(screen.queryByText('current_rule', { selector: 'strong' })).toBeNull();
    expect(screen.getByText('expired_rule', { selector: 'strong' })).toBeTruthy();
    await waitFor(() => expect((screen.getByLabelText('manage.permissionName') as HTMLInputElement).value).toBe('expired_rule'));
    expect(screen.queryByText('manage.permissionSelected')).toBeNull();

    await fireEvent.click(screen.getByRole('button', { name: /manage\.permissionFilterAll/ }));
    await fireEvent.input(screen.getByLabelText('manage.searchPermissionEntries'), {
      target: { value: 'current' },
    });
    expect((screen.getByLabelText('manage.searchPermissionEntries') as HTMLInputElement).dataset.focusRing)
      .toBe('delegated');
    expect(screen.getByText('current_rule', { selector: 'strong' })).toBeTruthy();
    expect(screen.queryByText('expired_rule', { selector: 'strong' })).toBeNull();
    await waitFor(() => expect((screen.getByLabelText('manage.permissionName') as HTMLInputElement).value).toBe('current_rule'));
  });

  it('keeps the working copy and error visible when saving fails', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('server offline'));
    render(PermissionEntriesDialog, {
      props: {
        title: 'Permissions',
        description: 'Manage permissions',
        entries: [{ permission: 'search', granted: true, start_time: 100, end_time: null }],
        onSave,
        onClose: vi.fn(),
      },
    });

    const input = screen.getByLabelText('manage.permissionName') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'search_archive' } });
    await fireEvent.click(screen.getByRole('button', { name: 'manage.saveAllPermissionChanges' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('server offline'));
    expect(input.value).toBe('search_archive');
    expect((screen.getByRole('button', { name: 'manage.saveAllPermissionChanges' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('protects staged changes when closing or refreshing', async () => {
    const onClose = vi.fn();
    const onRefresh = vi.fn().mockResolvedValue({
      entries: [{ permission: 'search', granted: true, start_time: 100, end_time: null }],
      effectivePermissions: ['search'],
      inheritedPermissions: [],
    });
    render(PermissionEntriesDialog, {
      props: {
        title: 'Permissions',
        description: 'Manage permissions',
        entries: [{ permission: 'search', granted: true, start_time: 100, end_time: null }],
        onRefresh,
        onSave: vi.fn().mockResolvedValue(undefined),
        onClose,
      },
    });
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    await waitFor(() => expect((screen.getByLabelText('manage.permissionName') as HTMLInputElement).disabled).toBe(false));

    await fireEvent.click(screen.getByRole('button', { name: 'common.refresh' }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(2));
    expect(confirmMock).not.toHaveBeenCalled();

    await fireEvent.input(screen.getByLabelText('manage.permissionName'), {
      target: { value: 'search_archive' },
    });
    confirmMock.mockResolvedValueOnce(false);
    await fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }));
    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
    expect(onClose).not.toHaveBeenCalled();

    confirmMock.mockResolvedValueOnce(false);
    await fireEvent.click(screen.getByRole('button', { name: 'common.refresh' }));
    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(2));
    expect(onRefresh).toHaveBeenCalledTimes(2);

    confirmMock.mockResolvedValueOnce(true);
    await fireEvent.click(screen.getByRole('button', { name: 'common.refresh' }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(3));
    await waitFor(() => expect((screen.getByLabelText('manage.permissionName') as HTMLInputElement).value).toBe('search'));
  });
});
