// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ResetUserPasswordDialog from './ResetUserPasswordDialog.svelte';

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

describe('ResetUserPasswordDialog', () => {
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
