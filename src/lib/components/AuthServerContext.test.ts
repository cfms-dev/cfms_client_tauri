// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import AuthServerContext from './AuthServerContext.svelte';

afterEach(cleanup);

describe('AuthServerContext', () => {
  it('presents the current server as the authentication context', () => {
    render(AuthServerContext, { props: { label: 'Sign in to CFMS Server' } });

    const context = screen.getByRole('banner', { name: 'Sign in to CFMS Server' });
    expect(context.textContent).toContain('Sign in to CFMS Server');
  });
});
