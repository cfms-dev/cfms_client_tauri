// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseLocalDateTimeInput } from '$lib/permission-entries';
import PermissionEntriesDialog from './PermissionEntriesDialog.svelte';

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

afterEach(cleanup);

describe('PermissionEntriesDialog', () => {
  it('creates an immediate grant without expiry and validates the inclusive time window', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const before = Math.floor(Date.now() / 1000);
    render(PermissionEntriesDialog, {
      props: {
        title: 'Permissions',
        description: 'Manage permissions',
        onSave,
        onClose: vi.fn(),
      },
    });

    await fireEvent.click(screen.getAllByRole('button', { name: 'manage.addPermissionEntry' })[0]);
    await fireEvent.input(screen.getByLabelText('manage.permissionName'), {
      target: { value: 'list_users' },
    });

    const expirySwitch = screen.getByRole('switch', { name: 'manage.permissionExpiryEnabled' });
    expect(expirySwitch.getAttribute('aria-checked')).toBe('false');
    const defaultStart = parseLocalDateTimeInput(
      (screen.getByLabelText('manage.permissionStartsAt') as HTMLInputElement).value,
    );
    expect(defaultStart).not.toBeNull();
    expect(defaultStart!).toBeGreaterThanOrEqual(before);
    expect(defaultStart!).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
    await fireEvent.click(screen.getByRole('button', { name: 'manage.permissionRevoke' }));
    await fireEvent.click(expirySwitch);

    const startInput = screen.getByLabelText('manage.permissionStartsAt') as HTMLInputElement;
    const endInput = screen.getByLabelText('manage.permissionEndsAt') as HTMLInputElement;
    await fireEvent.input(startInput, { target: { value: '2026-08-22T10:00:00' } });
    await fireEvent.input(endInput, { target: { value: '2026-08-22T09:59:59' } });
    await fireEvent.click(screen.getByRole('button', { name: 'manage.applyPermissionEntry' }));
    expect(screen.getByRole('alert').textContent).toContain('manage.permissionIntervalInvalid');

    await fireEvent.input(endInput, { target: { value: '2026-08-22T10:00:00' } });
    await fireEvent.click(screen.getByRole('button', { name: 'manage.applyPermissionEntry' }));
    await fireEvent.click(screen.getByRole('button', { name: 'common.save' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith([{
      permission: 'list_users',
      granted: false,
      start_time: parseLocalDateTimeInput('2026-08-22T10:00:00'),
      end_time: parseLocalDateTimeInput('2026-08-22T10:00:00'),
    }]));
  });

  it('keeps duplicate names distinct and lets an expired entry be edited or removed', async () => {
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
    expect(screen.getByText('manage.permissionState.expired')).toBeTruthy();

    await fireEvent.click(screen.getAllByRole('button', { name: 'manage.editPermissionEntry' })[0]);
    await fireEvent.input(screen.getByLabelText('manage.permissionName'), {
      target: { value: 'search_archive' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'manage.applyPermissionEntry' }));
    await fireEvent.click(screen.getAllByRole('button', { name: 'manage.deletePermissionEntry' })[1]);
    await fireEvent.click(screen.getByRole('button', { name: 'common.save' }));

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
});
