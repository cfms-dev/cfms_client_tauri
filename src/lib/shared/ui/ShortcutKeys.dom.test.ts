// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ShortcutKeys from '$lib/shared/ui/ShortcutKeys.svelte';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

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

  it.each([
    ['Win32', 'Ctrl+Shift+N'],
    ['MacIntel', '⌘⇧N'],
  ])('shows only the primary menu shortcut on %s', (platform, label) => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform);
    const { container } = render(ShortcutKeys, {
      shortcuts: [{ key: 'n', primary: true, shift: true }, { key: 'F5' }], variant: 'menu',
    });
    expect(screen.getByLabelText(label).textContent).toBe(label);
    expect(container.querySelectorAll('kbd')).toHaveLength(1);
    expect(container.querySelector('.shortcut-keys--menu')).not.toBeNull();
  });

  it('keeps all alternatives in the default keycap presentation', () => {
    const { container } = render(ShortcutKeys, { shortcuts: [{ key: 'F5' }, { key: 'r', primary: true }] });
    expect(container.querySelectorAll('kbd')).toHaveLength(2);
    expect(container.querySelector('.shortcut-keys--menu')).toBeNull();
  });
});
