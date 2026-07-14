// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AccountDisabledNotice from './AccountDisabledNotice.svelte';

afterEach(cleanup);

describe('AccountDisabledNotice', () => {
  const baseProps = {
    signInLabel: 'Sign in to CFMS Server',
    title: 'Your account has been disabled',
    username: 'disabled-user',
    description: 'If you have questions, contact your system administrator.',
    requestTimeLabel: 'Request time',
    requestTime: '2026-07-14 21:45:00 UTC',
    backLabel: 'Back',
    reason: 'The server did not provide more information.',
    onBack: vi.fn(),
  };

  it('shows the affected account and returns through the provided action', async () => {
    const onBack = vi.fn();
    render(AccountDisabledNotice, { props: { ...baseProps, onBack } });

    expect(screen.getByRole('region', { name: 'Your account has been disabled' })).toBeTruthy();
    expect(screen.getByText('Sign in to CFMS Server')).toBeTruthy();
    expect(screen.getByText('disabled-user')).toBeTruthy();
    expect(screen.getByText('Request time')).toBeTruthy();
    expect(screen.getByText('2026-07-14 21:45:00 UTC')).toBeTruthy();
    expect(screen.getByRole('complementary').textContent).toContain(
      'The server did not provide more information.',
    );

    await fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('renders a server-provided reason in place of the default copy', () => {
    render(AccountDisabledNotice, {
      props: { ...baseProps, reason: 'Disabled after an administrator review.' },
    });

    expect(screen.getByRole('complementary').textContent).toContain(
      'Disabled after an administrator review.',
    );
  });
});
