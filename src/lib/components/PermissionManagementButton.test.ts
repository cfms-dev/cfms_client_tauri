// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PermissionManagementButton from './PermissionManagementButton.svelte';

afterEach(cleanup);

describe('PermissionManagementButton', () => {
  it('exposes a labeled permission action and respects permission gating', async () => {
    const onclick = vi.fn();
    const { rerender } = render(PermissionManagementButton, {
      props: { label: 'Edit permissions', onclick, disabled: true },
    });

    const button = screen.getByRole('button', { name: 'Edit permissions' }) as HTMLButtonElement;
    expect(button.textContent).toContain('Edit permissions');
    expect(button.disabled).toBe(true);
    await fireEvent.click(button);
    expect(onclick).not.toHaveBeenCalled();

    await rerender({ label: 'Edit permissions', onclick, disabled: false });
    await fireEvent.click(screen.getByRole('button', { name: 'Edit permissions' }));
    expect(onclick).toHaveBeenCalledTimes(1);
  });
});
