// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AuditLogFilter from '$lib/features/administration/AuditLogFilter.svelte';

vi.mock('svelte-i18n', () => ({
  _: {
    subscribe(run: (translate: (key: string) => string) => void) {
      run((key) => key);
      return () => undefined;
    },
  },
}));

vi.mock('$lib/shared/motion/transitions', () => ({
  menuScale: () => ({ duration: 0 }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('AuditLogFilter', () => {
  it('stages suggested and custom exact actions until Apply is selected', async () => {
    const onApply = vi.fn().mockResolvedValue(undefined);
    render(AuditLogFilter, {
      props: {
        availableActions: ['login', 'create_directory'],
        filters: { include: [], exclude: [] },
        onApply,
      },
    });

    const trigger = screen.getByRole('button', { name: 'manage.auditFilterButton' });
    await fireEvent.click(trigger);
    await fireEvent.click(screen.getByRole('option', { name: 'login' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();

    const input = screen.getByLabelText('manage.auditFilterSearch');
    await fireEvent.input(input, { target: { value: '  extension_action  ' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByRole('option', { name: 'extension_action' }).getAttribute('aria-selected')).toBe('true');
    expect(onApply).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByRole('button', { name: 'manage.auditFilterApply' }));
    await waitFor(() => expect(onApply).toHaveBeenCalledWith({ include: ['extension_action', 'login'], exclude: [] }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('discards staged changes when closed with Escape or the dismiss layer', async () => {
    const onApply = vi.fn().mockResolvedValue(undefined);
    render(AuditLogFilter, {
      props: {
        availableActions: ['login', 'diagnostics'],
        filters: { include: ['login'], exclude: [] },
        onApply,
      },
    });

    const trigger = screen.getByRole('button', { name: 'manage.auditFilterButton' });
    await fireEvent.click(trigger);
    await fireEvent.click(screen.getByRole('option', { name: 'login' }));
    await fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();

    await fireEvent.click(trigger);
    expect(screen.getByRole('option', { name: 'login' }).getAttribute('aria-selected')).toBe('true');
    await fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('trims and deduplicates custom actions and exposes disabled state', async () => {
    const onApply = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(AuditLogFilter, {
      props: {
        availableActions: [],
        filters: { include: [], exclude: [] },
        onApply,
      },
    });

    const trigger = screen.getByRole('button', { name: 'manage.auditFilterButton' });
    await fireEvent.click(trigger);
    const input = screen.getByLabelText('manage.auditFilterSearch');
    await fireEvent.input(input, { target: { value: '  custom_action  ' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    await fireEvent.input(input, { target: { value: 'custom_action' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    await fireEvent.click(screen.getByRole('button', { name: 'manage.auditFilterApply' }));
    await waitFor(() => expect(onApply).toHaveBeenCalledWith({ include: ['custom_action'], exclude: [] }));

    await rerender({
      availableActions: [],
      filters: { include: [], exclude: [] },
      disabled: true,
      onApply,
    });
    expect((screen.getByRole('button', { name: 'manage.auditFilterButton' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('opens above the trigger and constrains its height when space below is limited', async () => {
    vi.stubGlobal('innerWidth', 800);
    vi.stubGlobal('innerHeight', 600);

    render(AuditLogFilter, {
      props: {
        availableActions: Array.from({ length: 40 }, (_, index) => `action_${index}`),
        filters: { include: [], exclude: [] },
        onApply: vi.fn(),
      },
    });
    const trigger = screen.getByRole('button', { name: 'manage.auditFilterButton' });
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
      x: 620,
      y: 400,
      top: 400,
      right: 700,
      bottom: 432,
      left: 620,
      width: 80,
      height: 32,
      toJSON: () => ({}),
    });

    await fireEvent.click(trigger);
    const panel = screen.getByRole('dialog') as HTMLElement;
    expect(panel.classList.contains('filter-panel--above')).toBe(true);
    expect(panel.style.left).toBe('300px');
    expect(panel.style.width).toBe('400px');
    expect(panel.style.maxHeight).toBe('376px');
    expect(screen.getAllByRole('option')).toHaveLength(42);
  });

  it.each([
    { viewportWidth: 320, triggerLeft: 0, expectedWidth: 288 },
    { viewportWidth: 360, triggerLeft: 280, expectedWidth: 328 },
    { viewportWidth: 540, triggerLeft: 460, expectedWidth: 400 },
    { viewportWidth: 1280, triggerLeft: 0, expectedWidth: 400 },
  ])('keeps the panel inside a $viewportWidth px viewport near either edge', async ({
    viewportWidth, triggerLeft, expectedWidth,
  }) => {
    vi.stubGlobal('innerWidth', viewportWidth);
    vi.stubGlobal('innerHeight', 900);
    render(AuditLogFilter, {
      availableActions: ['login'], filters: { include: [], exclude: [] }, onApply: vi.fn(),
    });
    const trigger = screen.getByRole('button', { name: 'manage.auditFilterButton' });
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
      x: triggerLeft, y: 80, top: 80, right: triggerLeft + 80, bottom: 112,
      left: triggerLeft, width: 80, height: 32, toJSON: () => ({}),
    });

    await fireEvent.click(trigger);
    const panel = screen.getByRole('dialog');
    const panelLeft = parseFloat(panel.style.left);
    expect(parseFloat(panel.style.width)).toBe(expectedWidth);
    expect(panelLeft).toBeGreaterThanOrEqual(16);
    expect(panelLeft + expectedWidth).toBeLessThanOrEqual(viewportWidth - 16);
  });

  it('repositions an open panel when resizing or zooming reduces the viewport', async () => {
    vi.stubGlobal('innerWidth', 800);
    vi.stubGlobal('innerHeight', 600);
    render(AuditLogFilter, {
      availableActions: ['login'], filters: { include: [], exclude: [] }, onApply: vi.fn(),
    });
    const trigger = screen.getByRole('button', { name: 'manage.auditFilterButton' });
    const triggerBounds = vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
      x: 620, y: 400, top: 400, right: 700, bottom: 432, left: 620,
      width: 80, height: 32, toJSON: () => ({}),
    });
    await fireEvent.click(trigger);
    expect(screen.getByRole('dialog').style.width).toBe('400px');

    vi.stubGlobal('innerWidth', 320);
    triggerBounds.mockReturnValue({
      x: 224, y: 400, top: 400, right: 304, bottom: 432, left: 224,
      width: 80, height: 32, toJSON: () => ({}),
    });
    await fireEvent(window, new Event('resize'));
    const panel = screen.getByRole('dialog');
    expect(panel.style.width).toBe('288px');
    expect(panel.style.left).toBe('16px');
    expect(panel.classList.contains('filter-panel--above')).toBe(true);
  });

  it('moves actions between lists and applies both drafts together', async () => {
    const onApply = vi.fn();
    render(AuditLogFilter, { availableActions: ['login'], filters: { include: [], exclude: ['core.audit.entry.list', 'core.setting.get'] }, onApply });
    await fireEvent.click(screen.getByRole('button', { name: 'manage.auditFilterButton' }));
    await fireEvent.click(screen.getByRole('option', { name: 'core.setting.get' }));
    await fireEvent.click(screen.getByRole('tab', { name: 'manage.auditExclude (1)' }));
    expect(screen.getByRole('option', { name: 'core.setting.get' }).getAttribute('aria-selected')).toBe('false');
    await fireEvent.click(screen.getByRole('option', { name: 'login' }));
    await fireEvent.click(screen.getByRole('tab', { name: 'manage.auditInclude (1)' }));
    expect(screen.getByRole('option', { name: 'core.setting.get' }).getAttribute('aria-selected')).toBe('true');
    expect(onApply).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: 'manage.auditFilterApply' }));
    expect(onApply).toHaveBeenCalledWith({ include: ['core.setting.get'], exclude: ['core.audit.entry.list', 'login'] });
  });

  it('stages clear and restore separately, and discards both drafts on cancel', async () => {
    const onApply = vi.fn();
    render(AuditLogFilter, { availableActions: [], filters: { include: [], exclude: ['core.audit.entry.list', 'core.setting.get'] }, onApply });
    const trigger = screen.getByRole('button', { name: 'manage.auditFilterButton' });
    await fireEvent.click(trigger);
    const clearButton = screen.getByRole('button', { name: 'manage.auditFilterClearAll' });
    const restoreButton = screen.getByRole('button', { name: 'manage.auditFilterRestoreDefaults' });
    expect(clearButton.hasAttribute('icon-only')).toBe(true);
    expect(clearButton.getAttribute('title')).toBe('manage.auditFilterClearAll');
    expect(clearButton.querySelector('[data-icon="eraser"]')).toBeTruthy();
    expect(restoreButton.hasAttribute('icon-only')).toBe(true);
    expect(restoreButton.getAttribute('title')).toBe('manage.auditFilterRestoreDefaults');
    expect(restoreButton.querySelector('[data-icon="tagReset"]')).toBeTruthy();
    await fireEvent.click(clearButton);
    expect(screen.getByRole('tab', { name: 'manage.auditExclude (0)' })).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();
    await fireEvent.click(restoreButton);
    expect(screen.getByRole('tab', { name: 'manage.auditExclude (2)' })).toBeTruthy();
    await fireEvent.click(clearButton);
    await fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }));
    await fireEvent.click(trigger);
    expect(screen.getByRole('tab', { name: 'manage.auditExclude (2)' })).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'manage.auditFilterClearAll' }));
    await fireEvent.click(screen.getByRole('button', { name: 'manage.auditFilterApply' }));
    expect(onApply).toHaveBeenCalledWith({ include: [], exclude: [] });
  });

  it('supports keyboard tab navigation without toggling options', async () => {
    render(AuditLogFilter, { availableActions: ['login'], filters: { include: [], exclude: [] }, onApply: vi.fn() });
    await fireEvent.click(screen.getByRole('button', { name: 'manage.auditFilterButton' }));
    const tab = screen.getByRole('tab', { name: 'manage.auditInclude (0)' });
    HTMLElement.prototype.scrollIntoView = vi.fn();
    tab.focus();
    await fireEvent.keyDown(tab, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'manage.auditExclude (0)' }).getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'manage.auditExclude (0)' }));
    const input = screen.getByLabelText('manage.auditFilterSearch');
    await fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(document.activeElement?.getAttribute('role')).toBe('option');
    await fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(document.activeElement?.textContent).toContain('login');
  });
});
