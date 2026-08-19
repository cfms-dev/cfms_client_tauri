// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LockdownControl from './LockdownControl.svelte';

afterEach(cleanup);

const labels = {
  enableLabel: 'Enable lockdown',
  disableLabel: 'Disable lockdown',
  confirmLabel: 'Confirm lockdown',
  cancelLabel: 'Cancel',
  editLabel: 'Edit lockdown reason',
  reasonLabel: 'Lockdown reason',
  reasonPlaceholder: 'Optional reason',
  remainingLabel: (count: number) => `${count} characters left`,
};

describe('LockdownControl', () => {
  it('keeps the primary button mounted and uses the second click to confirm', async () => {
    const onToggle = vi.fn();
    render(LockdownControl, { props: { ...labels, active: false, currentReason: null, busy: false, onToggle } });

    const primaryButton = screen.getByRole('button', { name: 'Enable lockdown' });
    await fireEvent.click(primaryButton);

    expect(onToggle).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Lockdown reason' })).toBeTruthy();
    expect(screen.getByText('1024 characters left')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Confirm lockdown' })).toBe(primaryButton);

    await fireEvent.click(primaryButton);
    expect(onToggle).toHaveBeenCalledOnce();
    expect(onToggle).toHaveBeenCalledWith(true, null);
  });

  it('preserves the optional reason exactly when confirming', async () => {
    const onToggle = vi.fn();
    render(LockdownControl, { props: { ...labels, active: false, currentReason: null, busy: false, onToggle } });

    await fireEvent.click(screen.getByRole('button', { name: 'Enable lockdown' }));
    await fireEvent.input(screen.getByRole('textbox'), { target: { value: '  Incident response  ' } });
    expect(screen.getByText('1003 characters left')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Confirm lockdown' }));

    expect(onToggle).toHaveBeenCalledWith(true, '  Incident response  ');
  });

  it('cancels reason entry without toggling lockdown', async () => {
    const onToggle = vi.fn();
    render(LockdownControl, { props: { ...labels, active: false, currentReason: null, busy: false, onToggle } });

    await fireEvent.click(screen.getByRole('button', { name: 'Enable lockdown' }));
    await fireEvent.input(screen.getByRole('textbox'), { target: { value: 'Draft reason' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('textbox')).toBeNull();
    expect(onToggle).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Enable lockdown' }));

    await fireEvent.click(screen.getByRole('button', { name: 'Enable lockdown' }));
    expect(screen.getByRole<HTMLInputElement>('textbox').value).toBe('');
  });

  it('disables an active lockdown immediately from the same primary button', async () => {
    const onToggle = vi.fn();
    render(LockdownControl, { props: { ...labels, active: true, currentReason: 'Incident response', busy: false, onToggle } });

    await fireEvent.click(screen.getByRole('button', { name: 'Disable lockdown' }));

    expect(screen.queryByRole('textbox')).toBeNull();
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it('edits and clears the reason without disabling an active lockdown', async () => {
    const onToggle = vi.fn();
    render(LockdownControl, { props: { ...labels, active: true, currentReason: 'Incident response', busy: false, onToggle } });

    await fireEvent.click(screen.getByRole('button', { name: 'Edit lockdown reason' }));
    const reasonInput = screen.getByRole<HTMLInputElement>('textbox', { name: 'Lockdown reason' });
    expect(reasonInput.value).toBe('Incident response');

    await fireEvent.input(reasonInput, { target: { value: '' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Confirm lockdown' }));

    expect(onToggle).toHaveBeenCalledWith(true, null);
  });

  it('keeps the edited reason available when the update is rejected', async () => {
    const onToggle = vi.fn().mockResolvedValue(false);
    render(LockdownControl, { props: { ...labels, active: true, currentReason: 'Incident response', busy: false, onToggle } });

    await fireEvent.click(screen.getByRole('button', { name: 'Edit lockdown reason' }));
    await fireEvent.input(screen.getByRole('textbox'), { target: { value: 'Revised reason' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Confirm lockdown' }));

    expect(screen.getByRole<HTMLInputElement>('textbox').value).toBe('Revised reason');
  });
});
