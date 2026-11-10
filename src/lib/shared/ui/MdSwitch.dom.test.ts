// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MdSwitch from '$lib/shared/ui/MdSwitch.svelte';

afterEach(cleanup);

describe('MdSwitch interaction', () => {
  it('initializes checked state, responds to external values, and emits one change per activation', async () => {
    const onChange = vi.fn();
    const { rerender } = render(MdSwitch, { checked: true, ariaLabel: 'Proxy', onChange });
    const control = screen.getByRole('switch', { name: 'Proxy' });
    await waitFor(() => expect(control.getAttribute('aria-checked')).toBe('true'));
    expect(onChange).not.toHaveBeenCalled();
    await fireEvent.click(control);
    expect(onChange).toHaveBeenCalledExactlyOnceWith(false);
    await rerender({ checked: true });
    expect(control.getAttribute('aria-checked')).toBe('true');
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('shares press feedback with Space, toggles on release, and clears feedback on blur or cancellation', async () => {
    const onChange = vi.fn();
    render(MdSwitch, { ariaLabel: 'Proxy', onChange });
    const control = screen.getByRole('switch', { name: 'Proxy' });
    await fireEvent.keyDown(control, { key: ' ' });
    expect(control.hasAttribute('data-pressed')).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
    await fireEvent.keyUp(control, { key: ' ' });
    expect(control.hasAttribute('data-pressed')).toBe(false);
    expect(onChange).toHaveBeenCalledExactlyOnceWith(true);
    await fireEvent.keyDown(control, { key: ' ' });
    await fireEvent.blur(control);
    expect(control.hasAttribute('data-pressed')).toBe(false);
    // jsdom does not implement PointerEvent's button initializer.
    await fireEvent(control, new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    expect(control.hasAttribute('data-pressed')).toBe(true);
    await fireEvent.pointerCancel(control);
    expect(control.hasAttribute('data-pressed')).toBe(false);
    await fireEvent(control, new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    await fireEvent.pointerLeave(control);
    expect(control.hasAttribute('data-pressed')).toBe(false);
  });

  it('does not toggle or show press feedback while disabled, including a change during a press', async () => {
    const onChange = vi.fn();
    const { rerender } = render(MdSwitch, { ariaLabel: 'Proxy', onChange });
    const control = screen.getByRole('switch', { name: 'Proxy' });
    await fireEvent.keyDown(control, { key: ' ' });
    await rerender({ disabled: true });
    expect(control.hasAttribute('data-pressed')).toBe(false);
    await fireEvent.keyUp(control, { key: ' ' });
    await fireEvent.click(control);
    await fireEvent.keyDown(control, { key: ' ' });
    expect(control.hasAttribute('data-pressed')).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
    expect(control.getAttribute('aria-checked')).toBe('false');
  });
});
