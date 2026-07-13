// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import ShortcutKeys from './ShortcutKeys.svelte';

afterEach(cleanup);

describe('ShortcutKeys', () => {
  it('formats shortcut keys for the current platform', () => {
    render(ShortcutKeys, {
      props: { shortcuts: [{ key: '/', primary: true }] },
    });

    expect(screen.getByLabelText('Ctrl+/').textContent).toBe('Ctrl+/');
  });

  it('keeps compact decorative hints out of the accessible name', () => {
    const { container } = render(ShortcutKeys, {
      props: { shortcuts: [{ key: '/', primary: true }], compact: true },
    });

    const hint = container.querySelector<HTMLElement>('.shortcut-keys');
    expect(hint?.getAttribute('aria-hidden')).toBe('true');
    expect(hint?.classList.contains('shortcut-keys--compact')).toBe(true);
  });
});
