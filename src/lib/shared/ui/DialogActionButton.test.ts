// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DialogActionButton from '$lib/shared/ui/DialogActionButton.svelte';

afterEach(cleanup);

const children = createRawSnippet(() => ({ render: () => '<span>Cancel</span>' }));

describe('DialogActionButton', () => {
  it('uses the transparent secondary treatment by default', async () => {
    render(DialogActionButton, { props: { children } });

    const button = screen.getByRole('button', { name: 'Cancel' });
    expect(button.classList.contains('dialog-action-button--secondary')).toBe(true);
    await waitFor(() => expect(button.getAttribute('type')).toBe('button'));
  });

  it('forwards native button behavior and primary emphasis', async () => {
    const onclick = vi.fn();
    render(DialogActionButton, {
      props: { children, variant: 'primary', type: 'submit', onclick },
    });

    const button = screen.getByRole('button', { name: 'Cancel' });
    await fireEvent.click(button);
    expect(button.classList.contains('dialog-action-button--primary')).toBe(true);
    await waitFor(() => expect(button.getAttribute('type')).toBe('submit'));
    expect(onclick).toHaveBeenCalledOnce();
  });
});
