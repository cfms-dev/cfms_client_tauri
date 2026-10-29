import '$lib/i18n';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { locale, waitLocale } from 'svelte-i18n';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TransferFailureHint from './TransferFailureHint.svelte';

beforeEach(async () => { locale.set('en'); await waitLocale(); vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('TransferFailureHint', () => {
  it('opens after 500ms and stays open while reading the portaled text', async () => {
    const { container } = render(TransferFailureHint, { reason: 'Permission denied' });
    const button = screen.getByRole('button', { name: 'View failure details' });
    await fireEvent.pointerEnter(button, { pointerType: 'mouse' });
    await vi.advanceTimersByTimeAsync(499);
    expect(screen.queryByRole('tooltip')).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip.textContent).toBe('Permission denied');
    expect(container.contains(tooltip)).toBe(false);
    expect(button.getAttribute('aria-describedby')).toBe(tooltip.id);
    await fireEvent.pointerLeave(button);
    await fireEvent.pointerEnter(tooltip);
    await vi.advanceTimersByTimeAsync(150);
    expect(screen.getByRole('tooltip')).toBe(tooltip);
    await fireEvent.pointerLeave(tooltip);
    await vi.advanceTimersByTimeAsync(150);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('supports focus and Escape without immediately reopening', async () => {
    render(TransferFailureHint, { reason: 'Session ended' });
    const button = screen.getByRole('button');
    await fireEvent.focusIn(button);
    expect(screen.getByRole('tooltip').textContent).toBe('Session ended');
    await fireEvent.keyDown(button, { key: 'Escape' });
    await tick();
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('toggles on touch/click, ignores inside presses and dismisses outside', async () => {
    render(TransferFailureHint, { reason: 'Network unavailable' });
    const button = screen.getByRole('button');
    await fireEvent.pointerDown(button, { pointerType: 'touch' });
    await fireEvent.focusIn(button);
    expect(screen.queryByRole('tooltip')).toBeNull();
    await fireEvent.click(button);
    await fireEvent.pointerDown(screen.getByRole('tooltip'));
    expect(screen.getByRole('tooltip')).toBeTruthy();
    await fireEvent.click(button);
    expect(screen.queryByRole('tooltip')).toBeNull();
    await fireEvent.click(button);
    await fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('updates open content and cleans up portals and pending timers on unmount', async () => {
    const view = render(TransferFailureHint, { reason: 'Old reason' });
    const button = screen.getByRole('button');
    await fireEvent.click(button);
    await view.rerender({ reason: 'New reason' });
    expect(screen.getByRole('tooltip').textContent).toBe('New reason');
    view.unmount();
    expect(screen.queryByRole('tooltip')).toBeNull();
    const second = render(TransferFailureHint, { reason: 'Pending' });
    await fireEvent.pointerEnter(screen.getByRole('button'));
    second.unmount();
    await vi.advanceTimersByTimeAsync(600);
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
