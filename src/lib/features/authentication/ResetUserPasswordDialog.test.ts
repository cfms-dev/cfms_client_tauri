// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ResetUserPasswordDialog from '$lib/features/authentication/ResetUserPasswordDialog.svelte';

vi.mock('svelte-i18n', () => ({
  _: {
    subscribe(run: (translate: (key: string) => string) => void) {
      run((key) => key);
      return () => undefined;
    },
  },
}));

vi.mock('$lib/shared/motion/transitions', () => ({
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

describe('ResetUserPasswordDialog', () => {
  it('disables both trailing actions while a reset is pending', async () => {
    let finish!: () => void;
    const onSave = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    render(ResetUserPasswordDialog, { username: 'alice', onSave, onClose: vi.fn() });
    const input = screen.getByLabelText('dialog.changePassword.newPassword') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'Test-only-password-42!' } });
    await fireEvent.click(screen.getByRole('button', { name: 'manage.resetPassword' }));
    const generate = screen.getByRole('button', { name: 'dialog.changePassword.generateStrongPassword' });
    const reveal = screen.getByRole('button', { name: 'login.showPassword' });
    await waitFor(() => expect(generate.hasAttribute('disabled')).toBe(true));
    expect(reveal.hasAttribute('disabled')).toBe(true);
    expect(input.disabled).toBe(true);
    await fireEvent.click(generate);
    await fireEvent.click(reveal);
    expect(input.value).toBe('Test-only-password-42!');
    expect(input.type).toBe('password');
    finish();
    await waitFor(() => expect(input.disabled).toBe(false));
  });

  it('generates, reveals and masks a password through the shared trailing actions', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(ResetUserPasswordDialog, { username: 'alice', onSave, onClose: vi.fn() });
    const input = screen.getByLabelText('dialog.changePassword.newPassword') as HTMLInputElement;
    expect(input.type).toBe('password');
    await fireEvent.click(screen.getByRole('button', { name: 'dialog.changePassword.generateStrongPassword' }));
    expect(input.value).toHaveLength(16);
    expect(input.type).toBe('text');
    const generated = input.value;
    await fireEvent.click(screen.getByRole('button', { name: 'login.hidePassword' }));
    expect(input.type).toBe('password');
    expect(input.value).toBe(generated);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('passes the two-factor choice after the existing reset options', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(ResetUserPasswordDialog, {
      props: {
        username: 'alice',
        canDisableTwoFactor: true,
        onSave,
        onClose: vi.fn(),
      },
    });

    await fireEvent.input(screen.getByLabelText('dialog.changePassword.newPassword'), {
      target: { value: 'New-password-42!' },
    });
    await fireEvent.click(screen.getByRole('switch', {
      name: 'manage.disableTwoFactorWithPasswordReset',
    }));
    await fireEvent.click(screen.getByRole('button', { name: 'manage.resetPassword' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(
      'New-password-42!',
      false,
      false,
      true,
    ));
  });

  it('does not offer the two-factor option without management permission', () => {
    render(ResetUserPasswordDialog, {
      props: {
        username: 'alice',
        canDisableTwoFactor: false,
        onSave: vi.fn().mockResolvedValue(undefined),
        onClose: vi.fn(),
      },
    });

    expect(screen.queryByRole('switch', {
      name: 'manage.disableTwoFactorWithPasswordReset',
    })).toBeNull();
  });
});
