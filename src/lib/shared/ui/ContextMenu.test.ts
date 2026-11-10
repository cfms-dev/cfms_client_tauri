// @vitest-environment jsdom

import '$lib/shared/i18n';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ContextMenu from '$lib/shared/ui/ContextMenu.svelte';
import type { ContextMenuItem } from '$lib/shared/ui/context-menu';
import { locale } from 'svelte-i18n';

vi.mock('$lib/shared/motion/transitions', () => ({
  menuScale: () => ({ duration: 0 }),
}));

vi.mock('svelte/transition', () => ({ fade: () => ({ duration: 0 }) }));

Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
  configurable: true,
  value: vi.fn(),
});

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('ContextMenu keyboard interaction', () => {
  it.each(['createNewFolder', 'folderUpload', 'driveFileMove', 'contentCopy', 'adminPanelSettings', 'passwordReset', 'accountCircle'] as const)(
    'uses %s duotone channels only for enabled, non-dangerous actions', (icon) => {
      render(ContextMenu, {
        open: true, x: 10, y: 10, onClose: vi.fn(),
        items: [
          { id: 'enabled', label: 'Enabled', icon, onSelect: vi.fn() },
          { id: 'disabled', label: 'Disabled', icon, disabled: true, onSelect: vi.fn() },
          { id: 'danger', label: 'Danger', icon, danger: true, onSelect: vi.fn() },
        ],
      });
      for (const channel of ['primary', 'secondary']) {
        const path = `path[fill="var(--cfms-icon-${channel}, currentColor)"]`;
        expect(screen.getByRole('menuitem', { name: 'Enabled' }).querySelector(path)).not.toBeNull();
        expect(screen.getByRole('menuitem', { name: 'Disabled' }).querySelector(path)).toBeNull();
        expect(screen.getByRole('menuitem', { name: 'Danger' }).querySelector(path)).toBeNull();
      }
    },
  );

  it('filters permissions and separators, ignores disabled actions, and closes before selection', async () => {
    const order: string[] = [];
    const disabledAction = vi.fn();
    render(ContextMenu, {
      open: true, x: 10, y: 10,
      userPermissions: [],
      onClose: () => { order.push('close'); },
      items: [
        { type: 'divider' },
        { id: 'hidden', label: 'Restricted', icon: 'lock', requiredPermissions: ['admin'], onSelect: vi.fn() },
        { id: 'disabled', label: 'Disabled', icon: 'folderUpload', disabled: true, onSelect: disabledAction },
        { type: 'divider' },
        { id: 'upload', label: 'Upload folder', icon: 'folderUpload', onSelect: () => { order.push('select'); } },
        { type: 'divider' },
      ],
    });
    expect(screen.queryByRole('menuitem', { name: 'Restricted' })).toBeNull();
    expect(screen.getAllByRole('separator')).toHaveLength(1);
    const disabled = screen.getByRole('menuitem', { name: 'Disabled' });
    const upload = screen.getByRole('menuitem', { name: 'Upload folder' });
    await waitFor(() => expect(document.activeElement).toBe(upload));
    await fireEvent.click(disabled);
    expect(disabledAction).not.toHaveBeenCalled();
    expect(order).toEqual([]);
    await fireEvent.click(upload);
    expect(order).toEqual(['close', 'select']);
  });

  it('focuses actions, navigates with arrows, and restores the trigger on Escape', async () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    const onClose = vi.fn();
    const { unmount } = render(ContextMenu, {
      props: {
        open: true,
        x: 10,
        y: 10,
        sourceElement: trigger,
        onClose,
        items: [
          { id: 'open', label: 'Open', icon: 'folderOpen', onSelect: vi.fn() },
          { id: 'disabled', label: 'Disabled', icon: 'info', disabled: true, onSelect: vi.fn() },
          { id: 'delete', label: 'Delete', icon: 'delete', onSelect: vi.fn() },
        ],
      },
    });

    const open = screen.getByRole('menuitem', { name: 'Open' });
    const remove = screen.getByRole('menuitem', { name: 'Delete' });
    await waitFor(() => expect(document.activeElement).toBe(open));
    await fireEvent.keyDown(open, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(remove);
    await fireEvent.keyDown(remove, { key: 'Home' });
    expect(document.activeElement).toBe(open);
    await fireEvent.keyDown(open, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
    unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});

describe('context menu hints', () => {
  const reason = 'Elevate privileges using the toolbar first.';
  function menuItems(action = vi.fn()): ContextMenuItem[] {
    return [
      { id: 'available', label: 'Available', icon: 'info', onSelect: vi.fn() },
      { id: 'unavailable', label: 'Unavailable', icon: 'info', disabled: true, onSelect: vi.fn() },
      { id: 'reset', label: 'Reset password', icon: 'passwordReset', disabled: true, disabledReason: reason, onSelect: action },
    ];
  }

  it('shows the first shortcut beside its action and leaves unbound actions without a hint', () => {
    render(ContextMenu, {
      open: true, x: 10, y: 10, onClose: vi.fn(), items: [
        { id: 'refresh', label: 'Refresh', icon: 'refresh', shortcuts: [{ key: 'F5' }, { key: 'r', primary: true }], onSelect: vi.fn() },
        { id: 'download', label: 'Download folder', icon: 'download', onSelect: vi.fn() },
      ],
    });
    expect(within(screen.getByRole('menuitem', { name: /Refresh/ })).getByText('F5')).toBeTruthy();
    expect(screen.queryByText('Ctrl+R')).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Download folder' }).querySelector('kbd')).toBeNull();
  });

  it('navigates to explainable disabled actions without activating or closing them', async () => {
    const action = vi.fn();
    const onClose = vi.fn();
    render(ContextMenu, { open: true, x: 10, y: 10, onClose, items: menuItems(action) });
    const available = screen.getByRole('menuitem', { name: 'Available' });
    const reset = screen.getByRole('menuitem', { name: 'Reset password' });
    await waitFor(() => expect(document.activeElement).toBe(available));
    await fireEvent.keyDown(available, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(reset);
    expect(reset.getAttribute('aria-disabled')).toBe('true');
    expect(reset.hasAttribute('disabled')).toBe(false);
    const tooltip = screen.getByRole('tooltip');
    expect(reset.getAttribute('aria-describedby')).toBe(tooltip.id);
    expect(tooltip.textContent).toBe(reason);
    expect(tooltip.parentElement).toBe(document.body);
    for (const key of ['Enter', ' ']) {
      expect(await fireEvent.keyDown(reset, { key })).toBe(false);
      await fireEvent.keyUp(reset, { key });
    }
    await fireEvent.click(reset);
    expect(action).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    await fireEvent.keyDown(reset, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('focuses the first explainable action when every action is disabled', async () => {
    render(ContextMenu, { open: true, x: 10, y: 10, onClose: vi.fn(), items: menuItems().slice(1) });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Reset password' })));
    expect(screen.getByRole('tooltip').textContent).toBe(reason);
  });

  it('waits 500ms on hover and stays visible while the pointer crosses into its tooltip', async () => {
    render(ContextMenu, { open: true, x: 10, y: 10, onClose: vi.fn(), items: menuItems() });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Available' })));
    vi.useFakeTimers();
    const reset = screen.getByRole('menuitem', { name: 'Reset password' });
    await fireEvent.pointerEnter(reset);
    await vi.advanceTimersByTimeAsync(499);
    expect(screen.queryByRole('tooltip')).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    const tooltip = screen.getByRole('tooltip');
    await fireEvent.pointerLeave(reset);
    await fireEvent.pointerEnter(tooltip);
    await vi.advanceTimersByTimeAsync(120);
    expect(tooltip.hidden).toBe(false);
    await fireEvent.pointerLeave(tooltip);
    await vi.advanceTimersByTimeAsync(119);
    expect(tooltip.hidden).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(tooltip.hidden).toBe(true);
  });

  it('cancels pending hover help when leaving the action', async () => {
    render(ContextMenu, { open: true, x: 10, y: 10, onClose: vi.fn(), items: menuItems() });
    await tick();
    vi.useFakeTimers();
    const reset = screen.getByRole('menuitem', { name: 'Reset password' });
    await fireEvent.pointerEnter(reset);
    await vi.advanceTimersByTimeAsync(200);
    await fireEvent.pointerLeave(reset);
    await vi.advanceTimersByTimeAsync(600);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('shows help immediately on touch without running the disabled action', async () => {
    const action = vi.fn();
    const onClose = vi.fn();
    render(ContextMenu, { open: true, x: 10, y: 10, onClose, items: menuItems(action) });
    await tick();
    const reset = screen.getByRole('menuitem', { name: 'Reset password' });
    const press = new Event('pointerdown', { bubbles: true });
    Object.assign(press, { pointerType: 'touch' });
    await fireEvent(reset, press);
    await fireEvent.click(reset);
    expect(screen.getByRole('tooltip').textContent).toBe(reason);
    expect(action).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('removes the reason when an action becomes enabled, preserving focus', async () => {
    const items = menuItems();
    const { rerender } = render(ContextMenu, { open: true, x: 10, y: 10, onClose: vi.fn(), items });
    const reset = screen.getByRole('menuitem', { name: 'Reset password' });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Available' })));
    reset.focus();
    await tick();
    expect(screen.getByRole('tooltip')).toBeTruthy();
    await rerender({ items: items.map((item) => 'id' in item && item.id === 'reset' ? { ...item, disabled: false } : item) });
    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull();
    expect(document.activeElement).toBe(reset);
    expect(reset.hasAttribute('aria-disabled')).toBe(false);
    expect(reset.hasAttribute('aria-describedby')).toBe(false);
  });

  it.each(['close', 'remove'] as const)('cleans pending help on %s', async (change) => {
    const { rerender } = render(ContextMenu, { open: true, x: 10, y: 10, onClose: vi.fn(), items: menuItems() });
    await tick();
    vi.useFakeTimers();
    await fireEvent.pointerEnter(screen.getByRole('menuitem', { name: 'Reset password' }));
    await rerender(change === 'close' ? { open: false } : { items: menuItems().slice(0, 2) });
    await vi.advanceTimersByTimeAsync(600);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('clamps help to the viewport and repositions it on resize', async () => {
    render(ContextMenu, { open: true, x: 10, y: 10, onClose: vi.fn(), items: menuItems() });
    await tick();
    const reset = screen.getByRole('menuitem', { name: 'Reset password' });
    const tooltip = screen.getByRole('tooltip', { hidden: true });
    const bounds = vi.spyOn(reset, 'getBoundingClientRect').mockReturnValue({ left: 2, right: window.innerWidth - 2, top: window.innerHeight - 12, bottom: window.innerHeight } as DOMRect);
    vi.spyOn(tooltip, 'getBoundingClientRect').mockReturnValue({ width: 300, height: 50 } as DOMRect);
    reset.focus();
    await tick();
    await tick();
    expect(tooltip.style.left).toBe('8px');
    expect(tooltip.style.top).toBe(`${window.innerHeight - 58}px`);
    bounds.mockReturnValue({ left: 10, right: 100, top: 30, bottom: 62 } as DOMRect);
    await fireEvent(window, new Event('resize'));
    expect(tooltip.style.left).toBe('108px');
    expect(tooltip.style.top).toBe('30px');
  });
});

describe('context menu elevation', () => {
  it.each(['passwordReset', 'info'] as const)('keeps the %s warning action enabled and closes before selecting', async (icon) => {
    locale.set('en');
    const order: string[] = [];
    render(ContextMenu, { open: true, x: 10, y: 10, onClose: () => { order.push('close'); }, items: [
      { id: 'reset', label: 'Reset password', icon, requiresElevation: true, onSelect: () => { order.push('select'); } },
    ] });
    const reset = screen.getByRole('menuitem', { name: 'Reset password' });
    await waitFor(() => expect(document.activeElement).toBe(reset));
    expect(reset.hasAttribute('disabled')).toBe(false);
    expect(reset.hasAttribute('aria-disabled')).toBe(false);
    expect(reset.classList.contains('requires-elevation')).toBe(true);
    const tooltip = screen.getByRole('tooltip');
    expect(reset.getAttribute('aria-describedby')).toBe(tooltip.id);
    expect(tooltip.textContent).toBe('This action requires elevated privileges. Select it to verify your identity.');
    const artwork = reset.querySelector('.context-menu-icon')!;
    expect(artwork.classList.contains('duotone')).toBe(icon === 'passwordReset');
    expect(artwork.classList.contains('warning')).toBe(true);
    if (icon === 'passwordReset') {
      expect(artwork.querySelector('path[fill="var(--cfms-icon-primary, currentColor)"]')).not.toBeNull();
      expect(artwork.querySelector('path[fill="var(--cfms-icon-secondary, currentColor)"]')).not.toBeNull();
    }
    // Enter/Space remain native button activation; neither is suppressed.
    expect(await fireEvent.keyDown(reset, { key: 'Enter' })).toBe(true);
    expect(await fireEvent.keyDown(reset, { key: ' ' })).toBe(true);
    await fireEvent.click(reset);
    expect(order).toEqual(['close', 'select']);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('uses the disabled reason instead of an elevation warning when another prerequisite is missing', async () => {
    const action = vi.fn();
    render(ContextMenu, { open: true, x: 10, y: 10, onClose: vi.fn(), items: [
      { id: 'busy', label: 'Busy', icon: 'passwordReset', disabled: true, disabledReason: 'Another operation is running.', requiresElevation: true, onSelect: action },
    ] });
    const busy = screen.getByRole('menuitem', { name: 'Busy' });
    await waitFor(() => expect(screen.getByRole('tooltip').textContent).toBe('Another operation is running.'));
    expect(busy.classList.contains('requires-elevation')).toBe(false);
    expect(busy.querySelector('.context-menu-icon.warning')).toBeNull();
    await fireEvent.click(busy);
    expect(action).not.toHaveBeenCalled();
  });

  it('removes the warning and its tooltip after elevation without moving focus', async () => {
    locale.set('en');
    const item = { id: 'reset', label: 'Reset password', icon: 'passwordReset' as const, requiresElevation: true, onSelect: vi.fn() };
    const { rerender } = render(ContextMenu, { open: true, x: 10, y: 10, onClose: vi.fn(), items: [item] });
    const reset = screen.getByRole('menuitem', { name: 'Reset password' });
    await waitFor(() => expect(screen.getByRole('tooltip')).toBeTruthy());
    await rerender({ items: [{ ...item, requiresElevation: false }] });
    expect(reset.classList.contains('requires-elevation')).toBe(false);
    expect(reset.hasAttribute('aria-describedby')).toBe(false);
    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull();
    expect(document.activeElement).toBe(reset);
  });

  it.each(['hover', 'touch'] as const)('explains elevation on %s while preserving activation', async (input) => {
    locale.set('en');
    const action = vi.fn();
    render(ContextMenu, { open: true, x: 10, y: 10, onClose: vi.fn(), items: [
      { id: 'available', label: 'Available', icon: 'info', onSelect: vi.fn() },
      { id: 'reset', label: 'Reset password', icon: 'passwordReset', requiresElevation: true, onSelect: action },
    ] });
    await tick();
    const reset = screen.getByRole('menuitem', { name: 'Reset password' });
    if (input === 'hover') {
      vi.useFakeTimers();
      await fireEvent.pointerEnter(reset);
      await vi.advanceTimersByTimeAsync(500);
    } else {
      const press = new Event('pointerdown', { bubbles: true });
      Object.assign(press, { pointerType: 'touch' });
      await fireEvent(reset, press);
    }
    expect(screen.getByRole('tooltip').textContent).toContain('elevated privileges');
    await fireEvent.click(reset);
    expect(action).toHaveBeenCalledOnce();
  });
});
